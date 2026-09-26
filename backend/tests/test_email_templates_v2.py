"""Regression coverage for the multi-template transactional email editor."""
from __future__ import annotations

import os
import pathlib
import copy
import sys
import fcntl

import pytest
import requests
from dotenv import load_dotenv
from pymongo import MongoClient

sys.path.insert(0, "/app/backend")
from helpers import _render_email_template, render_branded_message_email


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
TEMPLATE_IDS = {"verification", "order_confirmation", "order_shipped", "order_delivered", "password_reset", "welcome", "refund_confirmation"}


def _collection():
    client = MongoClient(os.environ["MONGO_URL"])
    return client, client[os.environ["DB_NAME"]].email_templates


@pytest.fixture(scope="module", autouse=True)
def restore_email_templates():
    with open("/tmp/pcadmin-email-template-tests.lock", "w") as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        client, collection = _collection()
        snapshot = collection.find_one({"_id": "singleton"})
        try:
            yield
        finally:
            collection.delete_one({"_id": "singleton"})
            if snapshot:
                collection.replace_one({"_id": "singleton"}, snapshot, upsert=True)
            client.close()
            fcntl.flock(lock.fileno(), fcntl.LOCK_UN)


def test_get_backfills_brand_and_every_template():
    response = requests.get(f"{API}/email-templates", timeout=20)
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["brand_name"]
    assert TEMPLATE_IDS.issubset(data)
    for template_id in TEMPLATE_IDS:
        assert {"subject", "heading", "body", "button_label", "accent_color", "logo_url", "footer"}.issubset(data[template_id])


def test_brand_and_individual_template_save_persist():
    brand = requests.patch(f"{API}/email-templates/brand", json={"brand_name": "QA Mail Brand"}, timeout=20)
    assert brand.status_code == 200, brand.text
    assert brand.json()["brand_name"] == "QA Mail Brand"

    changed = requests.patch(f"{API}/email-templates/order_shipped", json={
        "subject": "Tracking #{order_id}", "heading": "It is moving", "body": "Hi {name}",
        "button_label": "Track", "accent_color": "#0F766E", "logo_url": "", "footer": "QA footer",
    }, timeout=20)
    assert changed.status_code == 200, changed.text
    assert changed.json()["template_id"] == "order_shipped"
    assert changed.json()["template"]["heading"] == "It is moving"

    client, collection = _collection()
    try:
        doc = collection.find_one({"_id": "singleton"}, {"_id": 0})
        assert doc["brand_name"] == "QA Mail Brand"
        assert doc["order_shipped"]["heading"] == "It is moving"
    finally:
        client.close()


def test_template_validation_rejects_unknown_unsafe_logo_and_bad_colour():
    unknown = requests.patch(f"{API}/email-templates/not-real", json={"heading": "Nope"}, timeout=20)
    assert unknown.status_code == 404
    color = requests.patch(f"{API}/email-templates/welcome", json={"accent_color": "blue"}, timeout=20)
    assert color.status_code == 400
    logo = requests.patch(f"{API}/email-templates/welcome", json={"logo_url": "http://example.com/logo.png"}, timeout=20)
    assert logo.status_code == 400


def test_renderer_uses_saved_brand_and_escapes_placeholder_values():
    template = requests.get(f"{API}/email-templates", timeout=20).json()["verification"]
    subject, html = _render_email_template(
        template, {"name": "Jordan <script>", "email": "jordan@example.com"},
        "https://store.example.com/verify?token=test", "PrettyCheap",
    )
    assert "PrettyCheap" in html
    assert "Jordan &lt;script&gt;" in html
    assert "<script>" not in html
    assert subject


def test_non_template_messages_use_the_editable_brand(loop=None):
    async def render():
        return await render_branded_message_email("A personal update", "Hi Jordan", "Reply if you need help.")
    import asyncio
    html = asyncio.run(render())
    assert "A personal update" in html
    assert "PCAdmin" in html or "QA Mail Brand" in html