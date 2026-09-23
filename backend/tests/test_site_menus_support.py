"""Coverage for dynamic Storefront support configuration and safe contact failures."""
import os
from pathlib import Path

import pytest
import requests


def _api_url():
    for line in Path("/app/frontend/.env").read_text().splitlines():
        if line.startswith("REACT_APP_BACKEND_URL="):
            return f"{line.split('=', 1)[1].strip().rstrip('/')}/api"
    raise RuntimeError("REACT_APP_BACKEND_URL is not configured")


API = _api_url()


@pytest.fixture
def support_config():
    original_response = requests.get(f"{API}/site-menus", timeout=20)
    assert original_response.status_code == 200, original_response.text
    original = original_response.json()
    yield original
    restore = requests.patch(f"{API}/site-menus", json={
        "get_help": original["get_help"],
        "faq_items": original["faq_items"],
        "contact_form": original["contact_form"],
    }, timeout=20)
    assert restore.status_code == 200, restore.text


class TestSiteMenusSupport:
    def test_get_exposes_dynamic_faq_and_contact_form(self):
        response = requests.get(f"{API}/site-menus", timeout=20)
        assert response.status_code == 200, response.text
        data = response.json()
        assert isinstance(data["faq_items"], list)
        assert {"enabled", "title"}.issubset(data["contact_form"])
        for item in data["faq_items"]:
            assert {"id", "question", "answer"}.issubset(item)

    def test_faqs_can_be_added_edited_reordered_and_deleted(self, support_config):
        original_get_help = support_config["get_help"]
        faq_items = [
            {"id": "faq-second", "question": "Second question", "answer": "Second answer"},
            {"id": "faq-first", "question": "First question edited", "answer": "First answer edited"},
        ]
        response = requests.patch(f"{API}/site-menus", json={
            "faq_items": faq_items,
            "contact_form": {"enabled": False, "title": "Ask the team"},
        }, timeout=20)
        assert response.status_code == 200, response.text
        data = response.json()
        assert data["faq_items"] == faq_items
        assert data["contact_form"] == {"enabled": False, "title": "Ask the team"}
        assert data["get_help"] == original_get_help

        deleted = requests.patch(f"{API}/site-menus", json={"faq_items": [faq_items[1]]}, timeout=20)
        assert deleted.status_code == 200, deleted.text
        deleted_data = deleted.json()
        assert deleted_data["faq_items"] == [faq_items[1]]
        assert deleted_data["get_help"] == original_get_help

    def test_contact_route_is_explicit_when_disabled_or_key_missing(self, support_config):
        disabled = requests.patch(f"{API}/site-menus", json={"contact_form": {"enabled": False}}, timeout=20)
        assert disabled.status_code == 200, disabled.text
        payload = {"name": "Ada", "email": "ada@example.com", "message": "I need help."}
        response = requests.post(f"{API}/support/contact", json=payload, timeout=20)
        assert response.status_code == 403
        assert "unavailable" in response.json()["detail"].lower()

        restored = requests.patch(f"{API}/site-menus", json={"contact_form": support_config["contact_form"]}, timeout=20)
        assert restored.status_code == 200
        settings = requests.get(f"{API}/push/settings", timeout=20).json()
        if not settings["resend_api_key_set"]:
            response = requests.post(f"{API}/support/contact", json=payload, timeout=20)
            assert response.status_code == 503
            assert "resend api key is not configured" in response.json()["detail"].lower()