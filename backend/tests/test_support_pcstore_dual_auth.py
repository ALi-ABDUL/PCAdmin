"""PCStore shared-secret access to support ticket sync routes."""
import os
import pathlib
import uuid

import requests
from dotenv import load_dotenv
from pymongo import MongoClient


load_dotenv("/app/backend/.env")


def _api_url():
    for line in pathlib.Path("/app/frontend/.env").read_text().splitlines():
        if line.startswith("REACT_APP_BACKEND_URL="):
            return f"{line.split('=', 1)[1].strip().rstrip('/')}/api"
    raise RuntimeError("REACT_APP_BACKEND_URL is not configured")


API = _api_url()


def _db():
    client = MongoClient(os.environ["MONGO_URL"])
    return client, client[os.environ["DB_NAME"]]


def test_pcstore_shared_secret_support_sync_is_email_scoped_and_no_email_reply():
    marker = uuid.uuid4().hex[:10]
    email = f"ticket-{marker}@example.test"
    other_email = f"other-{marker}@example.test"
    ids = [f"ticket-{marker}-old", f"ticket-{marker}-new", f"ticket-{marker}-other"]
    client, db = _db()
    headers = {"X-PCStore-Secret": os.environ["PCADMIN_INTERNAL_SECRET"]}
    try:
        docs = [
            {"id": ids[0], "customer_name": "Ticket Customer", "customer_email": email, "subject": "Older ticket", "status": "open", "unread": True, "created_at": "2026-01-01T00:00:00+00:00", "updated_at": "2026-01-01T00:00:00+00:00", "last_message_at": "2026-01-01T00:00:00+00:00", "messages": [{"id": "m-old", "direction": "inbound", "body": "old", "attachments": [], "created_at": "2026-01-01T00:00:00+00:00", "author_name": "Ticket Customer", "author_email": email}]},
            {"id": ids[1], "customer_name": "Ticket Customer", "customer_email": email, "subject": "Newest ticket", "status": "new", "unread": True, "created_at": "2026-01-02T00:00:00+00:00", "updated_at": "2026-01-02T00:00:00+00:00", "last_message_at": "2026-01-02T00:00:00+00:00", "messages": [{"id": "m-new", "direction": "inbound", "body": "new", "attachments": [], "created_at": "2026-01-02T00:00:00+00:00", "author_name": "Ticket Customer", "author_email": email}]},
            {"id": ids[2], "customer_name": "Other Customer", "customer_email": other_email, "subject": "Other customer", "status": "new", "unread": True, "created_at": "2026-01-03T00:00:00+00:00", "updated_at": "2026-01-03T00:00:00+00:00", "last_message_at": "2026-01-03T00:00:00+00:00", "messages": [{"id": "m-other", "direction": "inbound", "body": "other", "attachments": [], "created_at": "2026-01-03T00:00:00+00:00", "author_name": "Other Customer", "author_email": other_email}]},
        ]
        db.support_messages.insert_many(docs)

        listing = requests.get(f"{API}/support/tickets", params={"email": email}, headers=headers, timeout=30)
        assert listing.status_code == 200, listing.text
        tickets = listing.json()["tickets"]
        assert [ticket["id"] for ticket in tickets] == [ids[1], ids[0]]
        assert all(ticket["customer_email"] == email for ticket in tickets)

        assert requests.get(f"{API}/support/tickets", headers=headers, timeout=30).status_code == 400
        assert requests.get(f"{API}/support/tickets", params={"email": email}, headers={"X-PCStore-Secret": "wrong"}, timeout=30).status_code == 401
        assert requests.get(f"{API}/support/tickets", params={"email": email}, timeout=30).status_code == 401

        detail = requests.get(f"{API}/support/tickets/{ids[1]}", headers=headers, timeout=30)
        assert detail.status_code == 200
        detail_body = detail.json()
        assert detail_body["id"] == ids[1]
        assert len(detail_body["messages"]) == 1
        assert "PCADMIN_INTERNAL_SECRET" not in str(detail_body)
        assert db.support_messages.find_one({"id": ids[1]})["unread"] is True

        sync_reply = requests.post(f"{API}/support/tickets/{ids[1]}/reply", headers=headers, json={"body": "Synced admin response", "attachments": []}, timeout=30)
        assert sync_reply.status_code == 200, sync_reply.text
        sync_body = sync_reply.json()
        assert sync_body["email_sent"] is False
        assert "delivery_id" not in sync_body
        saved = db.support_messages.find_one({"id": ids[1]})
        assert saved["messages"][-1]["body"] == "Synced admin response"
        assert saved["messages"][-1]["sync_source"] == "pcstore"
        assert len(saved["messages"]) == 2

        sync_reply_2 = requests.post(f"{API}/support/tickets/{ids[1]}/reply", headers=headers, json={"body": "Second sync response", "attachments": []}, timeout=30)
        assert sync_reply_2.status_code == 200, sync_reply_2.text
        saved_after_second = db.support_messages.find_one({"id": ids[1]})
        assert saved_after_second["messages"][-1]["body"] == "Second sync response"
        assert len(saved_after_second["messages"]) == 3
        assert len([m for m in saved_after_second["messages"] if m.get("body") == "Second sync response"]) == 1

        admin = requests.Session()
        login = admin.post(f"{API}/admin-accounts/login", json={"email": "qa@prettycheap.com.au", "password": "QaTest123!"}, timeout=30)
        assert login.status_code == 200
        admin_list = admin.get(f"{API}/support/tickets", timeout=30)
        assert admin_list.status_code == 200
        assert "customers" in admin_list.json()

        mark_read_target = ids[0]
        mark_read = admin.get(f"{API}/support/tickets/{mark_read_target}", timeout=30)
        assert mark_read.status_code == 200
        assert db.support_messages.find_one({"id": mark_read_target})["unread"] is False

        assert requests.patch(
            f"{API}/support/tickets/{ids[1]}/status",
            headers=headers,
            json={"status": "open"},
            timeout=30,
        ).status_code == 401
        assert requests.post(
            f"{API}/support/tickets/{ids[1]}/replies",
            headers=headers,
            json={"body": "Should fail", "attachments": []},
            timeout=30,
        ).status_code == 401
    finally:
        db.support_messages.delete_many({"id": {"$in": ids}})
        client.close()