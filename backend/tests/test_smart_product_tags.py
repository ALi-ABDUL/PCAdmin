"""API coverage for smart product badges and persisted tag settings."""
from __future__ import annotations

import os
import pathlib
import uuid
import fcntl

import requests
import pytest


BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    for line in pathlib.Path("/app/frontend/.env").read_text().splitlines():
        if line.startswith("REACT_APP_BACKEND_URL="):
            BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module", autouse=True)
def tag_settings_lock():
    """The singleton settings document must not be mutated by xdist peers."""
    with open("/tmp/pcadmin-smart-tag-tests.lock", "w") as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        yield
        fcntl.flock(lock.fileno(), fcntl.LOCK_UN)


def _product_payload():
    return {
        "title": f"Smart Tag Test {uuid.uuid4().hex[:8]}",
        "price": 89.0,
        "cost": 40.0,
        "stock": 4,
        "category": "other",
        "sku": f"smart-{uuid.uuid4().hex[:10]}",
    }


def test_settings_persist_and_dynamic_new_limited_deal_tags():
    original = requests.get(f"{API}/tag-settings", timeout=15).json()
    created = requests.post(f"{API}/products", json=_product_payload(), timeout=15)
    assert created.status_code == 200, created.text
    pid = created.json()["id"]
    try:
        changed = requests.patch(f"{API}/tag-settings", json={
            "tags": {
                "new": {"enabled": True, "label": "Fresh"},
                "limited": {"enabled": True, "label": "Last Ones"},
                "deal": {"enabled": True, "label": original["tags"]["deal"]["label"]},
            },
        }, timeout=15)
        assert changed.status_code == 200, changed.text
        assert changed.json()["tags"]["new"]["label"] == "Fresh"

        deal = requests.patch(f"{API}/products/{pid}", json={"deal_enabled": True}, timeout=15)
        assert deal.status_code == 200, deal.text
        product = requests.get(f"{API}/products/{pid}", timeout=15).json()
        deal_label = original["tags"]["deal"]["label"]
        assert {"Fresh", "Last Ones", deal_label}.issubset(set(product["smart_tags"]))
        assert isinstance(product.get("seo_tags"), list)

        storefront = requests.get(f"{API}/store/products/{pid}", timeout=15)
        assert storefront.status_code == 200, storefront.text
        assert {"Fresh", "Last Ones", deal_label}.issubset(set(storefront.json()["tags"]))
    finally:
        requests.patch(f"{API}/tag-settings", json={"tags": original["tags"]}, timeout=15)
        requests.delete(f"{API}/products/{pid}", timeout=15)


def test_hot_rule_records_storefront_views():
    original = requests.get(f"{API}/tag-settings", timeout=15).json()
    enabled = requests.patch(f"{API}/tag-settings", json={
        "tags": {"hot": {"enabled": True, "label": "Trending"}},
    }, timeout=15)
    assert enabled.status_code == 200, enabled.text
    created = requests.post(f"{API}/products", json=_product_payload(), timeout=15)
    assert created.status_code == 200, created.text
    pid = created.json()["id"]
    try:
        for _ in range(4):
            response = requests.post(f"{API}/store/products/{pid}/view", timeout=15)
            assert response.status_code == 200, response.text
        product = requests.get(f"{API}/products/{pid}", timeout=15).json()
        assert "Trending" in product["smart_tags"]
    finally:
        requests.patch(f"{API}/tag-settings", json={"tags": original["tags"]}, timeout=15)
        requests.delete(f"{API}/products/{pid}", timeout=15)