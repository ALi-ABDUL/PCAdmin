"""Targeted regression tests for order-line fulfillment metadata self-heal paths."""

import os
import uuid
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import pytest
import requests
from dotenv import load_dotenv
from pymongo import MongoClient


BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    for line in Path("/app/frontend/.env").read_text().splitlines():
        if line.startswith("REACT_APP_BACKEND_URL="):
            BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
            break

API = f"{BASE_URL}/api"
TARGET_ORDER_ID = "2691093f-43bc-47d6-a218-e88744629ca5"
TARGET_ORDER_REF = "ORD-2D512BF5"
ALLOWED_LINE_STATUSES = {"pending", "processing", "shipped", "delivered"}


@pytest.fixture(scope="module")
def client():
    session = requests.Session()
    session.headers.update({"Content-Type": "application/json"})
    return session


@pytest.fixture(scope="module")
def mongo_db():
    load_dotenv("/app/backend/.env")
    mongo_url = os.environ.get("MONGO_URL")
    db_name = os.environ.get("DB_NAME")
    if not mongo_url or not db_name:
        pytest.skip("MONGO_URL/DB_NAME missing from /app/backend/.env")
    mongo = MongoClient(mongo_url)
    try:
        yield mongo[db_name]
    finally:
        mongo.close()


def _get_products_for_multiline_order(client):
    response = client.get(f"{API}/products", params={"limit": 10}, timeout=30)
    assert response.status_code == 200, response.text
    products = response.json().get("products", [])
    viable = [p for p in products if isinstance(p.get("id"), str)]
    if len(viable) < 2:
        pytest.skip("Need at least two products to create multi-line orders")
    return viable[0], viable[1]


def _create_temp_multiline_order(client, email=None):
    p1, p2 = _get_products_for_multiline_order(client)
    payload = {
        "customer_name": "QA Fulfillment Targeted",
        "customer_email": email,
        "items": [
            {"product_id": p1["id"], "quantity": 1, "variant_type": "Size", "variant_option": "M", "variant_price": 19.99},
            {"product_id": p2["id"], "quantity": 2, "variant_type": "Colour", "variant_option": "Blue", "variant_price": 11.50},
        ],
    }
    response = client.post(f"{API}/orders", json=payload, timeout=30)
    assert response.status_code == 200, response.text
    return response.json()


def _cleanup_order_and_restore_stock(mongo_db, order_id):
    order = mongo_db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        return
    for line in order.get("items") or []:
        pid = line.get("product_id")
        qty = int(line.get("quantity") or 0)
        if pid and qty > 0:
            mongo_db.products.update_one({"id": pid}, {"$inc": {"stock": qty, "sold_count": -qty}})
    mongo_db.orders.delete_one({"id": order_id})


