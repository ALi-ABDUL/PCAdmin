"""Smart Product Tags feature contract tests.

Modules/features covered:
- /api/tag-settings read+patch validation/persistence
- /api/products and /api/store/products smart-tag payload contracts
- /api/store/products/{id}/view anonymous view recording for Hot tag
"""

from __future__ import annotations

import os
import pathlib
import time
import uuid
import fcntl
from datetime import datetime, timedelta, timezone

import pytest
import requests


BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    for line in pathlib.Path("/app/frontend/.env").read_text().splitlines():
        if line.startswith("REACT_APP_BACKEND_URL="):
            BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
API = f"{BASE_URL}/api"

TAG_IDS = {"new", "hot", "bestseller", "deal", "top", "limited"}


@pytest.fixture(scope="module", autouse=True)
def tag_settings_lock():
    """Serialise singleton mutations when this suite runs under xdist."""
    with open("/tmp/pcadmin-smart-tag-tests.lock", "w") as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        yield
        fcntl.flock(lock.fileno(), fcntl.LOCK_UN)


def _future_iso(seconds: int = 90) -> str:
    return (datetime.now(timezone.utc) + timedelta(seconds=seconds)).isoformat()


def _new_product_payload() -> dict:
    token = uuid.uuid4().hex[:8]
    return {
        "title": f"TEST Smart Contract {token}",
        "price": 129.0,
        "cost": 79.0,
        "stock": 3,
        "category": "other",
        "sku": f"test-smart-{token}",
        "tags": ["alpha", "beta"],
    }


@pytest.fixture()
def tag_settings_restore():
    original = requests.get(f"{API}/tag-settings", timeout=20)
    assert original.status_code == 200, original.text
    original_tags = original.json().get("tags", {})
    yield original_tags
    requests.patch(f"{API}/tag-settings", json={"tags": original_tags}, timeout=20)


@pytest.fixture()
def product_cleanup():
    created_ids: list[str] = []
    yield created_ids
    for pid in created_ids:
        requests.delete(f"{API}/products/{pid}", timeout=20)


def test_tag_settings_seed_shape_and_patch_validation(tag_settings_restore):
    data = requests.get(f"{API}/tag-settings", timeout=20)
    assert data.status_code == 200, data.text
    body = data.json()
    assert set((body.get("tags") or {}).keys()) == TAG_IDS

    bad_id = requests.patch(
        f"{API}/tag-settings",
        json={"tags": {"unknown": {"enabled": True, "label": "Oops"}}},
        timeout=20,
    )
    assert bad_id.status_code == 400

    bad_empty_label = requests.patch(
        f"{API}/tag-settings",
        json={"tags": {"new": {"label": "   "}}},
        timeout=20,
    )
    assert bad_empty_label.status_code == 400

    bad_long_label = requests.patch(
        f"{API}/tag-settings",
        json={"tags": {"new": {"label": "x" * 41}}},
        timeout=20,
    )
    assert bad_long_label.status_code == 400


def test_admin_product_contract_and_rule_tags(tag_settings_restore, product_cleanup):
    patched = requests.patch(
        f"{API}/tag-settings",
        json={
            "tags": {
                "new": {"enabled": True, "label": "Fresh"},
                "limited": {"enabled": True, "label": "Low Left"},
                "deal": {"enabled": True, "label": "Deal"},
            }
        },
        timeout=20,
    )
    assert patched.status_code == 200, patched.text

    created = requests.post(f"{API}/products", json=_new_product_payload(), timeout=20)
    assert created.status_code == 200, created.text
    pid = created.json()["id"]
    product_cleanup.append(pid)

    toggle_deal = requests.patch(
        f"{API}/products/{pid}",
        json={"deal_enabled": True, "deal_ends_at": _future_iso(120)},
        timeout=20,
    )
    assert toggle_deal.status_code == 200, toggle_deal.text

    one = requests.get(f"{API}/products/{pid}", timeout=20)
    assert one.status_code == 200, one.text
    body = one.json()

    assert body["tags"] == ["alpha", "beta"]
    assert body["seo_tags"] == ["alpha", "beta"]
    assert isinstance(body.get("smart_tags"), list)
    assert isinstance(body.get("smart_tag_ids"), list)
    assert "Fresh" in body["smart_tags"]
    assert "Low Left" in body["smart_tags"]
    assert "Deal" in body["smart_tags"]

    all_products = requests.get(f"{API}/products", params={"limit": 30}, timeout=20)
    assert all_products.status_code == 200, all_products.text
    picked = next((p for p in all_products.json().get("products", []) if p.get("id") == pid), None)
    assert picked is not None
    assert picked["tags"] == ["alpha", "beta"]
    assert picked["seo_tags"] == ["alpha", "beta"]
    assert "Fresh" in picked["smart_tags"]


