from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timezone

from dotenv import load_dotenv
from pymongo import MongoClient


load_dotenv("/app/backend/.env")


def main() -> None:
    client = MongoClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]
    now = datetime.now(timezone.utc).isoformat()
    marker = f"TEST_UI_SUPPORT_{uuid.uuid4().hex[:8]}"
    ticket_id = f"ticket-{uuid.uuid4().hex[:12]}"
    notif_id = f"notif-{uuid.uuid4().hex[:12]}"

    attachments = [
        "https://images.unsplash.com/photo-1518770660439-4636190af475?w=800",
        "https://images.unsplash.com/photo-1498050108023-c5249f4df085?w=800",
    ]

    support_doc = {
        "id": ticket_id,
        "name": "UI Fixture Customer",
        "email": "ui.fixture@example.com",
        "customer_name": "UI Fixture Customer",
        "customer_email": "ui.fixture@example.com",
        "subject": marker,
        "message": "Initial UI fixture message with two image attachments",
        "attachments": attachments,
        "customer_id": None,
        "created_at": now,
        "updated_at": now,
        "last_message_at": now,
        "status": "new",
        "unread": True,
        "messages": [
            {
                "id": f"msg-{uuid.uuid4().hex[:12]}",
                "direction": "inbound",
                "body": "Initial UI fixture message with two image attachments",
                "attachments": attachments,
                "created_at": now,
                "author_name": "UI Fixture Customer",
                "author_email": "ui.fixture@example.com",
            }
        ],
    }

    notification = {
        "id": notif_id,
        "type": "support_message",
        "title": "New support message from UI Fixture Customer",
        "body": marker,
        "customer_id": None,
        "data": {
            "support_message_id": ticket_id,
            "ticket_id": ticket_id,
            "name": "UI Fixture Customer",
            "subject": marker,
        },
        "at": now,
        "read": False,
    }

    db.support_messages.insert_one(support_doc)
    db.notifications.insert_one(notification)

    fixture_out = {
        "marker": marker,
        "ticket_id": ticket_id,
        "notification_id": notif_id,
        "created_at": now,
    }
    with open("/app/test_reports/support_fixture_iteration63.json", "w", encoding="utf-8") as f:
        json.dump(fixture_out, f)

    print(json.dumps(fixture_out))
    client.close()


if __name__ == "__main__":
    main()
