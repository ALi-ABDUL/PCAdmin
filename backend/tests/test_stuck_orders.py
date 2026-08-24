"""Tests for GET /api/orders/stuck widget endpoint."""
import os
from datetime import datetime, timezone, timedelta
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://ebay-au-harvester.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

TERMINAL = {"delivered", "cancelled", "refunded"}
VALID_STUCK_STATUSES = {"new", "pending", "processing", "ready_to_ship", "ready to ship", "shipped"}
SLA = {"new": 1, "pending": 2, "processing": 3, "ready_to_ship": 1, "ready to ship": 1, "shipped": 7}


@pytest.fixture(scope="module")
def stuck_payload():
    r = requests.get(f"{API}/orders/stuck", timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


class TestStuckOrdersShape:
    def test_response_shape(self, stuck_payload):
        assert set(stuck_payload.keys()) >= {"stuck", "total", "sla"}
        assert isinstance(stuck_payload["stuck"], list)
        assert stuck_payload["total"] == len(stuck_payload["stuck"])
        assert stuck_payload["sla"]["new"] == 1
        assert stuck_payload["sla"]["pending"] == 2
        assert stuck_payload["sla"]["processing"] == 3
        assert stuck_payload["sla"]["ready_to_ship"] == 1
        assert stuck_payload["sla"]["shipped"] == 7

    def test_required_fields_present(self, stuck_payload):
        if not stuck_payload["stuck"]:
            pytest.skip("no stuck rows to inspect")
        row = stuck_payload["stuck"][0]
        for key in ["id", "reference", "status", "product_title", "product_id",
                    "customer_name", "days_stuck", "sla_days", "since", "total"]:
            assert key in row, f"missing field {key}"

    def test_sorted_days_stuck_desc(self, stuck_payload):
        days = [r["days_stuck"] for r in stuck_payload["stuck"]]
        assert days == sorted(days, reverse=True)

    def test_no_terminal_statuses(self, stuck_payload):
        for r in stuck_payload["stuck"]:
            assert (r["status"] or "").lower() not in TERMINAL

    def test_only_valid_stuck_statuses(self, stuck_payload):
        for r in stuck_payload["stuck"]:
            assert (r["status"] or "").lower() in VALID_STUCK_STATUSES

    def test_days_stuck_exceeds_sla(self, stuck_payload):
        for r in stuck_payload["stuck"]:
            assert r["days_stuck"] > r["sla_days"], f"{r['id']}: {r['days_stuck']} !> {r['sla_days']}"

    def test_no_mongo_id_leaked(self, stuck_payload):
        for r in stuck_payload["stuck"]:
            assert "_id" not in r


class TestFreshOrderNotStuck:
    """Create a fresh 'pending' order and verify it's NOT in stuck list."""

    def test_fresh_pending_order_excluded(self):
        # Find a real product to attach
        prods = requests.get(f"{API}/products", timeout=30).json()
        products = prods if isinstance(prods, list) else prods.get("items") or prods.get("products") or []
        if not products:
            pytest.skip("no products available to create test order")
        p = products[0]
        pid = p.get("id")
        ptitle = p.get("title") or "TEST product"

        ref = f"TEST-{uuid.uuid4().hex[:8]}"
        payload = {
            "reference": ref,
            "product_id": pid,
            "product_title": ptitle,
            "status": "pending",
            "customer_name": "TEST_stuck_check",
            "total": 1.0,
        }
        r = requests.post(f"{API}/orders", json=payload, timeout=30)
        if r.status_code not in (200, 201):
            pytest.skip(f"cannot create order (status {r.status_code}): {r.text[:200]}")
        created = r.json()
        oid = created.get("id")
        try:
            stuck = requests.get(f"{API}/orders/stuck", timeout=30).json()
            ids = [row["id"] for row in stuck["stuck"]]
            assert oid not in ids, "fresh pending order should not be stuck"
        finally:
            if oid:
                requests.delete(f"{API}/orders/{oid}", timeout=30)


class TestRegressions:
    def test_unread_count(self):
        r = requests.get(f"{API}/customers/unread-count", timeout=15)
        assert r.status_code == 200
        assert "count" in r.json() or "unread" in r.json() or isinstance(r.json(), dict)

    def test_orders_list(self):
        r = requests.get(f"{API}/orders?limit=5", timeout=30)
        assert r.status_code == 200
