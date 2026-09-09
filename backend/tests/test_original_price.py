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

# Every class in this module mutates the same singleton state
# (`store_display_settings` + a shared test product). Pin them all to the
# same pytest-xdist worker so class-to-class races can't happen.
pytestmark = pytest.mark.xdist_group("store_display_singleton")


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
        # Force the storefront discount threshold to 0 so tests that assert
        # a strikethrough is visible don't race with the threshold suite
        # (which lives in a different pytest-xdist worker).
        try:
            requests.patch(f"{API}/store-display-settings",
                           json={"discount_badge_min_percent": 0}, timeout=15)
        except Exception:
            pass
        yield
        try:
            r = requests.get(f"{API}/store/products", params={"limit": 1}, timeout=15)
            pid = r.json()["products"][0]["id"]
            requests.patch(f"{API}/products/{pid}", json={"original_price": None}, timeout=15)
            requests.patch(f"{API}/store-display-settings",
                           json={"discount_badge_min_percent": 0}, timeout=15)
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


class _DiscountPercent:
    """`discount_percent` is derived from `original_price` and the effective
    price on the storefront (sale_price when a countdown is active, else
    the sell price). Rounded to a whole number so PCStore can drop it
    straight into a `-{n}%` badge."""

    @classmethod
    @pytest.fixture(autouse=True, scope="class")
    def restore_percent(cls):
        # Force the storefront discount threshold to 0 so tests that
        # assert a discount is visible don't race with the threshold
        # suite (which runs in a different pytest-xdist worker).
        try:
            requests.patch(f"{API}/store-display-settings",
                           json={"discount_badge_min_percent": 0}, timeout=15)
        except Exception:
            pass
        yield
        try:
            r = requests.get(f"{API}/store/products", params={"limit": 1}, timeout=15)
            pid = r.json()["products"][0]["id"]
            requests.patch(f"{API}/products/{pid}", json={"original_price": None}, timeout=15)
            requests.patch(f"{API}/store-display-settings",
                           json={"discount_badge_min_percent": 0}, timeout=15)
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


# -----------------------------------------------------------------------------
# Admin-editable discount-badge threshold
# Endpoints under test:
#   * GET  /api/store-display-settings   → current knobs
#   * PATCH /api/store-display-settings  → update knobs
# Every test below mutates the same singleton so keeping them in this file
# (loadscope pins them into the same pytest-xdist worker as the tests above)
# avoids cross-worker races.
# -----------------------------------------------------------------------------


