"""Integration coverage for the breadcrumb-cleaning feature (iteration 12).

Covers:
  * SCRAPER F: scraper._extract_breadcrumbs strips "See more"/"See all" noise
    from JSON-LD BreadcrumbList before returning.
  * API G: parse_and_enrich in-process for hand-crafted HTML with a JSON-LD
    BreadcrumbList containing a "See more" entry produces a clean
    `ebay_category_path`.
  * API H: POST /api/products/from-item/{item_id} for the user's Car Audio
    example creates a Category named "Car Audio In-Dash Units" (NOT parent
    "Car Audio") and the resulting Product.category equals that slug.
  * REGRESSION R2: GET /api/products?category=<slug> returns matching
    products for the auto-created category under the new naming.
"""
import asyncio
import os
import sys
import uuid
from pathlib import Path

import pytest
import requests
from bs4 import BeautifulSoup

HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE))

from scraper import _extract_breadcrumbs, parse_and_enrich  # noqa: E402
from helpers import _slug  # noqa: E402
from deps import db  # noqa: E402

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
API = f"{BASE_URL}/api"

_RUN_ID = uuid.uuid4().hex[:8]


def _run(coro):
    try:
        loop = asyncio.get_event_loop()
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
    if loop.is_closed():
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
    return loop.run_until_complete(coro)


def _ld_html(names):
    """Construct minimal eBay-like HTML with a JSON-LD BreadcrumbList."""
    items = "".join(
        f'{{"@type":"ListItem","position":{i+1},"name":"{n}"}}'
        + ("," if i < len(names) - 1 else "")
        for i, n in enumerate(names)
    )
    return f"""<!doctype html><html><head>
<script type="application/ld+json">
{{"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[{items}]}}
</script>
<title>Test Item</title>
<meta property="og:title" content="Test Item {_RUN_ID}" />
</head><body><h1 id="itemTitle">Test Item {_RUN_ID}</h1></body></html>"""


# --------------------------------------------------------------------------
# SCRAPER F — _extract_breadcrumbs filters noise
# --------------------------------------------------------------------------

class TestExtractBreadcrumbsFiltersNoise:
    def test_strips_see_more_from_jsonld(self):
        html = _ld_html(["eBay Motors", "Vehicle Parts", "See more",
                         "Car Audio", "Car Audio In-Dash Units"])
        soup = BeautifulSoup(html, "lxml")
        crumbs = _extract_breadcrumbs(soup, html)
        assert "See more" not in crumbs
        assert "See all" not in crumbs
        # "eBay Motors" is a site-header prefix — also filtered
        assert not any(c.lower().startswith("ebay") for c in crumbs)
        assert crumbs == ["Vehicle Parts", "Car Audio", "Car Audio In-Dash Units"]

    def test_strips_multiple_noise_tokens(self):
        html = _ld_html(["eBay", "See all", "Electronics", "View all",
                         "Cameras", "Show more", "Digital Cameras"])
        soup = BeautifulSoup(html, "lxml")
        crumbs = _extract_breadcrumbs(soup, html)
        for noise in ("See all", "View all", "Show more"):
            assert noise not in crumbs
        # "eBay" itself is filtered by the scraper too
        assert "eBay" not in crumbs
        assert "Electronics" in crumbs and "Digital Cameras" in crumbs


# --------------------------------------------------------------------------
# API G — parse_and_enrich end-to-end (in-process)
# --------------------------------------------------------------------------

class TestParseAndEnrichCleansBreadcrumbs:
    def test_ebay_category_path_has_no_noise(self):
        html = _ld_html(["eBay Motors", "Vehicle Parts & Accessories",
                         "See more", "Car Audio", "Car Audio In-Dash Units"])

        async def go():
            return await parse_and_enrich(html, "https://www.ebay.com.au/itm/1234", fetch_desc=False)

        data = _run(go())
        path = data.get("ebay_category_path") or []
        assert path, f"expected breadcrumb path, got {path}"
        assert "See more" not in path
        assert "See all" not in path
        # Leaf must be present (raw path, not yet reduced)
        assert path[-1] == "Car Audio In-Dash Units"


