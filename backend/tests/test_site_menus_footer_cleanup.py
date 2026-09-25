"""Regression tests for Store Management → Site Menus footer cleanup behavior."""
import copy
import fcntl
import os
from pathlib import Path

import pytest
import requests
from dotenv import load_dotenv
from pymongo import MongoClient


def _api_url() -> str:
    for line in Path("/app/frontend/.env").read_text().splitlines():
        if line.startswith("REACT_APP_BACKEND_URL="):
            return f"{line.split('=', 1)[1].strip().rstrip('/')}/api"
    raise RuntimeError("REACT_APP_BACKEND_URL is not configured")


API = _api_url()
load_dotenv("/app/backend/.env")


@pytest.fixture(scope="module", autouse=True)
def site_menus_lock():
    with open("/tmp/pcadmin-site-menus-tests.lock", "w") as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        yield
        fcntl.flock(lock.fileno(), fcntl.LOCK_UN)


def _mongo_collection():
    mongo = MongoClient(os.environ["MONGO_URL"])
    return mongo, mongo[os.environ["DB_NAME"]].site_menus


@pytest.fixture
def site_menus_snapshot():
    """Preserve and restore the singleton around each test."""
    mongo, collection = _mongo_collection()
    try:
        original = collection.find_one({"id": "singleton"})
        if original is None:
            bootstrap = requests.get(f"{API}/site-menus", timeout=20)
            assert bootstrap.status_code == 200, bootstrap.text
            original = collection.find_one({"id": "singleton"})
        yield copy.deepcopy(original)
    finally:
        if original is None:
            collection.delete_one({"id": "singleton"})
        else:
            collection.replace_one({"id": "singleton"}, original, upsert=True)
        mongo.close()


class TestSiteMenusFooterCleanup:
    # Module: site_menus footer contract and persistence
    def test_get_site_menus_exposes_footer_enabled_links_custom_text(self, site_menus_snapshot):
        response = requests.get(f"{API}/site-menus", timeout=20)
        assert response.status_code == 200, response.text
        data = response.json()

        assert "footer" in data
        assert isinstance(data["footer"], dict)
        assert set(["enabled", "links", "custom_text"]).issubset(set(data["footer"].keys()))
        assert isinstance(data["footer"]["enabled"], bool)
        assert isinstance(data["footer"]["links"], list)
        assert isinstance(data["footer"]["custom_text"], str)

    def test_get_migrates_missing_footer_without_losing_faq_or_contact(self, site_menus_snapshot):
        mongo, collection = _mongo_collection()
        try:
            custom_faq = [{"id": "keep-faq", "question": "Keep Q", "answer": "Keep A"}]
            custom_contact = {"enabled": False, "title": "Keep Contact"}
            collection.update_one(
                {"id": "singleton"},
                {
                    "$set": {"faq_items": custom_faq, "contact_form": custom_contact},
                    "$unset": {"footer": ""},
                },
            )

            response = requests.get(f"{API}/site-menus", timeout=20)
            assert response.status_code == 200, response.text
            data = response.json()
            assert data["footer"] == {"enabled": True, "links": [], "custom_text": ""}
            assert data["faq_items"] == custom_faq
            assert data["contact_form"] == custom_contact

            persisted = collection.find_one({"id": "singleton"}, {"_id": 0})
            assert persisted["footer"] == {"enabled": True, "links": [], "custom_text": ""}
            assert persisted["faq_items"] == custom_faq
            assert persisted["contact_form"] == custom_contact
        finally:
            mongo.close()

    def test_patch_footer_persists_and_keeps_other_sections_unchanged(self, site_menus_snapshot):
        baseline = requests.get(f"{API}/site-menus", timeout=20)
        assert baseline.status_code == 200, baseline.text
        baseline_data = baseline.json()

        footer = {
            "enabled": False,
            "links": [
                {
                    "id": "footer-page-returns",
                    "label": "Returns",
                    "link_type": "page",
                    "page": "returns-policy",
                    "url": "",
                },
                {
                    "id": "footer-url-orders",
                    "label": "Track order",
                    "link_type": "url",
                    "url": "https://example.com/orders",
                    "page": "",
                },
            ],
            "custom_text": "© QA footer contract",
        }
        patched = requests.patch(f"{API}/site-menus", json={"footer": footer}, timeout=20)
        assert patched.status_code == 200, patched.text
        payload = patched.json()

        assert payload["footer"] == footer
        assert payload["get_help"] == baseline_data["get_help"]
        assert payload["faq_items"] == baseline_data["faq_items"]
        assert payload["contact_form"] == baseline_data["contact_form"]

        mongo, collection = _mongo_collection()
        try:
            persisted = collection.find_one({"id": "singleton"}, {"_id": 0})
            assert persisted["footer"] == footer
        finally:
            mongo.close()

    def test_patch_footer_rejects_invalid_payloads(self, site_menus_snapshot):
        no_fields = requests.patch(f"{API}/site-menus", json={}, timeout=20)
        assert no_fields.status_code == 400
        assert "no fields to update" in no_fields.json()["detail"].lower()

        unknown_page = requests.patch(
            f"{API}/site-menus",
            json={"footer": {"links": [{"id": "bad-page", "label": "Broken", "link_type": "page", "page": "does-not-exist"}]}},
            timeout=20,
        )
        assert unknown_page.status_code == 400
        assert "unknown footer page" in unknown_page.json()["detail"].lower()

        missing_external_url = requests.patch(
            f"{API}/site-menus",
            json={"footer": {"links": [{"id": "bad-url", "label": "Broken", "link_type": "url", "url": ""}]}},
            timeout=20,
        )
        assert missing_external_url.status_code == 400
        assert "url is required" in missing_external_url.json()["detail"].lower()

        duplicate_ids = requests.patch(
            f"{API}/site-menus",
            json={
                "footer": {
                    "links": [
                        {"id": "dup-id", "label": "One", "link_type": "page", "page": "faq"},
                        {"id": "dup-id", "label": "Two", "link_type": "url", "url": "https://example.com/two"},
                    ]
                }
            },
            timeout=20,
        )
        assert duplicate_ids.status_code == 400
        assert "unique" in duplicate_ids.json()["detail"].lower()
