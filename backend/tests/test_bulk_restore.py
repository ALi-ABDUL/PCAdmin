"""Tests for POST /api/products/bulk-restore and the archived product bulk workflows."""
import os
import uuid
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"


def _make_product(title_prefix="TEST_bulkrestore"):
    body = {
        "title": f"{title_prefix}_{uuid.uuid4().hex[:8]}",
        "price": 9.99,
        "cost": 5.0,
        "stock": 1,
        "category": "misc",
    }
    r = requests.post(f"{API}/products", json=body, timeout=15)
    assert r.status_code in (200, 201), f"Create product failed: {r.status_code} {r.text}"
    return r.json()


@pytest.fixture
def archived_ids():
    ids = [_make_product()["id"] for _ in range(3)]
    r = requests.post(f"{API}/products/bulk-archive", json={"product_ids": ids}, timeout=15)
    assert r.status_code == 200
    assert r.json().get("archived") == 3
    yield ids
    # cleanup
    requests.post(f"{API}/products/bulk-delete", json={"product_ids": ids}, timeout=15)


def test_bulk_restore_empty():
    r = requests.post(f"{API}/products/bulk-restore", json={"product_ids": []}, timeout=15)
    assert r.status_code == 200
    assert r.json() == {"restored": 0}


def test_bulk_restore_moves_to_active(archived_ids):
    # Confirm archived listing includes them
    r = requests.get(f"{API}/products", params={"archived": True}, timeout=15)
    assert r.status_code == 200
    archived_listed = {p["id"] for p in r.json().get("products", [])}
    for pid in archived_ids:
        assert pid in archived_listed

    # Restore first 2
    to_restore = archived_ids[:2]
    r = requests.post(f"{API}/products/bulk-restore", json={"product_ids": to_restore}, timeout=15)
    assert r.status_code == 200
    assert r.json().get("restored") == 2

    # Verify restored fields
    for pid in to_restore:
        p = requests.get(f"{API}/products/{pid}", timeout=15).json()
        assert p.get("archived") is False
        assert p.get("active") is True
        assert "archived_at" not in p or p.get("archived_at") in (None, "")

    # Third one still archived
    p3 = requests.get(f"{API}/products/{archived_ids[2]}", timeout=15).json()
    assert p3.get("archived") is True


def test_bulk_delete_permanent(archived_ids):
    to_delete = archived_ids[:2]
    r = requests.post(f"{API}/products/bulk-delete", json={"product_ids": to_delete}, timeout=15)
    assert r.status_code == 200
    assert r.json().get("deleted") == 2
    for pid in to_delete:
        g = requests.get(f"{API}/products/{pid}", timeout=15)
        assert g.status_code == 404
