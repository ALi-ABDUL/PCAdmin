"""Backend tests for Order Timeline product thumbnails feature.

Verifies GET /api/customers/{cid} response now carries product_id,
product_title, product_image on both order_created and status_change
timeline events, and on the recent orders list. Also validates the
null-image fallback path.
"""
import os
import uuid
import time
import pytest
import requests

def _read_frontend_env():
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    return line.split("=", 1)[1].strip()
    except Exception:
        pass
    return None

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or _read_frontend_env()).rstrip("/")
API = f"{BASE_URL}/api"


def _iso():
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


@pytest.fixture(scope="module")
def seeded():
    # Create two products - one with images, one without
    p_with_payload = {
        "title": "TEST Product With Image",
        "images": ["https://example.com/thumb1.jpg", "https://example.com/thumb2.jpg"],
        "price": 10.0,
        "stock": 100,
    }
    p_no_payload = {
        "title": "TEST Product No Image",
        "images": [],
        "price": 20.0,
        "stock": 100,
    }
    created = []
    for p in (p_with_payload, p_no_payload):
        r = requests.post(f"{API}/products", json=p)
        assert r.status_code in (200, 201), f"seed product failed: {r.status_code} {r.text}"
        created.append(r.json())
    p_with = created[0]
    p_no = created[1]

    # Create customer
    email = f"test_tl_{uuid.uuid4().hex[:8]}@example.com"
    cust = {"name": "TEST Timeline Cust", "email": email, "type": "registered", "status": "active"}
    rc = requests.post(f"{API}/customers", json=cust)
    assert rc.status_code in (200, 201), rc.text
    cid = rc.json().get("id")
    assert cid

    # Create 2 orders - one per product
    orders = []
    for p in (p_with, p_no):
        o_payload = {
            "customer_email": email,
            "customer_name": "TEST Timeline Cust",
            "product_id": p["id"],
            "quantity": 1,
            "status": "pending",
        }
        ro = requests.post(f"{API}/orders", json=o_payload)
        assert ro.status_code in (200, 201), ro.text
        oid = ro.json().get("id")
        orders.append(oid)
        # Push a status change so we have status_change events
        rs = requests.patch(f"{API}/orders/{oid}", json={"status": "processing"})
        assert rs.status_code in (200, 204), rs.text

    yield {"cid": cid, "email": email, "p_with": p_with, "p_no": p_no, "orders": orders}


class TestTimelineThumbnails:
    def test_customer_detail_returns_timeline_with_product_fields(self, seeded):
        r = requests.get(f"{API}/customers/{seeded['cid']}")
        assert r.status_code == 200
        data = r.json()
        assert "timeline" in data
        assert "orders" in data
        tl = data["timeline"]
        assert len(tl) >= 2  # at least the two created events

        # All timeline entries must carry the new fields
        for e in tl:
            assert "product_id" in e
            assert "product_title" in e
            assert "product_image" in e
            assert "order_id" in e
            assert "order_reference" in e

    def test_product_with_images_populates_image(self, seeded):
        r = requests.get(f"{API}/customers/{seeded['cid']}")
        data = r.json()
        pid = seeded["p_with"]["id"]
        expected_img = seeded["p_with"]["images"][0]
        matching = [e for e in data["timeline"] if e.get("product_id") == pid]
        assert matching, "Expected timeline events for product with images"
        for e in matching:
            assert e.get("product_image") == expected_img

    def test_product_without_images_has_null_image(self, seeded):
        r = requests.get(f"{API}/customers/{seeded['cid']}")
        data = r.json()
        pid = seeded["p_no"]["id"]
        matching = [e for e in data["timeline"] if e.get("product_id") == pid]
        assert matching
        for e in matching:
            assert e.get("product_image") in (None, "")

    def test_both_event_types_carry_product_image(self, seeded):
        r = requests.get(f"{API}/customers/{seeded['cid']}")
        data = r.json()
        pid = seeded["p_with"]["id"]
        expected_img = seeded["p_with"]["images"][0]
        created = [e for e in data["timeline"] if e.get("product_id") == pid and e.get("type") == "order_created"]
        changed = [e for e in data["timeline"] if e.get("product_id") == pid and e.get("type") == "status_change"]
        assert created, "expected an order_created event"
        assert changed, "expected a status_change event"
        assert created[0].get("product_image") == expected_img
        assert changed[0].get("product_image") == expected_img
        # Same fields on both event types for the same order
        assert created[0].get("product_id") == changed[0].get("product_id")
        assert created[0].get("product_title") == changed[0].get("product_title")

    def test_recent_orders_carry_product_image(self, seeded):
        r = requests.get(f"{API}/customers/{seeded['cid']}")
        data = r.json()
        orders = data["orders"]
        assert orders
        for o in orders:
            assert "product_image" in o
        pid_with = seeded["p_with"]["id"]
        pid_no = seeded["p_no"]["id"]
        for o in orders:
            if o.get("product_id") == pid_with:
                assert o.get("product_image") == seeded["p_with"]["images"][0]
            elif o.get("product_id") == pid_no:
                assert o.get("product_image") in (None, "")

    def test_response_efficient_single_batch(self, seeded):
        # Sanity/latency check - not a precise N+1 detector but ensures reasonable speed
        t0 = time.time()
        r = requests.get(f"{API}/customers/{seeded['cid']}")
        elapsed = time.time() - t0
        assert r.status_code == 200
        assert elapsed < 3.0, f"customer detail too slow: {elapsed:.2f}s"
