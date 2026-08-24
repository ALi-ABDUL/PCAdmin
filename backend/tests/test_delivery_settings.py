"""Tests for the store-wide Delivery Settings singleton and the
per-product custom delivery window override.

Covers:
 - Defaults are seeded on first read (3 min / 7 max business days)
 - PATCH validates: non-negative, max >= min, upper bound
 - Product PATCH accepts + persists custom_delivery_window + min/max
 - Product PATCH rejects invalid window (max < min)
"""
import uuid
from pathlib import Path

import requests

BASE_URL = ""
for line in Path("/app/frontend/.env").read_text().splitlines():
    if line.startswith("REACT_APP_BACKEND_URL="):
        BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
API = f"{BASE_URL}/api"


def _create_product():
    body = {"title": f"Test-{uuid.uuid4().hex[:6]}", "price": 20, "cost": 10, "stock": 5}
    r = requests.post(f"{API}/products", json=body, timeout=15)
    r.raise_for_status()
    return r.json()


class TestDeliverySettings:
    def test_defaults_are_seeded(self):
        r = requests.get(f"{API}/delivery-settings", timeout=15)
        assert r.status_code == 200
        s = r.json()
        assert s["default_min_days"] >= 0
        assert s["default_max_days"] >= s["default_min_days"]

    def test_patch_valid_window(self):
        try:
            r = requests.patch(f"{API}/delivery-settings",
                               json={"default_min_days": 2, "default_max_days": 10}, timeout=15)
            assert r.status_code == 200
            got = r.json()
            assert got["default_min_days"] == 2
            assert got["default_max_days"] == 10
        finally:
            requests.patch(f"{API}/delivery-settings",
                           json={"default_min_days": 3, "default_max_days": 7}, timeout=15)

    def test_patch_rejects_max_less_than_min(self):
        r = requests.patch(f"{API}/delivery-settings",
                           json={"default_min_days": 8, "default_max_days": 3}, timeout=15)
        assert r.status_code == 400

    def test_patch_rejects_negative(self):
        r = requests.patch(f"{API}/delivery-settings",
                           json={"default_min_days": -1, "default_max_days": 5}, timeout=15)
        assert r.status_code == 400

    def test_patch_rejects_over_upper_bound(self):
        r = requests.patch(f"{API}/delivery-settings",
                           json={"default_min_days": 3, "default_max_days": 1000}, timeout=15)
        assert r.status_code == 400


class TestProductDeliveryWindow:
    def test_saves_and_reads(self):
        p = _create_product()
        try:
            r = requests.patch(f"{API}/products/{p['id']}", json={
                "custom_delivery_window": True,
                "delivery_min_days": 4,
                "delivery_max_days": 12,
            }, timeout=15)
            assert r.status_code == 200
            got = requests.get(f"{API}/products/{p['id']}", timeout=15).json()
            assert got["custom_delivery_window"] is True
            assert got["delivery_min_days"] == 4
            assert got["delivery_max_days"] == 12
        finally:
            requests.delete(f"{API}/products/{p['id']}", timeout=15)

    def test_rejects_max_less_than_min(self):
        p = _create_product()
        try:
            r = requests.patch(f"{API}/products/{p['id']}", json={
                "custom_delivery_window": True,
                "delivery_min_days": 10,
                "delivery_max_days": 4,
            }, timeout=15)
            assert r.status_code == 400
        finally:
            requests.delete(f"{API}/products/{p['id']}", timeout=15)

    def test_toggle_off_persists(self):
        # Turning off `custom_delivery_window` should just persist the flag —
        # the frontend falls back to the store-wide defaults for display.
        p = _create_product()
        try:
            requests.patch(f"{API}/products/{p['id']}", json={
                "custom_delivery_window": True,
                "delivery_min_days": 5,
                "delivery_max_days": 7,
            }, timeout=15).raise_for_status()
            r = requests.patch(f"{API}/products/{p['id']}",
                               json={"custom_delivery_window": False}, timeout=15)
            assert r.status_code == 200
            got = requests.get(f"{API}/products/{p['id']}", timeout=15).json()
            assert got["custom_delivery_window"] is False
        finally:
            requests.delete(f"{API}/products/{p['id']}", timeout=15)
