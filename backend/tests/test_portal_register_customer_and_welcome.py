"""Regression for two portal-registration bug fixes:

  1. On register, the verification link is sent FIRST — the welcome email is
     held back until AFTER the customer verifies. Observable proof over HTTP:
     the register response returns `requires_verification` and NO session token
     (the account is inactive, so nothing "welcomes" them yet); the token only
     appears from /portal/verify.
  2. On register, the customer is mirrored into the `customers` collection so
     they show up in PCAdmin → Customers, flagged as a portal account and
     unverified — then flipped to verified once they confirm their email.
"""
import os
import uuid
import urllib.parse as urlparse
from datetime import datetime, timezone

import pytest
import requests
from pymongo import MongoClient
from dotenv import load_dotenv

load_dotenv("/app/frontend/.env")
load_dotenv("/app/backend/.env")

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"
EMAIL = f"reg.regression.{uuid.uuid4().hex[:8]}@example.com"
PASSWORD = "secret123"


@pytest.fixture(scope="module")
def mongo():
    c = MongoClient(os.environ["MONGO_URL"])
    return c[os.environ["DB_NAME"]]


@pytest.fixture(scope="module", autouse=True)
def _seed_and_cleanup(mongo):
    # Registration requires an existing order for the email.
    mongo.orders.insert_one({
        "id": str(uuid.uuid4()),
        "customer_email": EMAIL,
        "customer_name": "Reg Regression",
        "total": 30.0,
        "status": "paid",
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    mongo.customer_accounts.delete_many({"email": EMAIL})
    mongo.customers.delete_many({"email": EMAIL})
    mongo.verification_tokens.delete_many({"email": EMAIL})
    yield
    mongo.orders.delete_many({"customer_email": EMAIL})
    mongo.customer_accounts.delete_many({"email": EMAIL})
    mongo.customers.delete_many({"email": EMAIL})
    mongo.verification_tokens.delete_many({"email": EMAIL})


def test_register_requires_verification_and_does_not_log_in():
    r = requests.post(f"{API}/portal/register", json={"email": EMAIL, "password": PASSWORD})
    assert r.status_code == 200, r.text
    data = r.json()
    # Bug 1: verification-first — no session token issued at register.
    assert data.get("requires_verification") is True
    assert "token" not in data
    # Email isn't configured in test env, so the raw link is surfaced.
    assert data.get("activation_link"), data


def test_register_persists_customer_as_unverified_portal_account(mongo):
    c = mongo.customers.find_one({"email": EMAIL})
    # Bug 2: registrant is mirrored into the customers collection.
    assert c is not None, "customer row was not created on register"
    assert c.get("type") == "registered"
    assert c.get("has_portal_account") is True
    assert c.get("portal_verified") is False
    assert c.get("orders_count") == 1
    assert float(c.get("total_spend")) == 30.0


def test_verify_issues_token_and_marks_customer_verified(mongo):
    # Re-run the register to obtain a fresh activation link in-process.
    mongo.customer_accounts.delete_many({"email": EMAIL})
    mongo.customers.delete_many({"email": EMAIL})
    mongo.verification_tokens.delete_many({"email": EMAIL})
    reg = requests.post(f"{API}/portal/register", json={"email": EMAIL, "password": PASSWORD}).json()
    token = urlparse.parse_qs(urlparse.urlparse(reg["activation_link"]).query).get("token", [""])[0]
    assert token

    v = requests.post(f"{API}/portal/verify", json={"token": token})
    assert v.status_code == 200, v.text
    vd = v.json()
    assert vd.get("verified") is True
    assert vd.get("token"), "verify should issue a session token"

    c = mongo.customers.find_one({"email": EMAIL})
    assert c.get("portal_verified") is True
    assert c.get("portal_verified_at")
