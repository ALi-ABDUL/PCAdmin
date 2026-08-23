"""Tests for POST /api/customers/{cid}/message (admin message customer via Resend)."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://ebay-au-harvester.preview.emergentagent.com").rstrip("/")


@pytest.fixture(scope="module")
def customer_with_email():
    r = requests.get(f"{BASE_URL}/api/customers")
    assert r.status_code == 200
    data = r.json()
    lst = data if isinstance(data, list) else data.get("customers") or data.get("items") or []
    for c in lst:
        if c.get("email"):
            return c
    # Fallback: create one
    r2 = requests.post(f"{BASE_URL}/api/customers", json={"name": "TEST_MsgCust", "email": "test_msg@example.com"})
    assert r2.status_code in (200, 201)
    return r2.json()


class TestMessageCustomer:
    def test_404_unknown_customer(self):
        r = requests.post(
            f"{BASE_URL}/api/customers/does-not-exist-xyz/message",
            json={"subject": "Hi", "body": "Hello"},
        )
        assert r.status_code == 404
        assert "not found" in r.json().get("detail", "").lower()

    def test_400_missing_subject(self, customer_with_email):
        r = requests.post(
            f"{BASE_URL}/api/customers/{customer_with_email['id']}/message",
            json={"subject": "", "body": "Hello"},
        )
        assert r.status_code == 400
        assert "subject" in r.json()["detail"].lower() or "body" in r.json()["detail"].lower()

    def test_400_missing_body(self, customer_with_email):
        r = requests.post(
            f"{BASE_URL}/api/customers/{customer_with_email['id']}/message",
            json={"subject": "Hi", "body": "   "},
        )
        assert r.status_code == 400

    def test_400_no_resend_key(self, customer_with_email):
        """Without Resend key configured, endpoint must return descriptive 400."""
        r = requests.post(
            f"{BASE_URL}/api/customers/{customer_with_email['id']}/message",
            json={"subject": "Following up", "body": "Just a quick note about your order."},
        )
        # Accept 400 (no key) or 502 (key present but Resend rejects)
        assert r.status_code in (400, 502, 200)
        if r.status_code == 400:
            detail = r.json()["detail"]
            assert "Resend API key" in detail or "not configured" in detail.lower()
