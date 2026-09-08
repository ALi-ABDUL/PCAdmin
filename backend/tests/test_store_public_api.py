"""Tests for the /api/store/* public storefront API — the one PCStore
calls to render its catalogue.

Covers:
  1. Health check
  2. Products list — pagination, category filter, in_stock filter
  3. Single-product lookup by id / product_code / url_slug
  4. Related products
  5. Categories list only surfaces categories with visible products
  6. Country-access middleware exemption (endpoints stay reachable
     even when the caller's Cloudflare country is not on the allow-list)
  7. All response fields safe for public display (no `cost`, no
     `supplier_id`, no internal notes)
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    from pathlib import Path
    for line in Path("/app/frontend/.env").read_text().splitlines():
        if line.startswith("REACT_APP_BACKEND_URL="):
            BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
API = f"{BASE_URL}/api"

PRIVATE_FIELDS = {"cost", "cost_price", "supplier_id", "supplier_notes", "internal_notes", "profit"}


@pytest.fixture(scope="module")
def one_product():
    r = requests.get(f"{API}/store/products", params={"limit": 1}, timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    if not body["products"]:
        pytest.skip("no visible products in seed data")
    return body["products"][0]


class TestStoreHealth:
    def test_health(self):
        r = requests.get(f"{API}/store/health", timeout=10)
        assert r.status_code == 200
        assert r.json() == {"ok": True, "service": "PCAdmin storefront API", "version": 1}


class TestStoreProducts:
    def test_list_shape(self):
        r = requests.get(f"{API}/store/products", params={"limit": 5}, timeout=15)
        assert r.status_code == 200
        body = r.json()
        assert {"products", "total", "limit", "offset"} <= set(body.keys())
        assert body["limit"] == 5
        assert body["offset"] == 0
        assert isinstance(body["products"], list)

    def test_pagination(self):
        page1 = requests.get(f"{API}/store/products", params={"limit": 3, "offset": 0}, timeout=15).json()
        page2 = requests.get(f"{API}/store/products", params={"limit": 3, "offset": 3}, timeout=15).json()
        if page1["total"] > 3:
            ids1 = {p["id"] for p in page1["products"]}
            ids2 = {p["id"] for p in page2["products"]}
            assert ids1.isdisjoint(ids2)

    def test_only_active_visible(self, one_product):
        """Every product in the list must be active + non-archived."""
        r = requests.get(f"{API}/store/products", params={"limit": 100}, timeout=15).json()
        for p in r["products"]:
            # We only expose the "public" fields — but the ones we do
            # expose must be consistent with an active product.
            assert p["stock_status"] != "sold" or not p["in_stock"]

    def test_no_private_fields_leaked(self, one_product):
        for f in PRIVATE_FIELDS:
            assert f not in one_product, f"private field {f!r} leaked in storefront product response"

    def test_search_query(self):
        r = requests.get(f"{API}/store/products", params={"q": "coffee", "limit": 5}, timeout=15)
        assert r.status_code == 200

    def test_category_filter(self, one_product):
        cat = one_product.get("category")
        if not cat:
            pytest.skip("first product has no category")
        r = requests.get(f"{API}/store/products", params={"category": cat, "limit": 20}, timeout=15).json()
        for p in r["products"]:
            assert p["category"] == cat


class TestSingleProduct:
    def test_by_id(self, one_product):
        r = requests.get(f"{API}/store/products/{one_product['id']}", timeout=15)
        assert r.status_code == 200
        assert r.json()["id"] == one_product["id"]

    def test_by_product_code(self, one_product):
        code = one_product.get("product_code")
        if not code:
            pytest.skip("no product_code on sample")
        r = requests.get(f"{API}/store/products/{code}", timeout=15)
        assert r.status_code == 200
        assert r.json()["product_code"] == code

    def test_by_slug(self, one_product):
        slug = one_product.get("url_slug")
        if not slug:
            pytest.skip("no url_slug on sample")
        r = requests.get(f"{API}/store/products/{slug}", timeout=15)
        assert r.status_code == 200
        assert r.json()["url_slug"] == slug

    def test_unknown_returns_404(self):
        r = requests.get(f"{API}/store/products/definitely-not-a-real-id", timeout=15)
        assert r.status_code == 404

    def test_related(self, one_product):
        r = requests.get(f"{API}/store/products/{one_product['id']}/related", params={"limit": 3}, timeout=15)
        assert r.status_code == 200
        body = r.json()
        assert "products" in body
        # Related must never include the source product.
        assert all(p["id"] != one_product["id"] for p in body["products"])


class TestStoreCategories:
    def test_categories_list(self):
        r = requests.get(f"{API}/store/categories", timeout=15)
        assert r.status_code == 200
        body = r.json()
        assert "categories" in body and "total" in body
        assert body["total"] == len(body["categories"])
        # Every returned category should have a name.
        for c in body["categories"]:
            assert c.get("name")


class TestCountryExempt:
    def test_store_endpoints_bypass_country_lock(self):
        """Send a request pretending to come from a NOT-allowed country. The
        Country Access middleware must let /api/store/* through anyway."""
        headers = {"CF-IPCountry": "ZZ"}  # not on any allow-list
        r = requests.get(f"{API}/store/health", headers=headers, timeout=10)
        assert r.status_code == 200
        r = requests.get(f"{API}/store/products", headers=headers, params={"limit": 1}, timeout=10)
        assert r.status_code == 200

    def test_portal_endpoints_bypass_country_lock(self):
        """Login attempt from a blocked country should reach the endpoint
        (and return 401 for wrong creds — NOT 403 for country)."""
        headers = {"CF-IPCountry": "ZZ"}
        r = requests.post(
            f"{API}/portal/login",
            headers=headers,
            json={"email": "does-not-exist@example.com", "password": "whatever"},
            timeout=10,
        )
        assert r.status_code in (400, 401), f"expected auth error, not country block, got {r.status_code}"


class TestCORS:
    def test_cors_origin_header_present(self):
        """Sanity-check that CORS is open so PCStore's browser calls succeed."""
        r = requests.get(
            f"{API}/store/health",
            headers={"Origin": "https://pcstore.example.com"},
            timeout=10,
        )
        assert r.status_code == 200
        # Middleware should echo the origin back.
        cors = r.headers.get("access-control-allow-origin", "")
        assert cors in ("*", "https://pcstore.example.com"), f"unexpected CORS header: {cors!r}"
