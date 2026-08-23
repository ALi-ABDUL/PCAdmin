"""Tests for `has_unread_reply` flag on customers list + detail endpoint (Iter 25).
Uses sync pymongo for direct DB writes to inject outbound messages."""
import os
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path

import pytest
import requests
from dotenv import dotenv_values
from pymongo import MongoClient

FRONT_ENV = dotenv_values("/app/frontend/.env")
BACK_ENV = dotenv_values("/app/backend/.env")
BASE_URL = (FRONT_ENV.get("REACT_APP_BACKEND_URL") or "").rstrip("/")
API = f"{BASE_URL}/api"

MONGO_URL = BACK_ENV.get("MONGO_URL")
DB_NAME = BACK_ENV.get("DB_NAME")

assert BASE_URL and MONGO_URL and DB_NAME, "Missing env config"


@pytest.fixture(scope="module")
def db():
    client = MongoClient(MONGO_URL)
    yield client[DB_NAME]
    # Cleanup
    client[DB_NAME].customers.delete_many({"email": {"$regex": "^TEST_unread_", "$options": "i"}})
    client[DB_NAME].messages.delete_many({"customer_email": {"$regex": "^test_unread_"}})
    client.close()


def _iso(dt):
    return dt.astimezone(timezone.utc).isoformat()


def _create_customer(suffix: str) -> dict:
    email = f"TEST_unread_{uuid.uuid4().hex[:8]}_{suffix}@example.com"
    r = requests.post(f"{API}/customers", json={
        "name": f"TEST Unread {suffix}",
        "email": email,
        "status": "active",
        "type": "registered",
    }, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


def _find_in_list(email: str) -> dict | None:
    r = requests.get(f"{API}/customers", params={"q": email, "limit": 50}, timeout=15)
    assert r.status_code == 200, r.text
    for c in r.json()["customers"]:
        if (c.get("email") or "").lower() == email.lower():
            return c
    return None


def _get_detail(cid: str) -> dict:
    r = requests.get(f"{API}/customers/{cid}", timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


class TestUnreadReplyFlag:

    def test_zero_messages_flag_false(self, db):
        c = _create_customer("zero")
        listed = _find_in_list(c["email"])
        assert listed is not None
        assert listed["has_unread_reply"] is False
        det = _get_detail(c["id"])
        assert det["customer"]["has_unread_reply"] is False

    def test_two_inbound_flag_true(self, db):
        c = _create_customer("inbound")
        for i in range(2):
            r = requests.post(f"{API}/messages", json={
                "customer_name": c["name"],
                "customer_email": c["email"],
                "subject": f"Hi {i}",
                "body": "Please help",
            }, timeout=15)
            assert r.status_code == 200, r.text
        listed = _find_in_list(c["email"])
        assert listed["has_unread_reply"] is True
        det = _get_detail(c["id"])
        assert det["customer"]["has_unread_reply"] is True
        assert len(det["thread"]) == 2
        # All inbound
        assert all(m["direction"] == "inbound" for m in det["thread"])

    def test_outbound_newer_flag_false(self, db):
        c = _create_customer("out_newer")
        requests.post(f"{API}/messages", json={
            "customer_name": c["name"], "customer_email": c["email"],
            "subject": "Q", "body": "?",
        }, timeout=15)
        future_ts = _iso(datetime.now(timezone.utc) + timedelta(hours=1))
        db.messages.insert_one({
            "id": str(uuid.uuid4()),
            "customer_email": c["email"].lower(),
            "customer_name": c["name"],
            "subject": "re:",
            "body": "hi",
            "direction": "outbound",
            "status": "archived",
            "created_at": future_ts,
        })
        listed = _find_in_list(c["email"])
        assert listed["has_unread_reply"] is False
        det = _get_detail(c["id"])
        assert det["customer"]["has_unread_reply"] is False

    def test_only_outbound_flag_false(self, db):
        c = _create_customer("only_out")
        db.messages.insert_one({
            "id": str(uuid.uuid4()),
            "customer_email": c["email"].lower(),
            "customer_name": c["name"],
            "subject": "hello",
            "body": "reaching out",
            "direction": "outbound",
            "status": "archived",
            "created_at": _iso(datetime.now(timezone.utc)),
        })
        listed = _find_in_list(c["email"])
        assert listed["has_unread_reply"] is False
        det = _get_detail(c["id"])
        assert det["customer"]["has_unread_reply"] is False

    def test_inbound_newer_than_outbound_flag_true(self, db):
        c = _create_customer("in_newer")
        db.messages.insert_one({
            "id": str(uuid.uuid4()),
            "customer_email": c["email"].lower(),
            "customer_name": c["name"],
            "subject": "old", "body": "old",
            "direction": "outbound", "status": "archived",
            "created_at": _iso(datetime.now(timezone.utc) - timedelta(days=2)),
        })
        requests.post(f"{API}/messages", json={
            "customer_name": c["name"], "customer_email": c["email"],
            "subject": "new", "body": "new question",
        }, timeout=15)
        listed = _find_in_list(c["email"])
        assert listed["has_unread_reply"] is True
        det = _get_detail(c["id"])
        assert det["customer"]["has_unread_reply"] is True


# Regression checks — thread + timeline still work.
class TestRegression:
    def test_customer_detail_shape(self, db):
        c = _create_customer("shape")
        det = _get_detail(c["id"])
        assert "customer" in det and "orders" in det and "thread" in det and "timeline" in det
        assert isinstance(det["orders"], list)
        assert isinstance(det["thread"], list)
        assert isinstance(det["timeline"], list)
