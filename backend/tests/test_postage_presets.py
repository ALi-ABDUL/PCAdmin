"""Tests for the Postage Presets CRUD + product-side wiring.

Covers:
 - Default seeding creates the 3 baseline presets (Free / Standard / Large Item)
 - Validation: `free` presets must carry $0, `insurance_amount` only allowed on `large_item`
 - PATCH switches kind and auto-zeros irrelevant amounts
 - DELETE cascades: any product referencing the preset is reset to `postage_preset_id: None`
 - Products can be patched with `postage_preset_id` + per-product amount overrides
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


def _list_presets():
    r = requests.get(f"{API}/postage-presets", timeout=15)
    r.raise_for_status()
    return r.json()["presets"]


class TestPostagePresetSeeding:
    def test_default_presets_exist(self):
        presets = _list_presets()
        names = {p["name"] for p in presets}
        assert {"Free Postage", "Standard Postage", "Large Item"}.issubset(names)

    def test_free_preset_has_zero_amounts(self):
        free = next(p for p in _list_presets() if p["kind"] == "free")
        assert free["postage_amount"] == 0.0
        assert free["insurance_amount"] == 0.0

    def test_large_item_preset_has_insurance(self):
        li = next(p for p in _list_presets() if p["kind"] == "large_item")
        assert li["postage_amount"] > 0
        assert li["insurance_amount"] > 0


class TestPostagePresetValidation:
    def test_free_with_amount_rejected(self):
        r = requests.post(f"{API}/postage-presets",
                          json={"name": "Bad", "kind": "free", "postage_amount": 5.0},
                          timeout=15)
        assert r.status_code == 400

    def test_insurance_only_on_large_item(self):
        r = requests.post(f"{API}/postage-presets",
                          json={"name": "Bad", "kind": "standard", "postage_amount": 5.0,
                                "insurance_amount": 2.0},
                          timeout=15)
        assert r.status_code == 400

    def test_unknown_kind_rejected(self):
        r = requests.post(f"{API}/postage-presets",
                          json={"name": "Bad", "kind": "express", "postage_amount": 5.0},
                          timeout=15)
        assert r.status_code == 400

    def test_negative_amount_rejected(self):
        r = requests.post(f"{API}/postage-presets",
                          json={"name": "Bad", "kind": "standard", "postage_amount": -1},
                          timeout=15)
        assert r.status_code == 400


class TestPostagePresetPatch:
    def test_switch_to_free_zeros_amounts(self):
        # Create a standard preset with an amount, patch it to `free`.
        p = requests.post(f"{API}/postage-presets",
                          json={"name": f"T-{uuid.uuid4().hex[:6]}", "kind": "standard",
                                "postage_amount": 9.95}, timeout=15).json()
        try:
            r = requests.patch(f"{API}/postage-presets/{p['id']}",
                               json={"kind": "free"}, timeout=15)
            assert r.status_code == 200
            body = r.json()
            assert body["kind"] == "free"
            assert body["postage_amount"] == 0.0
            assert body["insurance_amount"] == 0.0
        finally:
            requests.delete(f"{API}/postage-presets/{p['id']}", timeout=15)

    def test_switch_away_from_large_item_clears_insurance(self):
        p = requests.post(f"{API}/postage-presets",
                          json={"name": f"T-{uuid.uuid4().hex[:6]}", "kind": "large_item",
                                "postage_amount": 20, "insurance_amount": 10},
                          timeout=15).json()
        try:
            r = requests.patch(f"{API}/postage-presets/{p['id']}",
                               json={"kind": "standard"}, timeout=15)
            assert r.status_code == 200
            body = r.json()
            assert body["insurance_amount"] == 0.0
            # postage_amount kept
            assert body["postage_amount"] == 20
        finally:
            requests.delete(f"{API}/postage-presets/{p['id']}", timeout=15)


class TestProductPostageWiring:
    def test_product_saves_and_reads_preset(self):
        preset = next(p for p in _list_presets() if p["kind"] == "large_item")
        prod = _create_product()
        try:
            r = requests.patch(f"{API}/products/{prod['id']}", json={
                "postage_preset_id": preset["id"],
                "postage_amount": 33.5,
                "postage_insurance_amount": 8.0,
            }, timeout=15)
            assert r.status_code == 200
            got = requests.get(f"{API}/products/{prod['id']}", timeout=15).json()
            assert got["postage_preset_id"] == preset["id"]
            assert got["postage_amount"] == 33.5
            assert got["postage_insurance_amount"] == 8.0
        finally:
            requests.delete(f"{API}/products/{prod['id']}", timeout=15)

    def test_delete_preset_clears_product_reference(self):
        # Create a preset, assign it, then delete it — the product's
        # postage_preset_id must be reset to None so the dropdown doesn't
        # show a dangling id.
        preset = requests.post(f"{API}/postage-presets",
                               json={"name": f"T-{uuid.uuid4().hex[:6]}", "kind": "standard",
                                     "postage_amount": 5}, timeout=15).json()
        prod = _create_product()
        try:
            requests.patch(f"{API}/products/{prod['id']}", json={
                "postage_preset_id": preset["id"],
                "postage_amount": 5.0,
            }, timeout=15)
            requests.delete(f"{API}/postage-presets/{preset['id']}", timeout=15)
            got = requests.get(f"{API}/products/{prod['id']}", timeout=15).json()
            assert got["postage_preset_id"] is None
        finally:
            requests.delete(f"{API}/products/{prod['id']}", timeout=15)
