"""Trusted PCStore contact messages persist, notify the bell, and use fixed email rendering."""
from __future__ import annotations

import asyncio
import os
import pathlib
import sys
import uuid

import pytest
import requests
from dotenv import load_dotenv
from pymongo import MongoClient

sys.path.insert(0, "/app/backend")
import server as server_mod
from models import SupportContactBody, SupportTicketReplyBody, SupportTicketStatusBody


def _api_url() -> str:
    value = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
    if value:
        return f"{value}/api"
    for line in pathlib.Path("/app/frontend/.env").read_text().splitlines():
        if line.startswith("REACT_APP_BACKEND_URL="):
            return f"{line.split('=', 1)[1].strip().rstrip('/')}/api"
    raise RuntimeError("REACT_APP_BACKEND_URL is not configured")


API = _api_url()
load_dotenv("/app/backend/.env")


def _db():
    client = MongoClient(os.environ["MONGO_URL"])
    return client, client[os.environ["DB_NAME"]]


def test_support_contact_rejects_missing_or_wrong_shared_secret():
    marker = f"TEST_support_unauth_{uuid.uuid4().hex[:8]}"
    payload = {
        "name": "Ada",
        "email": "ada@example.com",
        "subject": marker,
        "message": "I need help.",
    }
    client, db = _db()
    try:
        before = db.support_messages.count_documents({"subject": marker})
        for headers in ({}, {"X-PCStore-Secret": "incorrect"}):
            response = requests.post(f"{API}/support/contact", json=payload, headers=headers, timeout=20)
            assert response.status_code == 401
        after = db.support_messages.count_documents({"subject": marker})
        assert after == before
    finally:
        db.support_messages.delete_many({"subject": marker})
        client.close()


def test_trusted_contact_saves_message_bell_alert_and_fixed_admin_email(monkeypatch):
    captured = []

    async def fake_send_managed_email(*, to, subject, html):
        captured.append({"to": to, "subject": subject, "html": html})
        return "mock-delivery-id"

    monkeypatch.setattr(server_mod, "send_managed_email", fake_send_managed_email)
    body = SupportContactBody(
        name="Ada <Admin>", email="ada@example.com", subject="Order <status>",
        message="Please help with my order.\n<script>alert(1)</script>", customer_id="customer-123",
        attachments=["https://images.example.com/proof.jpg"],
    )
    async def ticket_workflow():
        created = await server_mod.submit_support_contact(body, x_pcstore_secret=os.environ["PCADMIN_INTERNAL_SECRET"])
        access = {"via": "admin", "admin": {"id": "admin", "role": "admin"}}
        listed = await server_mod.list_support_tickets(email=None, access=access)
        opened = await server_mod.get_support_ticket(created["id"], access)
        updated = await server_mod.update_support_ticket_status(created["id"], SupportTicketStatusBody(status="in_progress"), {"id": "admin", "role": "admin"})
        reply = await server_mod.reply_to_support_ticket(created["id"], SupportTicketReplyBody(body="We are checking this now."), {"id": "admin", "role": "admin", "name": "Support Agent", "email": "agent@example.com"})
        ticket = await server_mod._get_support_ticket(created["id"])
        return created, listed, opened, updated, reply, ticket

    result, listed, opened, updated, reply, ticket = asyncio.run(ticket_workflow())
    assert result["received"] is True
    assert result["email_notified"] is True
    client, db = _db()
    try:
        message = db.support_messages.find_one({"id": result["id"]}, {"_id": 0})
        assert message["id"] == result["id"]
        assert message["customer_name"] == "Ada <Admin>"
        assert message["customer_email"] == "ada@example.com"
        assert message["subject"] == "Order <status>"
        assert message["status"] == "in_progress"
        assert message["unread"] is False
        assert message["messages"][0] == {
            "id": message["messages"][0]["id"], "direction": "inbound",
            "body": "Please help with my order.\n<script>alert(1)</script>", "attachments": ["https://images.example.com/proof.jpg"],
            "created_at": message["created_at"], "author_name": "Ada <Admin>", "author_email": "ada@example.com",
        }
        notification = db.notifications.find_one({"data.support_message_id": result["id"]}, {"_id": 0})
        assert notification["type"] == "support_message"
        assert notification["title"] == "New support message from Ada <Admin>"
        assert notification["body"] == "Order <status>"
        assert notification["read"] is True
        assert captured[0]["to"] == os.environ["SUPPORT_NOTIFICATION_EMAIL"]
        assert captured[0]["subject"] == f"New {server_mod.EMAIL_FROM_NAME} support message"
        assert "Ada &lt;Admin&gt;" in captured[0]["html"]
        assert "Order &lt;status&gt;" in captured[0]["html"]
        assert "&lt;script&gt;alert(1)&lt;/script&gt;" in captured[0]["html"]
        assert listed["total"] >= 1
        listed_ticket = next(ticket_row for group in listed["customers"] for ticket_row in group["tickets"] if ticket_row["id"] == result["id"])
        assert listed_ticket["status"] == "new" and listed_ticket["unread"] is True
        assert opened["unread"] is False
        assert updated["status"] == "in_progress"
        assert reply["ok"] is True
        assert captured[1]["to"] == "ada@example.com"
        assert captured[1]["subject"] == "Re: Order <status>"
        assert ticket["messages"][-1]["direction"] == "outbound"
        assert ticket["messages"][-1]["body"] == "We are checking this now."

        bell = requests.get(f"{API}/notifications", params={"unread_only": "false", "limit": 200}, timeout=20)
        assert bell.status_code == 200, bell.text
        bell_rows = bell.json().get("notifications") or []
        match = next((n for n in bell_rows if n.get("data", {}).get("support_message_id") == result["id"]), None)
        assert match is not None
        assert match["type"] == "support_message"
        assert match["data"]["ticket_id"] == result["id"]
        assert "Ada <Admin>" in (match.get("title") or "")
        assert match.get("body") == "Order <status>"
        assert match.get("read") is True
    finally:
        db.support_messages.delete_many({"id": result["id"]})
        db.notifications.delete_many({"data.support_message_id": result["id"]})
        client.close()