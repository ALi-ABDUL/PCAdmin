"""Tests for GET /api/customers/{cid} endpoint - returns customer + last 25 orders."""
import os
import uuid
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/") or "https://ebay-au-harvester.preview.emergentagent.com"
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def sample_customer_id():
    r = requests.get(f"{API}/customers", params={"limit": 1})
    assert r.status_code == 200
    data = r.json()
    customers = data.get("customers") or []
    if not customers:
        # create one
        cr = requests.post(f"{API}/customers", json={"name": "TEST_customer", "email": "test_customer@example.com"})
        assert cr.status_code == 200
        return cr.json()["id"]
    return customers[0]["id"]


def test_get_customer_detail_success(sample_customer_id):
    r = requests.get(f"{API}/customers/{sample_customer_id}")
    assert r.status_code == 200, r.text
    data = r.json()
    assert "customer" in data
    assert "orders" in data
    assert data["customer"]["id"] == sample_customer_id
    assert isinstance(data["orders"], list)
    assert len(data["orders"]) <= 25


def test_get_customer_detail_404_on_unknown():
    r = requests.get(f"{API}/customers/{uuid.uuid4().hex}")
    assert r.status_code == 404


def test_customer_detail_orders_have_expected_fields(sample_customer_id):
    r = requests.get(f"{API}/customers/{sample_customer_id}")
    assert r.status_code == 200
    orders = r.json().get("orders") or []
    for o in orders[:3]:
        # id/reference/status/total/created_at expected
        assert "id" in o
        assert "reference" in o
        assert "status" in o


def test_patch_customer_persists(sample_customer_id):
    new_name = f"TEST_UPDATED_{uuid.uuid4().hex[:6]}"
    r = requests.patch(f"{API}/customers/{sample_customer_id}", json={"name": new_name})
    assert r.status_code == 200
    # verify via detail
    d = requests.get(f"{API}/customers/{sample_customer_id}")
    assert d.status_code == 200
    assert d.json()["customer"]["name"] == new_name
