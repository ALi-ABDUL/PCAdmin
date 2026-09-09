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


class TestDiscountPercent:
    """`discount_percent` is derived from `original_price` and the effective
    price on the storefront (sale_price when a countdown is active, else
    the sell price). Rounded to a whole number so PCStore can drop it
    straight into a `-{n}%` badge."""

    @classmethod
    @pytest.fixture(autouse=True, scope="class")
    def restore(cls):
        yield
        try:
            r = requests.get(f"{API}/store/products", params={"limit": 1}, timeout=15)
            pid = r.json()["products"][0]["id"]
            requests.patch(f"{API}/products/{pid}", json={"original_price": None}, timeout=15)
        except Exception:
            pass

    def _patch_and_get(self, pid, orig):
        r = requests.patch(f"{API}/products/{pid}", json={"original_price": orig}, timeout=15)
        assert r.status_code == 200
        return requests.get(f"{API}/store/products/{pid}", timeout=15).json()

    def test_discount_matches_manual_math(self, product):
        body = self._patch_and_get(product["id"], 400.0)
        price = float(body["price"])
        orig = float(body["original_price"])
        expected = round((orig - price) / orig * 100)
        assert body["discount_percent"] == expected
        assert 1 <= body["discount_percent"] <= 99

    def test_larger_original_larger_discount(self, product):
        low = self._patch_and_get(product["id"], 400.0)["discount_percent"]
        high = self._patch_and_get(product["id"], 800.0)["discount_percent"]
        assert high > low

    def test_discount_null_when_no_original(self, product):
        body = self._patch_and_get(product["id"], None)
        assert body["original_price"] is None
        assert body["discount_percent"] is None

    def test_discount_null_when_original_below_or_equal(self, product):
        # Equal → 0% saving → should be treated as no strikethrough → null.
        r = requests.get(f"{API}/store/products/{product['id']}", timeout=15).json()
        current = float(r["price"])
        body = self._patch_and_get(product["id"], current)
        assert body["original_price"] is None
        assert body["discount_percent"] is None
        # Lower than current → same result.
        body = self._patch_and_get(product["id"], round(current - 1, 2))
        assert body["discount_percent"] is None

    def test_list_endpoint_carries_discount_percent(self, product):
        # Make sure the key exists on every list row too (even if null),
        # so PCStore doesn't need to null-check field presence.
        requests.patch(f"{API}/products/{product['id']}",
                       json={"original_price": 500.0}, timeout=15)
        rows = requests.get(f"{API}/store/products", params={"limit": 50}, timeout=15).json()["products"]
        for row in rows:
            assert "discount_percent" in row
        found = next((p for p in rows if p["id"] == product["id"]), None)
        if found is not None:
            assert isinstance(found["discount_percent"], int)
            assert found["discount_percent"] > 0

