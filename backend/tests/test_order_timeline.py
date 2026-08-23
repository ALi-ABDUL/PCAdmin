"""Tests for the customer profile order timeline feature.

Covers:
- PATCH /api/orders/{oid} appends status_history only on status change
- GET /api/customers/{cid} returns timeline (order_created + status_change),
  sorted newest first
- Empty case: customer with no orders => timeline = []
"""
import os
import time
import uuid
import pytest
import requests

def _load_frontend_env():
    try:
        with open("/app/frontend/.env") as fh:
            for line in fh:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    return line.split("=", 1)[1].strip()
    except FileNotFoundError:
        pass
    return None

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or _load_frontend_env()).rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def product(session):
    """Reuse any existing product; if none exists, skip."""
    r = session.get(f"{API}/products?limit=1")
    assert r.status_code == 200, r.text
    products = r.json().get("products") or r.json().get("items") or []
    if not products:
        pytest.skip("No products seeded to attach orders to")
    return products[0]


@pytest.fixture(scope="module")
def seeded(session, product):
    """Create a fresh customer + 1 order + drive status transitions."""
    email = f"test_timeline_{uuid.uuid4().hex[:8]}@example.com"
    cr = session.post(f"{API}/customers", json={"name": "TEST Timeline", "email": email})
    assert cr.status_code in (200, 201), cr.text
    customer = cr.json()
    cid = customer["id"]

    # Create order
    order_payload = {
        "product_id": product["id"],
        "customer_email": email,
        "customer_name": "TEST Timeline",
    }
    o = session.post(f"{API}/orders", json=order_payload)
    assert o.status_code in (200, 201), o.text
    order = o.json()
    oid = order["id"]

    # Transition status: pending -> processing -> shipped -> delivered
    for s in ["processing", "shipped", "delivered"]:
        time.sleep(0.05)  # ensure timestamps differ
        pr = session.patch(f"{API}/orders/{oid}", json={"status": s})
        assert pr.status_code == 200, pr.text

    yield {"cid": cid, "oid": oid, "email": email, "initial_status": order.get("status")}


class TestPatchOrderStatusHistory:
    def test_status_history_appended_on_change(self, session, seeded):
        r = session.get(f"{API}/orders/{seeded['oid']}")
        assert r.status_code == 200
        order = r.json()
        hist = order.get("status_history") or []
        # We drove 3 transitions
        assert len(hist) >= 3, f"expected >=3 status_history rows, got {hist}"
        tos = [h["to"] for h in hist]
        assert tos[-3:] == ["processing", "shipped", "delivered"]
        for h in hist[-3:]:
            assert "from" in h and "to" in h and "changed_at" in h

    def test_status_history_not_touched_on_non_status_patch(self, session, seeded):
        r_before = session.get(f"{API}/orders/{seeded['oid']}")
        before_hist = r_before.json().get("status_history") or []

        # Patch something that is not the status (or set same status)
        pr = session.patch(
            f"{API}/orders/{seeded['oid']}",
            json={"customer_name": "TEST Timeline Renamed"},
        )
        assert pr.status_code == 200
        after_hist = pr.json().get("status_history") or []
        assert after_hist == before_hist, "status_history changed on non-status PATCH"

        # Patch with same status -> also not appended
        current_status = pr.json().get("status")
        pr2 = session.patch(f"{API}/orders/{seeded['oid']}", json={"status": current_status})
        assert pr2.status_code == 200
        assert (pr2.json().get("status_history") or []) == before_hist


class TestCustomerTimeline:
    def test_timeline_shape_and_events(self, session, seeded):
        r = session.get(f"{API}/customers/{seeded['cid']}")
        assert r.status_code == 200
        data = r.json()
        assert "timeline" in data
        tl = data["timeline"]
        # 1 order_created + 3 status_change
        creates = [e for e in tl if e["type"] == "order_created"]
        changes = [e for e in tl if e["type"] == "status_change"]
        assert len(creates) == 1
        assert len(changes) >= 3
        c = creates[0]
        for k in ("order_reference", "status", "total", "product_title", "ts"):
            assert k in c, f"order_created missing key {k}"
        for ch in changes:
            for k in ("from", "to", "order_reference", "ts"):
                assert k in ch, f"status_change missing key {k}"

    def test_timeline_sorted_newest_first(self, session, seeded):
        data = session.get(f"{API}/customers/{seeded['cid']}").json()
        ts_list = [e.get("ts") or "" for e in data["timeline"]]
        assert ts_list == sorted(ts_list, reverse=True), f"timeline not newest-first: {ts_list}"

    def test_empty_customer_has_empty_timeline(self, session):
        email = f"TEST_empty_{uuid.uuid4().hex[:8]}@example.com"
        cr = session.post(f"{API}/customers", json={"name": "TEST Empty", "email": email})
        assert cr.status_code in (200, 201)
        cid = cr.json()["id"]
        r = session.get(f"{API}/customers/{cid}")
        assert r.status_code == 200
        assert r.json().get("timeline") == []