def test_storefront_contract_and_tag_disable_suppression(tag_settings_restore, product_cleanup):
    created = requests.post(f"{API}/products", json=_new_product_payload(), timeout=20)
    assert created.status_code == 200, created.text
    pid = created.json()["id"]
    product_cleanup.append(pid)

    up = requests.patch(
        f"{API}/products/{pid}",
        json={"deal_enabled": True, "deal_ends_at": _future_iso(120)},
        timeout=20,
    )
    assert up.status_code == 200, up.text

    baseline = requests.get(f"{API}/store/products/{pid}", timeout=20)
    assert baseline.status_code == 200, baseline.text
    one = baseline.json()
    assert isinstance(one.get("tags"), list)
    assert isinstance(one.get("smart_tag_ids"), list)
    assert one.get("seo_tags") == ["alpha", "beta"]
    assert "deal_ends_at" in one

    disabled = requests.patch(
        f"{API}/tag-settings",
        json={"tags": {"deal": {"enabled": False, "label": "Deal"}}},
        timeout=20,
    )
    assert disabled.status_code == 200, disabled.text

    hidden = requests.get(f"{API}/store/products/{pid}", timeout=20)
    assert hidden.status_code == 200, hidden.text
    hidden_body = hidden.json()
    assert "deal" not in hidden_body.get("smart_tag_ids", [])
    assert "Deal" not in hidden_body.get("tags", [])


def test_deal_tag_auto_expires(tag_settings_restore, product_cleanup):
    requests.patch(
        f"{API}/tag-settings",
        json={"tags": {"deal": {"enabled": True, "label": "Deal"}}},
        timeout=20,
    )
    created = requests.post(f"{API}/products", json=_new_product_payload(), timeout=20)
    assert created.status_code == 200, created.text
    pid = created.json()["id"]
    product_cleanup.append(pid)

    expires_soon = _future_iso(4)
    up = requests.patch(
        f"{API}/products/{pid}",
        json={"deal_enabled": True, "deal_ends_at": expires_soon},
        timeout=20,
    )
    assert up.status_code == 200, up.text

    first = requests.get(f"{API}/store/products/{pid}", timeout=20)
    assert first.status_code == 200, first.text
    assert "deal" in first.json().get("smart_tag_ids", [])

    time.sleep(6)
    after = requests.get(f"{API}/store/products/{pid}", timeout=20)
    assert after.status_code == 200, after.text
    assert "deal" not in after.json().get("smart_tag_ids", [])


def test_store_view_endpoint_is_anonymous_and_hot_rule_updates(tag_settings_restore, product_cleanup):
    requests.patch(
        f"{API}/tag-settings",
        json={"tags": {"hot": {"enabled": True, "label": "Trending"}}},
        timeout=20,
    )

    created = requests.post(f"{API}/products", json=_new_product_payload(), timeout=20)
    assert created.status_code == 200, created.text
    pid = created.json()["id"]
    product_cleanup.append(pid)

    for _ in range(40):
        view = requests.post(f"{API}/store/products/{pid}/view", timeout=20)
        assert view.status_code == 200, view.text
        assert view.json().get("recorded") is True

    admin = requests.get(f"{API}/products/{pid}", timeout=20)
    assert admin.status_code == 200, admin.text
    assert "Trending" in admin.json().get("smart_tags", [])

    missing = requests.post(f"{API}/store/products/does-not-exist/view", timeout=20)
    assert missing.status_code == 404
