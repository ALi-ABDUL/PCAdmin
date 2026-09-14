"""Deleting a customer must be permanent: a tombstone stops
`_rebuild_customers_from_orders` from resurrecting them from leftover orders.
Re-creating the same customer clears the tombstone.
"""
import os
import uuid
from datetime import datetime, timezone

import pytest
import requests
from pymongo import MongoClient
from dotenv import load_dotenv

load_dotenv("/app/frontend/.env")
load_dotenv("/app/backend/.env")

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"
EMAIL = f"perma.delete.{uuid.uuid4().hex[:8]}@example.com"


@pytest.fixture(scope="module")
def mongo():
    return MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]


@pytest.fixture(scope="module", autouse=True)
def _seed_and_cleanup(mongo):
    mongo.orders.insert_one({
        "id": str(uuid.uuid4()), "customer_email": EMAIL, "customer_name": "Perma Delete",
        "total": 12.0, "status": "paid", "created_at": datetime.now(timezone.utc).isoformat(),
    })
    yield
    mongo.orders.delete_many({"customer_email": EMAIL})
    mongo.customers.delete_many({"email": EMAIL})
    mongo.deleted_customers.delete_many({"key": EMAIL.lower()})


def _find(mongo):
    return mongo.customers.find_one({"email": EMAIL})


def test_delete_survives_rebuild_then_recreate_clears_tombstone(mongo):
    # Materialise the customer from the seeded order.
    requests.post(f"{API}/customers/rebuild-from-orders")
    c = _find(mongo)
    assert c is not None, "customer should be materialised from the order"

    # Delete → tombstone written, row gone.
    r = requests.delete(f"{API}/customers/{c['id']}")
    assert r.status_code == 200 and r.json().get("deleted") is True
    assert _find(mongo) is None
    assert mongo.deleted_customers.find_one({"key": EMAIL.lower()}) is not None

    # Rebuild must NOT resurrect the deleted customer.
    requests.post(f"{API}/customers/rebuild-from-orders")
    assert _find(mongo) is None, "deleted customer was resurrected by rebuild"

    # Re-creating the same email clears the tombstone.
    cr = requests.post(f"{API}/customers", json={"name": "Perma Delete", "email": EMAIL, "status": "active", "type": "registered"})
    assert cr.status_code == 200
    assert mongo.deleted_customers.find_one({"key": EMAIL.lower()}) is None
    assert _find(mongo) is not None
