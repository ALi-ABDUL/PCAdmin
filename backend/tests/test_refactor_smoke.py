"""Iteration 7 - post-refactor smoke tests covering all endpoints called out in the review.

Verifies that the modular split (server.py + helpers.py + models.py + deps.py) preserves behaviour.
Uses REACT_APP_BACKEND_URL from frontend/.env — hits the live preview backend.
"""
import os
import time
import uuid
import pytest
import requests
from pathlib import Path

# Read frontend .env for the public backend URL
_env_path = Path("/app/frontend/.env")
BASE_URL = None
for line in _env_path.read_text().splitlines():
    if line.startswith("REACT_APP_BACKEND_URL="):
        BASE_URL = line.split("=", 1)[1].strip()
        break
assert BASE_URL, "REACT_APP_BACKEND_URL missing from /app/frontend/.env"
API = BASE_URL.rstrip("/") + "/api"


@pytest.fixture(scope="module")
def s():
    return requests.Session()


# --- scraper schedule ---
class TestScraperSchedule:
    def test_get_schedule_shape(self, s):
        r = s.get(f"{API}/scraper/schedule", timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "enabled" in data
        assert "run_history" in data
        assert isinstance(data["run_history"], list)


# --- products ---
class TestProducts:
    def test_list_products(self, s):
        r = s.get(f"{API}/products", timeout=30)
        assert r.status_code == 200
        data = r.json()
        items = data["products"] if isinstance(data, dict) else data
        assert isinstance(items, list)
        if items:
            p = items[0]
            assert "id" in p
            assert "_id" not in p

    def test_list_products_archived_filter(self, s):
        r = s.get(f"{API}/products?archived=true", timeout=30)
        assert r.status_code == 200
        data = r.json()
        items = data["products"] if isinstance(data, dict) else data
        assert isinstance(items, list)
        for p in items:
            assert p.get("archived") is True

    def test_list_products_search(self, s):
        r = s.get(f"{API}/products?search=AF21", timeout=30)
        assert r.status_code == 200
        data = r.json()
        items = data["products"] if isinstance(data, dict) else data
        assert isinstance(items, list)


# --- global search ---
class TestGlobalSearch:
    def test_search_returns_products_and_orders(self, s):
        r = s.get(f"{API}/search?q=AF21", timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert "products" in data
        assert "orders" in data
        assert isinstance(data["products"], list)
        assert isinstance(data["orders"], list)


# --- portal (aliko) ---
ALIKO = {"email": "aliko@yopmail.com", "password": "secret123"}


class TestPortal:
    @pytest.fixture(scope="class")
    def token(self, s):
        # Try login first; if unregistered, register
        r = s.post(f"{API}/portal/login", json=ALIKO, timeout=30)
        if r.status_code != 200:
            reg = s.post(f"{API}/portal/register", json=ALIKO, timeout=30)
            assert reg.status_code in (200, 201, 409), reg.text
            r = s.post(f"{API}/portal/login", json=ALIKO, timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "token" in body
        return body["token"]

    def test_me(self, s, token):
        r = s.get(f"{API}/portal/me", headers={"Authorization": f"Bearer {token}"}, timeout=30)
        assert r.status_code == 200
        assert r.json()["customer"]["email"] == ALIKO["email"]

    def test_orders_returns_three(self, s, token):
        r = s.get(f"{API}/portal/orders", headers={"Authorization": f"Bearer {token}"}, timeout=30)
        assert r.status_code == 200
        data = r.json()
        orders = data["orders"] if isinstance(data, dict) else data
        assert isinstance(orders, list)
        assert len(orders) == 3, f"Expected 3 orders for aliko, got {len(orders)}"
        statuses = sorted([o.get("status") for o in orders])
        assert "delivered" in statuses
        assert "pending" in statuses


# --- orders CRUD + status cycle ---
class TestOrders:
    def test_orders_list(self, s):
        r = s.get(f"{API}/orders", timeout=30)
        assert r.status_code == 200
        data = r.json()
        items = data["orders"] if isinstance(data, dict) else data
        assert isinstance(items, list)

    def test_status_cycle(self, s):
        prods_resp = s.get(f"{API}/products?limit=1", timeout=30).json()
        prods = prods_resp.get("products", prods_resp) if isinstance(prods_resp, dict) else prods_resp
        if not prods:
            pytest.skip("No products in db")
        pid = prods[0]["id"]
        payload = {
            "product_id": pid,
            "quantity": 1,
            "customer_name": f"TEST_cycle_{uuid.uuid4().hex[:6]}",
            "customer_email": "test_cycle@example.com",
            "status": "pending",
        }
        cr = s.post(f"{API}/orders", json=payload, timeout=30)
        assert cr.status_code in (200, 201), cr.text
        oid = cr.json()["id"]
        try:
            for st in ["processing", "shipped", "delivered"]:
                u = s.patch(f"{API}/orders/{oid}", json={"status": st}, timeout=30)
                assert u.status_code == 200, f"{st}: {u.text}"
                assert u.json()["status"] == st
                # verify persisted
                g = s.get(f"{API}/orders/{oid}", timeout=30)
                assert g.status_code == 200
                assert g.json()["status"] == st
        finally:
            s.delete(f"{API}/orders/{oid}", timeout=30)


# --- notifications + push ---
class TestNotificationsAndPush:
    def test_notifications_list(self, s):
        r = s.get(f"{API}/notifications", timeout=30)
        assert r.status_code == 200
        data = r.json()
        items = data.get("notifications", data) if isinstance(data, dict) else data
        assert isinstance(items, list)

    def test_push_settings_get(self, s):
        r = s.get(f"{API}/push/settings", timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, dict)

    def test_push_test_endpoint(self, s):
        r = s.post(f"{API}/push/test", json={}, timeout=30)
        # accept 200 (success) or 400/503 (no config), but not 500
        assert r.status_code in (200, 400, 404, 503), r.text


# --- analytics ---
class TestAnalytics:
    def test_overview(self, s):
        r = s.get(f"{API}/analytics/overview", timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, dict)

    def test_report(self, s):
        r = s.get(f"{API}/analytics/report", timeout=30)
        assert r.status_code == 200
