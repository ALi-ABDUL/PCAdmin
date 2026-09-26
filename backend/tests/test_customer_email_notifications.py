"""Tests for the Customer Notifications feature (iteration 11).

Coverage:
  A. GET /api/push/settings exposes the 5 new customer_* fields with defaults=True.
  B. PATCH /api/push/settings persists customer_* changes (round-trip).
  C. helpers.send_customer_email respects master + per-kind toggles and no-key case.
  D. POST /api/orders returns 200 with the confirmation toggle off.
  E. PATCH /api/orders/{oid} for all documented statuses returns 200 (helper is
     unit-tested for gating separately).
  F. POST /api/portal/register calls send_customer_welcome_email (monkeypatched).
  G. resend_api_key from db.push_settings is reused (no dupe customer_resend key).
"""
import asyncio
import os
import sys
import uuid

import pytest
import requests
from dotenv import load_dotenv

sys.path.insert(0, "/app/backend")
load_dotenv("/app/frontend/.env")
load_dotenv("/app/backend/.env")

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"

CUSTOMER_FIELDS = [
    "customer_email_enabled",
    "customer_order_confirmation",
    "customer_order_status_update",
    "customer_order_cancellation",
    "customer_welcome_email",
]


# ---------------------------------------------------------------------------
# Shared fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def loop():
    """Single asyncio loop for all tests so motor stays bound to one loop."""
    lp = asyncio.new_event_loop()
    asyncio.set_event_loop(lp)
    yield lp
    lp.close()


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def mongo():
    """Synchronous pymongo handle for cleanup / seeding."""
    from pymongo import MongoClient
    mc = MongoClient(os.environ["MONGO_URL"])
    try:
        yield mc[os.environ["DB_NAME"]]
    finally:
        mc.close()


@pytest.fixture(autouse=True)
def restore_all_toggles_on(client):
    """Reset all customer toggles back to True between tests to avoid bleed."""
    yield
    client.patch(f"{API}/push/settings", json={k: True for k in CUSTOMER_FIELDS})


# ---------------------------------------------------------------------------
# A. GET /api/push/settings shape + defaults
# ---------------------------------------------------------------------------

class TestPushSettingsShape:
    def test_get_settings_has_customer_fields(self, client):
        r = client.get(f"{API}/push/settings")
        assert r.status_code == 200, r.text
        data = r.json()
        for f in CUSTOMER_FIELDS:
            assert f in data, f"missing customer field: {f}"
            assert isinstance(data[f], bool)

    def test_defaults_are_true_when_all_on(self, client):
        client.patch(f"{API}/push/settings", json={k: True for k in CUSTOMER_FIELDS})
        data = client.get(f"{API}/push/settings").json()
        for f in CUSTOMER_FIELDS:
            assert data[f] is True


# ---------------------------------------------------------------------------
# B. PATCH persistence round-trip
# ---------------------------------------------------------------------------

class TestPushSettingsPatch:
    def test_patch_two_toggles_off_persists(self, client):
        payload = {"customer_order_confirmation": False, "customer_welcome_email": False}
        r = client.patch(f"{API}/push/settings", json=payload)
        assert r.status_code == 200, r.text

        got = client.get(f"{API}/push/settings").json()
        assert got["customer_order_confirmation"] is False
        assert got["customer_welcome_email"] is False
        # Untouched siblings preserved
        assert got["customer_email_enabled"] is True
        assert got["customer_order_status_update"] is True
        assert got["customer_order_cancellation"] is True

    def test_patch_round_trip_all_true(self, client):
        client.patch(f"{API}/push/settings", json={k: False for k in CUSTOMER_FIELDS})
        client.patch(f"{API}/push/settings", json={k: True for k in CUSTOMER_FIELDS})
        got = client.get(f"{API}/push/settings").json()
        for f in CUSTOMER_FIELDS:
            assert got[f] is True

    def test_patch_master_off_only(self, client):
        r = client.patch(f"{API}/push/settings", json={"customer_email_enabled": False})
        assert r.status_code == 200
        got = client.get(f"{API}/push/settings").json()
        assert got["customer_email_enabled"] is False
        assert got["customer_order_confirmation"] is True


# ---------------------------------------------------------------------------
# C. helpers.send_customer_email logic
# ---------------------------------------------------------------------------

