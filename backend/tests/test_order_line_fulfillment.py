"""Regression coverage for per-line order fulfilment and item-only emails."""
import asyncio
import os
import sys
import uuid
from pathlib import Path

import pytest
import requests

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import helpers


BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    for line in Path("/app/frontend/.env").read_text().splitlines():
        if line.startswith("REACT_APP_BACKEND_URL="):
            BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
            break
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def client():
    session = requests.Session()
    session.headers.update({"Content-Type": "application/json"})
    return session


@pytest.fixture(scope="module")
def products(client):
    response = client.get(f"{API}/products", params={"limit": 3}, timeout=20)
    assert response.status_code == 200, response.text
    rows = response.json().get("products", [])
    assert len(rows) >= 2, "need two products for fulfilment coverage"
    return rows[:2]


def _create_multi_item_order(client, products):
    response = client.post(f"{API}/orders", json={
        "customer_name": "QA Fulfilment",
        "items": [
            {"product_id": products[0]["id"], "quantity": 1, "variant_type": "Size", "variant_option": "M", "variant_price": 19.50},
            {"product_id": products[1]["id"], "quantity": 2, "variant_type": "Colour", "variant_option": "Blue", "variant_price": 12.00},
        ],
    }, timeout=20)
    assert response.status_code == 200, response.text
    return response.json()


class TestOrderLineFulfillment:
    def test_order_detail_read_repairs_missing_line_identifiers(self, client, products):
        """Orders inserted outside checkout become actionable the first time they are read."""
        order = _create_multi_item_order(client, products)
        oid = order["id"]
        try:
            from pymongo import MongoClient
            from dotenv import load_dotenv

            load_dotenv("/app/backend/.env")
            mongo = MongoClient(os.environ["MONGO_URL"])
            try:
                mongo[os.environ["DB_NAME"]].orders.update_one(
                    {"id": oid},
                    {"$unset": {"items.0.line_id": "", "items.0.fulfillment_status": ""}},
                )
            finally:
                mongo.close()

            repaired = client.get(f"{API}/orders/{oid}")
            assert repaired.status_code == 200, repaired.text
            first = repaired.json()["items"][0]
            assert first["line_id"]
            assert first["fulfillment_status"] == "pending"

            update = client.patch(
                f"{API}/orders/{oid}/items/{first['line_id']}/fulfillment",
                json={"status": "processing"}, timeout=20,
            )
            assert update.status_code == 200, update.text
            assert update.json()["line_item"]["fulfillment_status"] == "processing"
        finally:
            client.delete(f"{API}/orders/{oid}", timeout=20)

    def test_updates_only_selected_line_and_derives_order_status(self, client, products):
        order = _create_multi_item_order(client, products)
        oid = order["id"]
        try:
            first, second = order["items"]
            assert first["line_id"] and second["line_id"]
            assert [line["fulfillment_status"] for line in order["items"]] == ["pending", "pending"]

            one_processing = client.patch(
                f"{API}/orders/{oid}/items/{first['line_id']}/fulfillment",
                json={"status": "processing"}, timeout=20,
            )
            assert one_processing.status_code == 200, one_processing.text
            body = one_processing.json()
            assert body["customer_notification"] == "skipped_no_recipient"
            updated = body["order"]
            assert updated["items"][0]["fulfillment_status"] == "processing"
            assert updated["items"][1]["fulfillment_status"] == "pending"
            assert updated["items"][1].get("fulfillment_history") is None

            all_processing = client.patch(
                f"{API}/orders/{oid}/items/{second['line_id']}/fulfillment",
                json={"status": "processing"}, timeout=20,
            )
            assert all_processing.status_code == 200, all_processing.text
            updated = all_processing.json()["order"]
            assert updated["status"] == "processing"
            assert [line["fulfillment_status"] for line in updated["items"]] == ["processing", "processing"]

            first_shipped = client.patch(
                f"{API}/orders/{oid}/items/{first['line_id']}/fulfillment",
                json={"status": "shipped"}, timeout=20,
            )
            assert first_shipped.status_code == 200
            assert first_shipped.json()["order"]["status"] == "processing"

            all_shipped = client.patch(
                f"{API}/orders/{oid}/items/{second['line_id']}/fulfillment",
                json={"status": "shipped"}, timeout=20,
            )
            assert all_shipped.status_code == 200, all_shipped.text
            updated = all_shipped.json()["order"]
            assert updated["status"] == "shipped"
            assert [line["fulfillment_status"] for line in updated["items"]] == ["shipped", "shipped"]

            first_delivered = client.patch(
                f"{API}/orders/{oid}/items/{first['line_id']}/fulfillment",
                json={"status": "delivered"}, timeout=20,
            )
            assert first_delivered.status_code == 200
            assert first_delivered.json()["order"]["status"] == "shipped"

            all_delivered = client.patch(
                f"{API}/orders/{oid}/items/{second['line_id']}/fulfillment",
                json={"status": "delivered"}, timeout=20,
            )
            assert all_delivered.status_code == 200, all_delivered.text
            updated = all_delivered.json()["order"]
            assert updated["status"] == "delivered"
            assert [line["fulfillment_status"] for line in updated["items"]] == ["delivered", "delivered"]
            assert [entry["to"] for entry in updated.get("status_history", [])][-2:] == ["shipped", "delivered"]

            unknown = client.patch(
                f"{API}/orders/{oid}/items/{uuid.uuid4()}/fulfillment",
                json={"status": "shipped"}, timeout=20,
            )
            assert unknown.status_code == 404
            invalid = client.patch(
                f"{API}/orders/{oid}/items/{first['line_id']}/fulfillment",
                json={"status": "packing"}, timeout=20,
            )
            assert invalid.status_code == 422
        finally:
            client.delete(f"{API}/orders/{oid}", timeout=20)

    def test_line_status_email_contains_only_the_changed_item(self, monkeypatch):
        captured = {}

        async def fake_send(kind, to_email, subject, html):
            captured.update({"kind": kind, "to": to_email, "subject": subject, "html": html})
            return "sent"

        monkeypatch.setattr(helpers, "send_customer_email", fake_send)
        result = asyncio.run(helpers.send_customer_order_line_status_update(
            {"id": "order-123", "reference": "QA-REF", "customer_name": "Ada Lovelace", "customer_email": "ada@example.com"},
            {"title": "Blue widget", "variant_type": "Colour", "variant_option": "Blue", "quantity": 2, "line_total": 24.00},
            "pending", "shipped",
        ))

        assert result == "sent"
        assert captured["kind"] == "order_status_update"
        assert captured["to"] == "ada@example.com"
        assert "Blue widget (Colour: Blue)" in captured["html"]
        assert "Item total" in captured["html"]
        assert "order total" not in captured["html"].lower()

    def test_order_rejects_zero_or_negative_line_quantities(self, client, products):
        for quantity in (0, -1):
            response = client.post(f"{API}/orders", json={
                "items": [{"product_id": products[0]["id"], "quantity": quantity}],
            }, timeout=20)
            assert response.status_code == 422