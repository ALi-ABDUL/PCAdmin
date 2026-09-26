"""Additional regression coverage for Email Templates v2 behavior."""
from __future__ import annotations

import os
import pathlib
import sys
import fcntl

import pytest
import requests
from dotenv import load_dotenv
from pymongo import MongoClient

sys.path.insert(0, "/app/backend")
from helpers import _render_email_template


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
TEMPLATE_IDS = {
    "verification",
    "order_confirmation",
    "order_shipped",
    "order_delivered",
    "password_reset",
    "welcome",
    "refund_confirmation",
}


def _collection():
    client = MongoClient(os.environ["MONGO_URL"])
    return client, client[os.environ["DB_NAME"]].email_templates


@pytest.fixture(scope="module", autouse=True)
def restore_email_templates_singleton():
    """Restore email_templates singleton after mutation-heavy tests."""
    with open("/tmp/pcadmin-email-template-tests.lock", "w") as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        client, collection = _collection()
        snapshot = collection.find_one({"_id": "singleton"})
        try:
            yield collection
        finally:
            collection.delete_one({"_id": "singleton"})
            if snapshot:
                collection.replace_one({"_id": "singleton"}, snapshot, upsert=True)
            client.close()
            fcntl.flock(lock.fileno(), fcntl.LOCK_UN)


# API validation + migration scenarios for email template settings
def test_patch_template_rejects_blank_update_body():
    response = requests.patch(f"{API}/email-templates/order_shipped", json={}, timeout=20)
    assert response.status_code == 400
    data = response.json()
    assert "No fields to update" in str(data)


def test_patch_template_rejects_unknown_template_id():
    response = requests.patch(f"{API}/email-templates/not_a_template", json={"subject": "X"}, timeout=20)
    assert response.status_code == 404


def test_patch_template_persists_independent_fields_without_clobbering():
    first = requests.patch(
        f"{API}/email-templates/password_reset",
        json={"subject": "TEST subject one"},
        timeout=20,
    )
    assert first.status_code == 200, first.text
    assert first.json()["template"]["subject"] == "TEST subject one"

    second = requests.patch(
        f"{API}/email-templates/password_reset",
        json={"heading": "TEST heading two"},
        timeout=20,
    )
    assert second.status_code == 200, second.text
    updated = second.json()["template"]
    assert updated["heading"] == "TEST heading two"
    assert updated["subject"] == "TEST subject one"


def test_get_email_templates_migrates_legacy_singleton_without_losing_verification(restore_email_templates_singleton):
    collection = restore_email_templates_singleton
    legacy_doc = {
        "_id": "singleton",
        "brand_name": "LegacyBrand",
        "portal_base_url": "https://legacy.example.com",
        "verification": {
            "subject": "Legacy verification subject",
            "heading": "Legacy heading",
            "body": "Hi {name}, please verify",
            "button_label": "Verify now",
            "footer": "Legacy footer",
            "accent_color": "#123456",
            "logo_url": "",
        },
    }
    collection.replace_one({"_id": "singleton"}, legacy_doc, upsert=True)

    response = requests.get(f"{API}/email-templates", timeout=20)
    assert response.status_code == 200, response.text
    data = response.json()

    assert data["brand_name"] == "LegacyBrand"
    assert data["portal_base_url"] == "https://legacy.example.com"
    assert data["verification"]["subject"] == "Legacy verification subject"
    assert TEMPLATE_IDS.issubset(set(data.keys()))
    for template_id in TEMPLATE_IDS:
        assert {"subject", "heading", "body", "button_label", "accent_color", "logo_url", "footer"}.issubset(set(data[template_id].keys()))


def test_renderer_uses_brand_placeholder_and_no_hardcoded_pcadmin():
    template = {
        "subject": "Welcome to {brand_name}",
        "heading": "Hello {name}",
        "body": "Email for {name}",
        "button_label": "Continue",
        "footer": "Thanks, {brand_name}",
        "accent_color": "#4F46E5",
        "logo_url": "",
    }
    subject, html = _render_email_template(template, {"name": "Jordan"}, "https://example.com", "PrettyCheap")
    assert "PrettyCheap" in subject
    assert "PrettyCheap" in html
    assert "PCAdmin" not in html