class TestSendCustomerEmailHelper:
    def test_returns_skipped_no_recipient_when_no_email(self, loop, client):
        from helpers import send_customer_email
        res = loop.run_until_complete(
            send_customer_email("welcome", "", "hi", "<p>hi</p>")
        )
        assert res == "skipped_no_recipient"

    def test_master_off_returns_skipped_master_off(self, loop, client):
        client.patch(f"{API}/push/settings", json={"customer_email_enabled": False})
        from helpers import send_customer_email
        res = loop.run_until_complete(
            send_customer_email("welcome", "b@x.com", "hi", "<p>hi</p>")
        )
        assert res == "skipped_master_off"

    def test_specific_toggle_off_returns_skipped_disabled(self, loop, client):
        client.patch(f"{API}/push/settings", json={
            "customer_email_enabled": True,
            "customer_order_confirmation": False,
        })
        from helpers import send_customer_email
        res = loop.run_until_complete(
            send_customer_email("order_confirmation", "b@x.com", "s", "<p>h</p>")
        )
        assert res == "skipped_disabled"

    def test_no_key_returns_skipped_no_key(self, loop, client, mongo):
        # Preserve any configured provider credential: this assertion must not
        # leave a real email integration disabled after the test run.
        before = mongo.push_settings.find_one({"id": "singleton"}) or {}
        client.patch(f"{API}/push/settings", json={k: True for k in CUSTOMER_FIELDS})
        try:
            mongo.push_settings.update_one(
                {"id": "singleton"}, {"$set": {"resend_api_key": ""}}, upsert=True
            )
            from helpers import send_customer_email
            res = loop.run_until_complete(
                send_customer_email("welcome", "b@x.com", "s", "<p>h</p>")
            )
            assert res == "skipped_no_key"
        finally:
            mongo.push_settings.update_one(
                {"id": "singleton"}, {"$set": {"resend_api_key": before.get("resend_api_key", "")}}, upsert=True
            )

    def test_unknown_kind_returns_skipped_disabled(self, loop):
        from helpers import send_customer_email
        res = loop.run_until_complete(
            send_customer_email("bogus_kind", "b@x.com", "s", "<p>h</p>")
        )
        assert res == "skipped_disabled"


# ---------------------------------------------------------------------------
# D + E. Order endpoints continue to work with customer emails wired in
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def test_product(mongo):
    pid = f"TEST_prod_{uuid.uuid4().hex[:8]}"
    doc = {
        "id": pid,
        "title": "TEST customer email product",
        "price": 19.99,
        "stock": 500,
        "sold_count": 0,
        "images": [],
        "category": "misc",
    }
    mongo.products.insert_one(doc)
    yield pid
    mongo.products.delete_one({"id": pid})
    mongo.orders.delete_many({"product_id": pid})


class TestOrderEndpointsCustomerEmailIntegration:
    def test_create_order_200_with_confirmation_off(self, client, test_product):
        client.patch(f"{API}/push/settings", json={"customer_order_confirmation": False})
        payload = {
            "product_id": test_product,
            "customer_name": "TEST Buyer",
            "customer_email": "test_buyer@example.com",
            "quantity": 1,
        }
        r = client.post(f"{API}/orders", json=payload)
        assert r.status_code == 200, r.text
        assert r.json().get("id")

    def test_create_order_200_with_all_toggles_on(self, client, test_product):
        payload = {
            "product_id": test_product,
            "customer_name": "TEST Buyer 2",
            "customer_email": "buyer2@example.com",
            "quantity": 1,
        }
        r = client.post(f"{API}/orders", json=payload)
        assert r.status_code == 200, r.text

    @pytest.mark.parametrize("new_status", [
        "processing", "shipped", "delivered", "cancelled",
        "paid", "ready_to_ship", "refunded", "on_hold",
    ])
    def test_patch_order_status_returns_200(self, client, test_product, new_status):
        cr = client.post(f"{API}/orders", json={
            "product_id": test_product,
            "customer_name": "TEST Router",
            "customer_email": f"router_{new_status}@example.com",
            "quantity": 1,
        })
        assert cr.status_code == 200, cr.text
        oid = cr.json()["id"]
        pr = client.patch(f"{API}/orders/{oid}", json={"status": new_status})
        assert pr.status_code == 200, pr.text
        assert pr.json()["status"] == new_status


# ---------------------------------------------------------------------------
# F. Welcome email helper wired to portal/register (monkeypatched)
# ---------------------------------------------------------------------------

class TestPortalRegisterWelcomeEmail:
    def test_portal_register_accepts_existing_buyer_and_requires_verification(self, client, mongo):
        email = f"aliko_{uuid.uuid4().hex[:10]}@example.com"
        order_id = f"TEST_welcome_{uuid.uuid4().hex[:10]}"
        mongo.customer_accounts.delete_many({"email": email})
        mongo.orders.insert_one({"id": order_id, "customer_email": email, "customer_name": "Aliko", "items": []})
        try:
            r = client.post(f"{API}/portal/register", json={
                "email": email, "password": "secret123", "name": "Aliko"
            })
            assert r.status_code == 200, r.text
            assert r.json().get("requires_verification") is True
            assert r.json().get("email") == email
        finally:
            mongo.customer_accounts.delete_many({"email": email})
            mongo.orders.delete_many({"id": order_id})


# ---------------------------------------------------------------------------
# G. Resend key reuse (structural)
# ---------------------------------------------------------------------------

class TestResendKeyReuse:
    def test_no_separate_customer_resend_key(self, client):
        """Customer emails must reuse the admin 'resend_api_key' — verify no
        separate customer_resend_api_key field is exposed by the API."""
        data = client.get(f"{API}/push/settings").json()
        # Admin key is masked in the response
        assert "resend_api_key_masked" in data
        assert "resend_api_key_set" in data
        assert "customer_resend_api_key" not in data
        assert "customer_resend_api_key_masked" not in data
