"""Tests for the new `original_price` (was/before) field on products.

Covers:
  1. PATCH `/api/products/{pid}` persists `original_price`
  2. GET `/api/products/{pid}` returns it
  3. Storefront `/api/store/products/{pid}` surfaces it ONLY when higher
     than the current sell price (otherwise `null` — never a same-value
     strikethrough)
  4. Clearing with `null` removes it
  5. List endpoint (`/api/store/products`) includes it too
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


@pytest.fixture(scope="module")
def product():
    r = requests.get(f"{API}/store/products", params={"limit": 1}, timeout=15)
    body = r.json()
    if not body["products"]:
        pytest.skip("no visible products in seed data")
    return body["products"][0]


class TestOriginalPrice:
    """All cases in one class so `loadscope` runs them serially on the
    shared product doc."""

    @classmethod
    @pytest.fixture(autouse=True, scope="class")
    def restore(cls):
        yield
        # Best-effort restore — grab any product touched during the class
        # and reset its `original_price` to null. Cheap safety net.
        try:
            r = requests.get(f"{API}/store/products", params={"limit": 1}, timeout=15)
            pid = r.json()["products"][0]["id"]
            requests.patch(f"{API}/products/{pid}", json={"original_price": None}, timeout=15)
        except Exception:
            pass

    def test_patch_persists_original_price(self, product):
        r = requests.patch(f"{API}/products/{product['id']}",
                           json={"original_price": 999.99}, timeout=15)
        assert r.status_code == 200, r.text
        assert float(r.json()["original_price"]) == 999.99

    def test_get_returns_original_price(self, product):
        r = requests.get(f"{API}/products/{product['id']}", timeout=15)
        assert r.status_code == 200
        assert float(r.json()["original_price"]) == 999.99

    def test_storefront_surfaces_when_higher(self, product):
        r = requests.get(f"{API}/store/products/{product['id']}", timeout=15)
        assert r.status_code == 200
        body = r.json()
        assert body["original_price"] is not None
        assert float(body["original_price"]) > float(body["price"])

    def test_storefront_hides_when_equal_or_lower(self, product):
        r = requests.patch(f"{API}/products/{product['id']}",
                           json={"original_price": 0.01}, timeout=15)
        assert r.status_code == 200
        r = requests.get(f"{API}/store/products/{product['id']}", timeout=15)
        assert r.json()["original_price"] is None

    def test_null_clears_field(self, product):
        r = requests.patch(f"{API}/products/{product['id']}",
                           json={"original_price": None}, timeout=15)
        assert r.status_code == 200
        assert r.json().get("original_price") is None

    def test_list_endpoint_includes_original_price_key(self, product):
        # Restore a valid strikethrough state.
        requests.patch(f"{API}/products/{product['id']}",
                       json={"original_price": 999.99}, timeout=15)
        r = requests.get(f"{API}/store/products", params={"limit": 50}, timeout=15)
        assert r.status_code == 200
        rows = r.json()["products"]
        # Every product row must carry the key (even if null) so the
        # PCStore frontend doesn't have to null-check the field name.
        for row in rows:
            assert "original_price" in row
        # And our test product should carry the value we just set.
        found = next((p for p in rows if p["id"] == product["id"]), None)
        if found is not None:
            assert float(found["original_price"]) == 999.99
