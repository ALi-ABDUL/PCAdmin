"""Tests for sidebar unread-customer-count endpoint."""
import os
import uuid
import time
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://ebay-au-harvester.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _get_count(client) -> int:
    r = client.get(f"{API}/customers/unread-count", timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "count" in data
    assert isinstance(data["count"], int)
    return data["count"]


def test_endpoint_shape(api_client):
    r = api_client.get(f"{API}/customers/unread-count", timeout=15)
    assert r.status_code == 200
    data = r.json()
    assert set(data.keys()) >= {"count"}
    assert isinstance(data["count"], int) and data["count"] >= 0


def test_new_inbound_increments_count(api_client):
    baseline = _get_count(api_client)
    email = f"TEST_unread_{uuid.uuid4().hex[:8]}@example.com"
    payload = {
        "customer_name": "Unread Tester",
        "customer_email": email,
        "subject": "Where is my order?",
        "body": "Hi team, I have a question.",
    }
    r = api_client.post(f"{API}/messages", json=payload, timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["customer_email"] == email.lower()
    # Give aggregation a moment (in-memory but safe)
    time.sleep(0.5)
    new_count = _get_count(api_client)
    assert new_count == baseline + 1, f"expected {baseline + 1}, got {new_count}"


def test_case_insensitive_email(api_client):
    """Two inbound messages with different-case emails should be counted once."""
    baseline = _get_count(api_client)
    email_upper = f"TEST_case_{uuid.uuid4().hex[:8]}@EXAMPLE.com"
    for e in (email_upper, email_upper.lower()):
        r = api_client.post(
            f"{API}/messages",
            json={"customer_name": "Case", "customer_email": e, "subject": "S", "body": "B"},
            timeout=15,
        )
        assert r.status_code == 200
    time.sleep(0.5)
    new_count = _get_count(api_client)
    # Two inbound messages, same normalised email → +1
    assert new_count == baseline + 1


def test_blank_email_not_counted(api_client):
    baseline = _get_count(api_client)
    r = api_client.post(
        f"{API}/messages",
        json={"customer_name": "Anon", "customer_email": "", "subject": "S", "body": "B"},
        timeout=15,
    )
    assert r.status_code == 200
    time.sleep(0.5)
    assert _get_count(api_client) == baseline
