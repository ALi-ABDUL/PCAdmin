from __future__ import annotations

import json
import os

from dotenv import load_dotenv
from pymongo import MongoClient


load_dotenv("/app/backend/.env")


def main() -> None:
    fixture_path = "/app/test_reports/support_fixture_iteration63.json"
    if not os.path.exists(fixture_path):
        print("No fixture file found; nothing to clean")
        return

    with open(fixture_path, "r", encoding="utf-8") as f:
        fixture = json.load(f)

    client = MongoClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]

    ticket_id = fixture.get("ticket_id")
    notification_id = fixture.get("notification_id")

    if ticket_id:
        db.support_messages.delete_many({"id": ticket_id})
    if notification_id:
        db.notifications.delete_many({"id": notification_id})
    if ticket_id:
        db.notifications.delete_many({"data.ticket_id": ticket_id})

    client.close()
    print("Fixture cleanup complete")


if __name__ == "__main__":
    main()