# --------------------------------------------------------------------------
# API H + R2 — /api/products/from-item creates properly-named category and
# category filter still returns the product.
# --------------------------------------------------------------------------

@pytest.mark.skipif(not BASE_URL, reason="REACT_APP_BACKEND_URL not set")
class TestFromItemUsesLeafCategory:
    # Unique category name so we don't collide with real data / other test runs
    LEAF_NAME = f"TEST BC {_RUN_ID} Car Audio In-Dash Units"
    PARENT_NAME = f"TEST BC {_RUN_ID} Car Audio"

    @pytest.fixture(autouse=True)
    def _cleanup(self):
        # Setup: none required — we'll create the item fresh per-test
        yield
        # Teardown: wipe anything TEST_-prefixed we may have created
        async def wipe():
            await db.items.delete_many({"id": {"$regex": f"^TEST_bc_{_RUN_ID}"}})
            await db.products.delete_many({"source_item_id": {"$regex": f"^TEST_bc_{_RUN_ID}"}})
            await db.categories.delete_many(
                {"name": {"$regex": f"^TEST BC {_RUN_ID} "}}
            )
        _run(wipe())

    def _insert_item(self, crumbs):
        item_id = f"TEST_bc_{_RUN_ID}_{uuid.uuid4().hex[:6]}"
        doc = {
            "id": item_id,
            "item_id": item_id,
            "url": f"https://www.ebay.com.au/itm/{item_id}",
            "title": f"Test Item {_RUN_ID}",
            "price_value": 199.99,
            "price_display": "AU $199.99",
            "images": [],
            "specifics": {},
            "variants": [],
            "ebay_category_path": crumbs,
            "created_at": "2026-01-01T00:00:00+00:00",
            "is_sold": False,
        }
        async def ins():
            await db.items.insert_one(doc)
        _run(ins())
        return item_id

    def test_creates_category_from_leaf_and_products_filter_by_slug(self):
        crumbs = [
            "eBay Motors",
            "Vehicle Parts & Accessories",
            "Vehicle Electronics & GPS",
            self.PARENT_NAME,   # parent — must NOT be picked
            self.LEAF_NAME,     # leaf — must be picked
        ]
        item_id = self._insert_item(crumbs)

        # Call API H
        r = requests.post(f"{API}/products/from-item/{item_id}", timeout=30)
        assert r.status_code == 200, r.text
        prod = r.json()

        expected_slug = _slug(self.LEAF_NAME)
        parent_slug = _slug(self.PARENT_NAME)

        # Product.category must be the LEAF slug, not the parent
        assert prod["category"] == expected_slug, (
            f"expected leaf slug {expected_slug!r}, got {prod['category']!r}"
        )
        assert prod["category"] != parent_slug

        # The Category document itself must be named after the leaf
        async def get_cat():
            return await db.categories.find_one({"slug": expected_slug}, {"_id": 0})
        cat = _run(get_cat())
        assert cat is not None, "auto-created category not found"
        assert cat["name"] == self.LEAF_NAME
        # description column contains the full trail (leaf + parent present)
        assert self.LEAF_NAME in cat["description"]
        assert self.PARENT_NAME in cat["description"]

        # REGRESSION R2 — /api/products?category=<slug> returns the product
        r2 = requests.get(f"{API}/products", params={"category": expected_slug}, timeout=20)
        assert r2.status_code == 200, r2.text
        payload = r2.json()
        items = payload.get("products") if isinstance(payload, dict) else payload
        items = items or []
        assert any(p.get("id") == prod["id"] for p in items), (
            f"product {prod['id']} not found when filtering by category={expected_slug}"
        )

        # Documentation-check (soft): review request said description should
        # NOT contain the "eBay Motors" store prefix. Current implementation
        # only strips single-word "ebay"/"home", so multi-word "eBay Motors"
        # leaks through. Reported to main agent as a minor cleanup miss.
        assert "eBay Motors" not in cat["description"], (
            "ISSUE: 'eBay Motors' store prefix leaks into Category.description "
            "because helpers._BREADCRUMB_NOISE_EXACT only lists single-word "
            "'ebay'/'home'. Extend the set or add a regex to catch 'eBay *'."
        )
