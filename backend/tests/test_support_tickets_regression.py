"""Support tickets regression coverage: ingestion, grouping, read-marking, status transitions, and reply history."""
from __future__ import annotations

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


@pytest.mark.anyio
async def test_support_tickets_end_to_end_regression_with_mocked_email(monkeypatch):
    captured = []

    async def fake_send_managed_email(*, to, subject, html):
        captured.append({"to": to, "subject": subject, "html": html})
        return "mock-delivery-id"

    async def fake_push_to_pcstore(ticket_id, message, timestamp):
        captured.append({"pcstore_ticket_id": ticket_id, "pcstore_message": message, "pcstore_timestamp": timestamp})
        return True

    monkeypatch.setattr(server_mod, "send_managed_email", fake_send_managed_email)
    monkeypatch.setattr(server_mod, "_push_admin_reply_to_pcstore", fake_push_to_pcstore)
    marker = f"TEST_support_norm_{uuid.uuid4().hex[:8]}"
    body = SupportContactBody(
        name="Ticket Customer",
        email=f"{marker}@example.com",
        subject=marker,
        message="Need refund update",
        attachments=["https://images.example.com/proof.png"],
    )

    created = await server_mod.submit_support_contact(body, x_pcstore_secret=os.environ["PCADMIN_INTERNAL_SECRET"])
    access = {"via": "admin", "admin": {"id": "admin", "role": "admin"}}
    opened = await server_mod.get_support_ticket(created["id"], access)

    legacy_marker = f"TEST_support_legacy_{uuid.uuid4().hex[:8]}"
    legacy_email = f"{legacy_marker}@example.com"
    legacy_ticket_id = f"legacy-{uuid.uuid4().hex[:10]}"
    legacy_notif_id = f"notif-{uuid.uuid4().hex[:10]}"

    status_marker = f"TEST_support_status_{uuid.uuid4().hex[:8]}"
    status_body = SupportContactBody(
        name="Status Customer",
        email=f"{status_marker}@example.com",
        subject=status_marker,
        message="status flow",
    )
    status_ticket = await server_mod.submit_support_contact(status_body, x_pcstore_secret=os.environ["PCADMIN_INTERNAL_SECRET"])

    client, db = _db()
    try:
        now = server_mod.datetime.now(server_mod.timezone.utc).isoformat()
        db.support_messages.insert_one({
            "id": legacy_ticket_id,
            "name": "Legacy Customer",
            "email": legacy_email,
            "subject": legacy_marker,
            "message": "legacy body",
            "created_at": now,
            "status": "unread",
            "unread": True,
        })
        db.notifications.insert_one({
            "id": legacy_notif_id,
            "type": "support_message",
            "title": "Legacy support",
            "body": legacy_marker,
            "data": {"support_message_id": legacy_ticket_id, "ticket_id": legacy_ticket_id},
            "at": now,
            "read": False,
        })

        ticket = db.support_messages.find_one({"id": created["id"]}, {"_id": 0})
        notif = db.notifications.find_one({"data.ticket_id": created["id"]}, {"_id": 0})
        assert created["received"] is True
        assert created["email_notified"] is True
        assert ticket["status"] == "new"
        assert ticket["unread"] is False
        assert ticket["messages"][0]["direction"] == "inbound"
        assert ticket["messages"][0]["attachments"] == ["https://images.example.com/proof.png"]
        assert notif["type"] == "support_message"
        assert notif["data"]["ticket_id"] == created["id"]
        assert opened["id"] == created["id"]
        assert captured[0]["to"] == os.environ["SUPPORT_NOTIFICATION_EMAIL"]

        grouped = await server_mod.list_support_tickets(email=None, access=access)
        legacy_group = next(g for g in grouped["customers"] if g["email"] == legacy_email)
        legacy_ticket = next(t for t in legacy_group["tickets"] if t["id"] == legacy_ticket_id)
        assert legacy_ticket["status"] == "new"
        assert legacy_ticket["unread"] is True
        assert legacy_group["open_count"] >= 1

        legacy_opened = await server_mod.get_support_ticket(legacy_ticket_id, access)
        assert legacy_opened["unread"] is False
        assert legacy_opened["messages"][0]["direction"] == "inbound"
        assert legacy_opened["messages"][0]["body"] == "legacy body"

        updated_doc = db.support_messages.find_one({"id": legacy_ticket_id}, {"_id": 0})
        updated_notif = db.notifications.find_one({"id": legacy_notif_id}, {"_id": 0})
        assert isinstance(updated_doc.get("messages"), list)
        assert updated_doc["unread"] is False
        assert updated_notif["read"] is True

        for status in ["new", "open", "in_progress", "resolved", "closed"]:
            updated = await server_mod.update_support_ticket_status(
                status_ticket["id"],
                SupportTicketStatusBody(status=status),
                {"id": "admin", "role": "admin"},
            )
            assert updated["status"] == status

        reply = await server_mod.reply_to_support_ticket(
            status_ticket["id"],
            SupportTicketReplyBody(body="Final outbound response", attachments=["https://images.example.com/reply-proof.jpg"]),
            {"id": "admin", "role": "admin", "name": "Agent", "email": "agent@example.com"},
        )
        status_ticket_after = await server_mod._get_support_ticket(status_ticket["id"])
        assert reply["ok"] is True
        assert reply["message"]["direction"] == "outbound"
        assert reply["message"]["attachments"] == ["https://images.example.com/reply-proof.jpg"]
        assert status_ticket_after["status"] == "closed"
        assert status_ticket_after["messages"][-1]["direction"] == "outbound"
        assert status_ticket_after["messages"][-1]["body"] == "Final outbound response"
        assert captured[-2]["to"].endswith("@example.com")
        assert captured[-2]["subject"].startswith("Re: ")
        assert captured[-1]["pcstore_ticket_id"] == status_ticket["id"]
        assert captured[-1]["pcstore_message"] == "Final outbound response"
    finally:
        db.support_messages.delete_many({"id": created["id"]})
        db.support_messages.delete_many({"id": status_ticket["id"]})
        db.support_messages.delete_many({"id": legacy_ticket_id})
        db.notifications.delete_many({"data.ticket_id": created["id"]})
        db.notifications.delete_many({"data.ticket_id": status_ticket["id"]})
        db.notifications.delete_many({"id": legacy_notif_id})
        client.close()


def test_support_contact_endpoint_shared_secret_still_required_regression():
    marker = f"TEST_support_secret_{uuid.uuid4().hex[:8]}"
    payload = {
        "name": "Secret Check",
        "email": f"{marker}@example.com",
        "subject": marker,
        "message": "blocked",
    }
    response = requests.post(f"{API}/support/contact", json=payload, timeout=20)
    assert response.status_code == 401
