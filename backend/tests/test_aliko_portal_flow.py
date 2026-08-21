"""Targeted regression: aliko@yopmail.com register→dashboard→review→re-review flow.

Requires 3 seeded orders (1 delivered, 1 paid, 1 pending) for aliko@yopmail.com.
Cleans up the portal_customer + review created during this run so re-runs are idempotent.
"""
import os
import pytest
import requests
from pymongo import MongoClient
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")
BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/") if os.environ.get("REACT_APP_BACKEND_URL") else None
if not BASE_URL:
    # fall back to frontend env
    from pathlib import Path
    for line in Path("/app/frontend/.env").read_text().splitlines():
        if line.startswith("REACT_APP_BACKEND_URL"):
            BASE_URL = line.split("=", 1)[1].strip().strip('"').rstrip("/")

EMAIL = "aliko@yopmail.com"
PASSWORD = "secret123"


@pytest.fixture(scope="module")
def mongo():
    c = MongoClient(os.environ["MONGO_URL"])
    return c[os.environ["DB_NAME"]]


@pytest.fixture(scope="module", autouse=True)
def _reset_customer(mongo):
    # Remove pre-existing portal_customer + any reviews written by aliko so registration + write-review are re-runnable.
    mongo.customer_accounts.delete_many({"email": EMAIL})
    mongo.reviews.delete_many({"customer_email": EMAIL})
    yield
    mongo.customer_accounts.delete_many({"email": EMAIL})
    mongo.reviews.delete_many({"customer_email": EMAIL})


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/portal/register", json={"email": EMAIL, "password": PASSWORD, "name": "Ali Ko"})
    if r.status_code == 409:
        r = requests.post(f"{BASE_URL}/api/portal/login", json={"email": EMAIL, "password": PASSWORD})
    assert r.status_code == 200, r.text
    data = r.json()
    assert "token" in data
    assert data["customer"]["email"] == EMAIL
    return data["token"]


@pytest.fixture
def auth_headers(token):
    return {"Authorization": f"Bearer {token}"}


def test_register_success_and_customer_persisted(token, mongo):
    doc = mongo.customer_accounts.find_one({"email": EMAIL})
    assert doc is not None
    assert "password_hash" in doc


def _get_orders(auth_headers):
    r = requests.get(f"{BASE_URL}/api/portal/orders", headers=auth_headers)
    assert r.status_code == 200, r.text
    data = r.json()
    return data["orders"] if isinstance(data, dict) else data


def test_orders_endpoint_returns_three_orders_with_correct_flags(auth_headers):
    orders = _get_orders(auth_headers)
    assert len(orders) == 3, f"expected 3 orders, got {len(orders)}"

    by_status = {o["status"]: o for o in orders}
    assert set(by_status) == {"delivered", "paid", "pending"}

    # can_review true only for delivered + paid
    assert by_status["delivered"]["can_review"] is True
    assert by_status["paid"]["can_review"] is True
    assert by_status["pending"]["can_review"] is False

    # none already reviewed at this point
    for o in orders:
        assert o["already_reviewed"] is False


def test_write_review_on_delivered_order(auth_headers, mongo):
    delivered = next(o for o in _get_orders(auth_headers) if o["status"] == "delivered")
    payload = {
        "order_id": delivered["id"],
        "product_id": delivered["product_id"],
        "rating": 5,
        "title": "Solid watch",
        "body": "Bought this last week — battery is great and setup was painless.",
    }
    r = requests.post(f"{BASE_URL}/api/portal/reviews", headers=auth_headers, json=payload)
    assert r.status_code in (200, 201), r.text
    review = r.json()
    assert review["rating"] == 5

    # order now flagged already_reviewed
    delivered_after = next(o for o in _get_orders(auth_headers) if o["id"] == delivered["id"])
    assert delivered_after["already_reviewed"] is True


def test_second_review_on_same_order_returns_409(auth_headers):
    delivered = next(o for o in _get_orders(auth_headers) if o["status"] == "delivered")
    payload = {
        "order_id": delivered["id"],
        "product_id": delivered["product_id"],
        "rating": 4,
        "title": "Second try",
        "body": "should be rejected as duplicate for this order.",
    }
    r = requests.post(f"{BASE_URL}/api/portal/reviews", headers=auth_headers, json=payload)
    assert r.status_code == 409, f"expected 409, got {r.status_code} {r.text}"


def test_review_on_pending_order_rejected(auth_headers):
    pending = next(o for o in _get_orders(auth_headers) if o["status"] == "pending")
    payload = {
        "order_id": pending["id"],
        "product_id": pending["product_id"],
        "rating": 3,
        "title": "Too soon",
        "body": "should be rejected until processed.",
    }
    r = requests.post(f"{BASE_URL}/api/portal/reviews", headers=auth_headers, json=payload)
    assert r.status_code in (400, 403, 409), f"expected 4xx, got {r.status_code} {r.text}"


def test_login_after_register_returns_valid_token():
    r = requests.post(f"{BASE_URL}/api/portal/login", json={"email": EMAIL, "password": PASSWORD})
    assert r.status_code == 200, r.text
    token = r.json()["token"]
    orders = _get_orders({"Authorization": f"Bearer {token}"})
    awaiting = [o for o in orders if o.get("can_review") and not o.get("already_reviewed")]
    assert len(awaiting) == 1
    assert awaiting[0]["status"] == "paid"
