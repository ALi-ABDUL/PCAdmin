"""Safe regression coverage for empty-category permanent cleanup schedule and dry-run API."""
import os
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
import requests
from dotenv import load_dotenv
from pymongo import MongoClient


for line in Path("/app/frontend/.env").read_text().splitlines():
    if line.startswith("REACT_APP_BACKEND_URL="):
        API = f"{line.split('=', 1)[1].strip().rstrip('/')}/api"
        break
else:
    raise RuntimeError("REACT_APP_BACKEND_URL is not configured")


@pytest.fixture(scope="module")
def mongo_db():
    load_dotenv("/app/backend/.env")
    client = MongoClient(os.environ["MONGO_URL"])
    try:
        yield client[os.environ["DB_NAME"]]
    finally:
        client.close()


@pytest.fixture
def restore_schedule(mongo_db):
    original = mongo_db.category_cleanup_schedule.find_one({"id": "singleton"})
    yield
    if original is None:
        mongo_db.category_cleanup_schedule.delete_one({"id": "singleton"})
    else:
        mongo_db.category_cleanup_schedule.replace_one({"id": "singleton"}, original, upsert=True)


class TestCategoryCleanupSchedule:
    # schedule schema/read path
    def test_get_schedule_returns_persisted_configuration_shape(self):
        response = requests.get(f"{API}/categories/cleanup-schedule", timeout=20)
        assert response.status_code == 200, response.text
        body = response.json()
        assert isinstance(body.get("enabled"), bool)
        assert body.get("recurrence") in {"once", "daily", "weekly"}
        assert "next_run_at" in body
        assert "last_run_at" in body
        assert "last_result" in body

    # schedule write/validation path
    def test_patch_rejects_enabled_without_datetime(self, restore_schedule):
        response = requests.patch(
            f"{API}/categories/cleanup-schedule",
            json={"enabled": True, "next_run_at": None},
            timeout=20,
        )
        assert response.status_code == 400, response.text
        detail = response.json().get("detail")
        assert "future date and time" in detail.lower()

    # schedule write/validation path
    def test_patch_rejects_past_datetime(self, restore_schedule):
        past = (datetime.now(timezone.utc) - timedelta(minutes=5)).replace(second=0, microsecond=0).isoformat()
        response = requests.patch(
            f"{API}/categories/cleanup-schedule",
            json={"enabled": True, "next_run_at": past, "recurrence": "daily"},
            timeout=20,
        )
        assert response.status_code == 400, response.text
        detail = response.json().get("detail")
        assert "future" in detail.lower()

    # schedule write/read persistence path
    def test_patch_persists_future_utc_recurrence_and_pause_toggle(self, mongo_db, restore_schedule):
        future = (datetime.now(timezone.utc) + timedelta(days=2)).replace(second=0, microsecond=0).isoformat()

        updated = requests.patch(
            f"{API}/categories/cleanup-schedule",
            json={"enabled": True, "next_run_at": future, "recurrence": "weekly"},
            timeout=20,
        )
        assert updated.status_code == 200, updated.text
        body = updated.json()
        assert body["enabled"] is True
        assert body["recurrence"] == "weekly"
        assert body["next_run_at"] == future

        persisted = mongo_db.category_cleanup_schedule.find_one({"id": "singleton"}, {"_id": 0})
        assert persisted["enabled"] is True
        assert persisted["recurrence"] == "weekly"
        assert persisted["next_run_at"] == future

        paused = requests.patch(f"{API}/categories/cleanup-schedule", json={"enabled": False}, timeout=20)
        assert paused.status_code == 200, paused.text
        paused_body = paused.json()
        assert paused_body["enabled"] is False
        assert paused_body["next_run_at"] == future

    # cleanup preview path (must not delete)
    def test_dry_run_finds_empty_categories_without_deleting(self):
        name = f"Cleanup Preview {uuid.uuid4().hex[:8]}"
        created = requests.post(f"{API}/categories", json={"name": name, "group": "QA"}, timeout=20)
        assert created.status_code == 200, created.text
        category = created.json()
        try:
            preview = requests.post(f"{API}/categories/cleanup-empty", params={"dry_run": "true"}, timeout=20)
            assert preview.status_code == 200, preview.text
            body = preview.json()
            assert body["deleted"] == 0
            assert isinstance(body.get("would_delete"), int)
            assert body["would_delete"] >= 1
            assert body["candidates"] == body["removed_categories"]
            candidates = body.get("removed_categories") or []
            assert any(row.get("id") == category["id"] for row in candidates)

            categories = requests.get(f"{API}/categories", timeout=20).json()["categories"]
            assert any(row["id"] == category["id"] for row in categories)
        finally:
            deleted = requests.delete(f"{API}/categories/{category['id']}", timeout=20)
            assert deleted.status_code == 200, deleted.text