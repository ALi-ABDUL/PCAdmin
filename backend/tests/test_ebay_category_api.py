"""API-level tests for eBay category auto-creation on import.

Covers:
 - API B: POST /api/products/from-item/{item_id} creates category if missing.
 - API C: POST /api/items/bulk with action='add_to_products' triggers ensure.
 - API D: Duplicate imports of the same category yield exactly ONE category row.
 - API E: Seeded categories are preserved (still returned by GET /api/categories).
 - R2:  GET /api/products?category=<slug> filters products by that slug.
"""
import os
import re
import sys
import uuid
from pathlib import Path

import pytest
import requests

HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE))

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL")
if not BASE_URL:
    # Fallback: read from frontend/.env directly
    envf = Path("/app/frontend/.env")
    if envf.exists():
        for line in envf.read_text().splitlines():
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip()
                break
BASE_URL = (BASE_URL or "").rstrip("/")
assert BASE_URL, "REACT_APP_BACKEND_URL must be set"

API = f"{BASE_URL}/api"


def _slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", (s or "").lower()).strip("-") or "cat"


# --- Mongo direct insert of a seed item (bypasses live eBay scrape) ---
import asyncio
from deps import db

# Reuse a single event loop for the whole test module so motor's client (which
# binds to the loop it first sees) keeps working across tests.
_LOOP = asyncio.new_event_loop()
asyncio.set_event_loop(_LOOP)


def _run(coro):
    return _LOOP.run_until_complete(coro)


# Per-run unique suffix so parallel xdist workers don't wipe each other's items.
_RUN_ID = uuid.uuid4().hex[:8]


def _mk_item(ebay_category_path):
    """Insert a fake scraped item directly into Mongo and return its id."""
    item_id = f"TEST_{_RUN_ID}_{uuid.uuid4().hex[:8]}"
    doc = {
        "id": item_id,
        "item_id": item_id,
        "title": f"TEST Auto Cat {_RUN_ID} Item {item_id[-4:]}",
        "url": f"https://www.ebay.com.au/itm/{uuid.uuid4().int % (10**12)}",
        "price_value": 49.99,
        "price": "AU $49.99",
        "images": [],
        "seller": "seller-test",
        "specifics": {},
        "variants": [],
        "ebay_category_path": ebay_category_path,
        "added_to_products": False,
        "active": True,
        "created_at": "2026-01-01T00:00:00+00:00",
        "updated_at": "2026-01-01T00:00:00+00:00",
    }
    _run(db.items.insert_one(doc))
    return item_id


@pytest.fixture(autouse=True)
def cleanup():
    async def _wipe():
        # Wipe only entities created by THIS test-suite run (unique _RUN_ID prefix)
        # so parallel xdist workers running other tests can't clobber each other.
        await db.categories.delete_many({"slug": {"$regex": f"^auto-api-{_RUN_ID}-"}})
        await db.items.delete_many({"id": {"$regex": f"^TEST_{_RUN_ID}_"}})
        await db.products.delete_many({"title": {"$regex": f"^TEST Auto Cat {_RUN_ID} "}})
    yield
    _run(_wipe())


# Helper to build a run-unique leaf so parallel workers never share a slug.
def _uniq_leaf(name: str) -> str:
    return f"Auto Api {_RUN_ID} {name}"


class TestAutoCategoryOnAddToProducts:
    """API B — POST /api/products/from-item/{item_id}"""

    def test_before_and_after_categories(self):
        leaf = _uniq_leaf("Kitchen Widgets Alpha")
        expected_slug = _slug(leaf)
        assert expected_slug.startswith("auto-api-")

        # BEFORE: slug not present
        before = requests.get(f"{API}/categories").json().get("categories", [])
        before_slugs = {c["slug"] for c in before}
        assert expected_slug not in before_slugs

        item_id = _mk_item(["eBay", "Home & Garden", leaf])

        # Call the endpoint
        r = requests.post(f"{API}/products/from-item/{item_id}")
        assert r.status_code == 200, r.text
        prod = r.json()
        assert prod["category"] == expected_slug, f"Product.category should be leaf slug, got {prod['category']!r}"

        # AFTER: slug now present
        after = requests.get(f"{API}/categories").json().get("categories", [])
        after_map = {c["slug"]: c for c in after}
        assert expected_slug in after_map
        auto = after_map[expected_slug]
        assert auto["name"] == leaf
        assert auto["group"] == "Home & Garden"


class TestBulkAddToProducts:
    """API C — POST /api/items/bulk action=add_to_products"""

    def test_bulk_creates_categories_for_each(self):
        leaf_a = _uniq_leaf("Bulk Cameras")
        leaf_b = _uniq_leaf("Bulk Speakers")
        id_a = _mk_item(["eBay", "Electronics", leaf_a])
        id_b = _mk_item(["eBay", "Electronics", leaf_b])

        r = requests.post(f"{API}/items/bulk",
                          json={"ids": [id_a, id_b], "action": "add_to_products"})
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("created") == 2, data

        after = requests.get(f"{API}/categories").json().get("categories", [])
        slugs = {c["slug"] for c in after}
        assert _slug(leaf_a) in slugs
        assert _slug(leaf_b) in slugs


class TestNoDuplicateCategory:
    """API D — Second import of same category must NOT duplicate the row."""

    def test_duplicate_import_no_duplicate_row(self):
        leaf = _uniq_leaf("Duplicate Guard")
        slug = _slug(leaf)
        id1 = _mk_item(["eBay", "Sports", leaf])
        id2 = _mk_item(["eBay", "Sports", leaf])

        r1 = requests.post(f"{API}/products/from-item/{id1}")
        assert r1.status_code == 200
        r2 = requests.post(f"{API}/products/from-item/{id2}")
        assert r2.status_code == 200

        after = requests.get(f"{API}/categories").json().get("categories", [])
        matches = [c for c in after if c["slug"] == slug]
        assert len(matches) == 1, f"expected exactly one category row, found {len(matches)}"


class TestSeededCategoriesPreserved:
    """API E — seed categories must still be visible."""

    def test_seed_categories_present(self):
        """API E: adding an auto-created category must not delete/mutate existing ones."""
        before = requests.get(f"{API}/categories").json().get("categories", [])
        before_slugs = {c["slug"] for c in before if not c["slug"].startswith("auto-api-")}

        leaf = _uniq_leaf("Preserve Seed")
        item_id = _mk_item(["eBay", "Books", leaf])
        r = requests.post(f"{API}/products/from-item/{item_id}")
        assert r.status_code == 200

        after = requests.get(f"{API}/categories").json().get("categories", [])
        after_slugs = {c["slug"] for c in after}
        missing = before_slugs - after_slugs
        assert not missing, f"Pre-existing categories vanished: {missing}"
        assert _slug(leaf) in after_slugs


class TestCategoryFilterRegression:
    """R2 — GET /api/products?category=<slug> filters correctly."""

    def test_filter_by_auto_created_slug(self):
        leaf = _uniq_leaf("Filter Target")
        slug = _slug(leaf)
        item_id = _mk_item(["eBay", "Toys", leaf])
        r = requests.post(f"{API}/products/from-item/{item_id}")
        assert r.status_code == 200
        prod = r.json()
        assert prod["category"] == slug

        # Now fetch products filtered by this slug
        r = requests.get(f"{API}/products", params={"category": slug})
        assert r.status_code == 200
        payload = r.json()
        products = payload.get("products", payload if isinstance(payload, list) else [])
        assert isinstance(products, list)
        titles = [p.get("title") for p in products]
        assert prod["title"] in titles
        # All returned products should have this category
        for p in products:
            assert p["category"] == slug
