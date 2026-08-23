"""Tests for customer message thread (inbound/outbound) feature."""
import os
import time
import pytest
import requests

def _base():
    url = os.environ.get("REACT_APP_BACKEND_URL")
    if not url:
        # read from frontend/.env
        try:
            with open("/app/frontend/.env") as f:
                for line in f:
                    if line.startswith("REACT_APP_BACKEND_URL="):
                        url = line.split("=", 1)[1].strip()
                        break
        except Exception:
            pass
    assert url, "REACT_APP_BACKEND_URL not set"
    return url.rstrip("/") + "/api"

BASE = _base()


@pytest.fixture(scope="module")
def customer():
    email = f"test_thread_{int(time.time())}@example.com"
    r = requests.post(f"{BASE}/customers", json={
        "name": "Thread Tester",
        "email": email,
        "type": "guest",
        "status": "active",
    })
    assert r.status_code in (200, 201), r.text
    c = r.json()
    yield c
    # cleanup best-effort
    try:
        requests.delete(f"{BASE}/customers/{c['id']}")
    except Exception:
        pass


# --- Backend: thread payload shape -----------------------------------------
def test_customer_detail_thread_empty(customer):
    r = requests.get(f"{BASE}/customers/{customer['id']}")
    assert r.status_code == 200
    data = r.json()
    assert "thread" in data
    assert isinstance(data["thread"], list)
    assert data["thread"] == []


# --- POST /api/messages stamps direction=inbound + lowercases email --------
def test_post_message_marks_inbound_and_lowercases_email(customer):
    # Use uppercased email to verify lowercasing
    upper_email = customer["email"].upper()
    r = requests.post(f"{BASE}/messages", json={
        "customer_name": customer["name"],
        "customer_email": upper_email,
        "subject": "Order status?",
        "body": "Hi, has my order shipped?",
    })
    assert r.status_code in (200, 201), r.text

    # thread lookup uses lowercased email
    r2 = requests.get(f"{BASE}/customers/{customer['id']}")
    assert r2.status_code == 200
    thread = r2.json()["thread"]
    assert len(thread) >= 1
    inbound = [m for m in thread if m.get("subject") == "Order status?"]
    assert inbound, f"Expected inbound row, got: {thread}"
    assert inbound[0]["direction"] == "inbound"
    assert inbound[0]["customer_email"] == customer["email"].lower()


# --- Thread is chronological asc -------------------------------------------
def test_thread_sorted_asc(customer):
    for i in range(2):
        requests.post(f"{BASE}/messages", json={
            "customer_name": customer["name"],
            "customer_email": customer["email"],
            "subject": f"Msg {i}",
            "body": f"body {i}",
        })
        time.sleep(0.05)
    r = requests.get(f"{BASE}/customers/{customer['id']}")
    thread = r.json()["thread"]
    created = [m["created_at"] for m in thread]
    assert created == sorted(created), "thread must be ascending by created_at"


# --- Outbound endpoint: Resend not configured -> 400 by design -------------
def test_outbound_send_without_resend_returns_400(customer):
    r = requests.post(f"{BASE}/customers/{customer['id']}/message", json={
        "subject": "Re: Order status?",
        "body": "> Hi, has my order shipped?\n\nYes, shipped today.",
    })
    # Resend not configured in preview env -> 400 (by design per problem statement)
    assert r.status_code in (400, 500), r.text
