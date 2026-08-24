"""Tests for the 'N days in status' chip metadata on customer timeline events."""
import os
import uuid
import pytest
import requests
from datetime import datetime, timezone

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def customer(session):
    email = f"TEST_dis_{uuid.uuid4().hex[:8]}@example.com"
    r = session.post(f"{API}/customers", json={"name": "TEST DIS", "email": email})
    assert r.status_code == 200, r.text
    c = r.json()
    yield c
    session.delete(f"{API}/customers/{c['id']}")


@pytest.fixture(scope="module")
def product_id(session):
    r = session.get(f"{API}/products?limit=1")
    if r.status_code == 200 and r.json().get("products"):
        return r.json()["products"][0]["id"]
    # create a product
    r = session.post(f"{API}/products", json={
        "title": "TEST DIS product", "price": 10.0, "cost": 5.0, "stock": 100,
        "category": "other", "description": ""
    })
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]


def _create_order(session, email, product_id, name="TEST DIS"):
    body = {
        "product_id": product_id,
        "quantity": 1,
        "customer_name": name,
        "customer_email": email,
        "status": "paid",
    }
    r = session.post(f"{API}/orders", json=body)
    assert r.status_code in (200, 201), r.text
    return r.json()


def _get_timeline(session, cid):
    r = session.get(f"{API}/customers/{cid}")
    assert r.status_code == 200, r.text
    return r.json()["timeline"]


def test_paid_order_has_current_status_on_creation(session, customer, product_id):
    """Freshly-created paid order: order_created event must have is_current_status=true, days=0."""
    o = _create_order(session, customer["email"], product_id)
    tl = _get_timeline(session, customer["id"])
    events = [e for e in tl if e.get("order_id") == o["id"]]
    assert len(events) == 1
    e = events[0]
    assert e["type"] == "order_created"
    assert e.get("is_current_status") is True
    assert e.get("days_in_status") == 0
    assert isinstance(e.get("hours_in_status"), int)


def test_status_change_moves_current_flag(session, customer, product_id):
    """After PATCH to shipped, the shipped event is current and order_created is not."""
    o = _create_order(session, customer["email"], product_id)
    r = session.patch(f"{API}/orders/{o['id']}", json={"status": "shipped"})
    assert r.status_code == 200, r.text
    tl = _get_timeline(session, customer["id"])
    events = [e for e in tl if e.get("order_id") == o["id"]]
    # newest first
    shipped = next((e for e in events if e.get("type") == "status_change" and e.get("to") == "shipped"), None)
    created = next((e for e in events if e.get("type") == "order_created"), None)
    assert shipped is not None and created is not None
    assert shipped.get("is_current_status") is True
    assert "days_in_status" in shipped
    assert not created.get("is_current_status")
    assert "days_in_status" not in created


def test_terminal_status_removes_all_chips(session, customer, product_id):
    """Once delivered, none of the order's events should carry days_in_status/is_current_status."""
    o = _create_order(session, customer["email"], product_id)
    session.patch(f"{API}/orders/{o['id']}", json={"status": "shipped"})
    r = session.patch(f"{API}/orders/{o['id']}", json={"status": "delivered"})
    assert r.status_code == 200
    tl = _get_timeline(session, customer["id"])
    events = [e for e in tl if e.get("order_id") == o["id"]]
    assert len(events) >= 2
    for e in events:
        assert not e.get("is_current_status"), f"terminal order should not tag {e}"
        assert "days_in_status" not in e


def test_cancelled_and_refunded_are_terminal(session, customer, product_id):
    for terminal in ("cancelled", "refunded"):
        o = _create_order(session, customer["email"], product_id)
        r = session.patch(f"{API}/orders/{o['id']}", json={"status": terminal})
        assert r.status_code == 200
        tl = _get_timeline(session, customer["id"])
        events = [e for e in tl if e.get("order_id") == o["id"]]
        for e in events:
            assert not e.get("is_current_status"), f"{terminal}: {e}"


def test_multiple_open_orders_each_tagged(session, customer, product_id):
    """Each open order should independently tag its latest event."""
    o1 = _create_order(session, customer["email"], product_id)
    o2 = _create_order(session, customer["email"], product_id)
    session.patch(f"{API}/orders/{o2['id']}", json={"status": "shipped"})
    tl = _get_timeline(session, customer["id"])
    for oid in (o1["id"], o2["id"]):
        current = [e for e in tl if e.get("order_id") == oid and e.get("is_current_status")]
        assert len(current) == 1, f"expected exactly one current event for {oid}, got {current}"


def test_older_order_created_untagged_after_status_change(session, customer, product_id):
    """After a status change, the older order_created event stays untagged."""
    o = _create_order(session, customer["email"], product_id)
    session.patch(f"{API}/orders/{o['id']}", json={"status": "processing"})
    tl = _get_timeline(session, customer["id"])
    created = next(e for e in tl if e.get("order_id") == o["id"] and e.get("type") == "order_created")
    assert not created.get("is_current_status")
    assert "days_in_status" not in created