class TestOrderLineFulfillmentTargeted:
    # Module: Fulfillment metadata persisted on user-reported order
    def test_target_order_has_persisted_line_id_and_fulfillment_status_in_mongo(self, mongo_db):
        order = mongo_db.orders.find_one(
            {"id": TARGET_ORDER_ID},
            {"_id": 0, "id": 1, "reference": 1, "items": 1},
        )
        assert order is not None, f"Target order missing in Mongo: {TARGET_ORDER_ID}"
        assert order.get("reference") == TARGET_ORDER_REF
        items = order.get("items") or []
        assert len(items) == 11

        for index, line in enumerate(items):
            assert isinstance(line.get("line_id"), str) and line["line_id"].strip(), f"Missing line_id at item index {index}"
            assert line.get("fulfillment_status") in ALLOWED_LINE_STATUSES, f"Invalid fulfillment_status at item index {index}"

    # Module: GET order details returns fulfillment-ready line items without status mutation
    def test_get_order_returns_fulfillment_ready_items_without_mutating_existing_status(self, client, mongo_db):
        before = mongo_db.orders.find_one(
            {"id": TARGET_ORDER_ID},
            {"_id": 0, "items.line_id": 1, "items.fulfillment_status": 1},
        )
        assert before is not None
        before_statuses = [line.get("fulfillment_status") for line in (before.get("items") or [])]

        response = client.get(f"{API}/orders/{TARGET_ORDER_ID}", timeout=30)
        assert response.status_code == 200, response.text
        body = response.json()
        assert body.get("id") == TARGET_ORDER_ID
        assert len(body.get("items") or []) == 11
        for line in body.get("items") or []:
            assert isinstance(line.get("line_id"), str) and line["line_id"].strip()
            assert line.get("fulfillment_status") in ALLOWED_LINE_STATUSES

        after = mongo_db.orders.find_one(
            {"id": TARGET_ORDER_ID},
            {"_id": 0, "items.fulfillment_status": 1},
        )
        after_statuses = [line.get("fulfillment_status") for line in (after.get("items") or [])]
        assert after_statuses == before_statuses

    # Module: Self-heal missing line metadata + line fulfillment PATCH succeeds
    def test_get_order_self_repairs_and_patch_line_processing(self, client, mongo_db):
        order = _create_temp_multiline_order(client)
        oid = order["id"]
        try:
            mongo_db.orders.update_one(
                {"id": oid},
                {"$unset": {"items.0.line_id": "", "items.0.fulfillment_status": ""}},
            )

            repaired = client.get(f"{API}/orders/{oid}", timeout=30)
            assert repaired.status_code == 200, repaired.text
            repaired_body = repaired.json()
            first_line = repaired_body["items"][0]
            assert isinstance(first_line.get("line_id"), str) and first_line["line_id"].strip()
            assert first_line.get("fulfillment_status") == "pending"

            persisted = mongo_db.orders.find_one({"id": oid}, {"_id": 0, "items": 1})
            persisted_first = (persisted.get("items") or [])[0]
            assert persisted_first.get("line_id") == first_line.get("line_id")
            assert persisted_first.get("fulfillment_status") == "pending"

            update = client.patch(
                f"{API}/orders/{oid}/items/{first_line['line_id']}/fulfillment",
                json={"status": "processing"},
                timeout=30,
            )
            assert update.status_code == 200, update.text
            assert update.json()["line_item"]["fulfillment_status"] == "processing"
        finally:
            _cleanup_order_and_restore_stock(mongo_db, oid)

    # Module: Customer portal orders endpoint self-heals missing line metadata
    def test_portal_orders_self_repair_missing_line_metadata(self, client, mongo_db):
        email = f"qa.portal.{uuid.uuid4().hex[:10]}@example.com"
        password = "QaPortal123!"
        order = _create_temp_multiline_order(client, email=email)
        oid = order["id"]
        account_id = None

        try:
            mongo_db.orders.update_one(
                {"id": oid},
                {"$unset": {"items.0.line_id": "", "items.0.fulfillment_status": ""}},
            )

            register = client.post(
                f"{API}/portal/register",
                json={"email": email, "password": password, "name": "QA Portal"},
                timeout=30,
            )
            assert register.status_code == 200, register.text
            reg_body = register.json()
            activation_link = reg_body.get("activation_link")
            assert activation_link, "Expected activation_link when email delivery is unavailable"

            token_qs = parse_qs(urlparse(activation_link).query)
            token = (token_qs.get("token") or [None])[0]
            assert token

            verify = client.post(f"{API}/portal/verify", json={"token": token}, timeout=30)
            assert verify.status_code == 200, verify.text

            login = client.post(
                f"{API}/portal/login",
                json={"email": email, "password": password},
                timeout=30,
            )
            assert login.status_code == 200, login.text
            bearer = login.json().get("token")
            assert bearer

            account = mongo_db.customer_accounts.find_one({"email": email}, {"_id": 0, "id": 1})
            account_id = (account or {}).get("id")

            portal_orders = client.get(
                f"{API}/portal/orders",
                headers={"Authorization": f"Bearer {bearer}"},
                timeout=30,
            )
            assert portal_orders.status_code == 200, portal_orders.text
            rows = portal_orders.json().get("orders", [])
            target = next((row for row in rows if row.get("id") == oid), None)
            assert target is not None
            first_line = (target.get("items") or [])[0]
            assert isinstance(first_line.get("line_id"), str) and first_line["line_id"].strip()
            assert first_line.get("fulfillment_status") == "pending"

            persisted = mongo_db.orders.find_one({"id": oid}, {"_id": 0, "items": 1})
            persisted_first = (persisted.get("items") or [])[0]
            assert isinstance(persisted_first.get("line_id"), str) and persisted_first["line_id"].strip()
            assert persisted_first.get("fulfillment_status") == "pending"
        finally:
            _cleanup_order_and_restore_stock(mongo_db, oid)
            mongo_db.customer_accounts.delete_many({"email": email})
            if account_id:
                mongo_db.customers.delete_many({"portal_account_id": account_id})
            mongo_db.customers.delete_many({"email": {"$regex": f"^{email}$", "$options": "i"}})
            mongo_db.verification_tokens.delete_many({"email": email})

    # Module: Regression path for normal order creation line metadata
    def test_post_orders_regression_creates_line_id_and_pending(self, client, mongo_db):
        order = _create_temp_multiline_order(client)
        oid = order["id"]
        try:
            items = order.get("items") or []
            assert len(items) == 2
            for idx, line in enumerate(items):
                assert isinstance(line.get("line_id"), str) and line["line_id"].strip(), f"POST /orders missing line_id at index {idx}"
                assert line.get("fulfillment_status") == "pending", f"POST /orders wrong default status at index {idx}"

            persisted = mongo_db.orders.find_one({"id": oid}, {"_id": 0, "items": 1})
            persisted_items = persisted.get("items") or []
            assert len(persisted_items) == 2
            for idx, line in enumerate(persisted_items):
                assert isinstance(line.get("line_id"), str) and line["line_id"].strip(), f"Mongo order missing line_id at index {idx}"
                assert line.get("fulfillment_status") == "pending", f"Mongo wrong default status at index {idx}"
        finally:
            _cleanup_order_and_restore_stock(mongo_db, oid)