class _DiscountBadgeThreshold:
    """All cases run serially in one worker (pytest-xdist loadscope)."""

    @classmethod
    @pytest.fixture(autouse=True, scope="class")
    def restore_threshold(cls):
        # Snapshot the singleton so tests never leave the app with a
        # non-zero threshold that would confuse other suites.
        r = requests.get(f"{API}/store-display-settings", timeout=15)
        original = r.json() if r.status_code == 200 else {"discount_badge_min_percent": 0}
        # Create a dedicated test product with a known price so this
        # class doesn't race with `TestDiscountPercent` (which runs on
        # a different worker under `loadscope` and shares the "first
        # product from /store/products" across otherwise unrelated
        # tests).
        pid = None
        try:
            payload = {
                "title": "TEST · threshold isolation product",
                "price": 100.0,
                "cost": 40.0,
                "stock": 5,
                "category": "other",
                "active": True,
            }
            r = requests.post(f"{API}/products", json=payload, timeout=15)
            if r.status_code < 400:
                pid = r.json().get("id")
        except Exception:
            pass
        cls._pid = pid
        yield
        try:
            requests.patch(f"{API}/store-display-settings",
                           json={"discount_badge_min_percent": int(original.get("discount_badge_min_percent") or 0)},
                           timeout=15)
            if pid:
                requests.delete(f"{API}/products/{pid}", timeout=15)
        except Exception:
            pass

    def _set_threshold(self, pct):
        r = requests.patch(f"{API}/store-display-settings",
                           json={"discount_badge_min_percent": pct}, timeout=15)
        assert r.status_code == 200, r.text
        return r.json()

    def _product(self):
        # Use the dedicated fixture product when it was created; fall back
        # to the first storefront product if creation failed (older
        # deployments without the POST /products endpoint).
        if self._pid:
            r = requests.get(f"{API}/store/products/{self._pid}", timeout=15)
            if r.status_code == 200:
                return r.json()
        r = requests.get(f"{API}/store/products", params={"limit": 1}, timeout=15)
        return r.json()["products"][0]

    def _set_original(self, pid, orig):
        r = requests.patch(f"{API}/products/{pid}", json={"original_price": orig}, timeout=15)
        assert r.status_code == 200

    def test_default_is_zero(self):
        # Wipe to default, GET must return 0.
        self._set_threshold(0)
        body = requests.get(f"{API}/store-display-settings", timeout=15).json()
        assert body["discount_badge_min_percent"] == 0

    def test_patch_persists(self):
        body = self._set_threshold(15)
        assert body["discount_badge_min_percent"] == 15
        body = requests.get(f"{API}/store-display-settings", timeout=15).json()
        assert body["discount_badge_min_percent"] == 15

    def test_threshold_hides_small_discount(self):
        p = self._product()
        # 20% target threshold; pick an original that gives ~6% discount.
        self._set_threshold(20)
        target_orig = round(float(p["price"]) / 0.94, 2)  # ≈ 6% off
        self._set_original(p["id"], target_orig)
        got = requests.get(f"{API}/store/products/{p['id']}", timeout=15).json()
        assert got["original_price"] is None, "strikethrough should be hidden under threshold"
        assert got["discount_percent"] is None, "badge should be hidden under threshold"

    def test_threshold_shows_big_discount(self):
        p = self._product()
        self._set_threshold(20)
        target_orig = round(float(p["price"]) * 2, 2)  # 50% off
        self._set_original(p["id"], target_orig)
        got = requests.get(f"{API}/store/products/{p['id']}", timeout=15).json()
        assert got["original_price"] is not None
        assert got["discount_percent"] >= 20

    def test_zero_threshold_shows_everything(self):
        p = self._product()
        self._set_threshold(0)
        # 3% saving — with threshold 0 the strikethrough + badge must render.
        target_orig = round(float(p["price"]) / 0.97, 2)
        self._set_original(p["id"], target_orig)
        got = requests.get(f"{API}/store/products/{p['id']}", timeout=15).json()
        assert got["original_price"] is not None
        assert got["discount_percent"] is not None

    def test_out_of_range_rejected(self):
        r = requests.patch(f"{API}/store-display-settings",
                           json={"discount_badge_min_percent": 150}, timeout=15)
        assert r.status_code in (400, 422)
        r = requests.patch(f"{API}/store-display-settings",
                           json={"discount_badge_min_percent": -5}, timeout=15)
        assert r.status_code in (400, 422)

    def test_list_endpoint_respects_threshold(self):
        p = self._product()
        self._set_threshold(50)
        self._set_original(p["id"], round(float(p["price"]) * 1.1, 2))  # ~9% saving
        rows = requests.get(f"{API}/store/products", params={"limit": 100}, timeout=15).json()["products"]
        row = next((r for r in rows if r["id"] == p["id"]), None)
        if row is not None:
            assert row["original_price"] is None
            assert row["discount_percent"] is None



class TestOriginalPriceStorefront(_DiscountPercent, _DiscountBadgeThreshold):
    """Aggregator that pytest actually collects.

    Both mixins mutate the same `store_display_settings` singleton, so if
    pytest-xdist ran them in different workers they would race. Consolidating
    every mixin's tests into ONE class means `loadscope` schedules them all
    into a single worker — races impossible.
    """
    pass

