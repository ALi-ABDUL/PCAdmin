"""Coverage for Store Management → Site Menus → Customer Support persistence."""
import copy
import fcntl
import os
import time
from pathlib import Path

import pytest
import requests
from dotenv import load_dotenv
from pymongo import MongoClient


def _api_url():
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


class TestSiteMenusSupport:
    # Module: site_menus support singleton read + write + migration behavior
    def test_patch_persists_unique_faq_items_physically_and_in_order(self, site_menus_snapshot):
        marker = str(int(time.time() * 1000))
        faq_items = [
            {
                "id": f"qa-faq-{marker}-2",
                "question": f"Q2 marker {marker}",
                "answer": f"A2 marker {marker}",
            },
            {
                "id": f"qa-faq-{marker}-1",
                "question": f"Q1 marker {marker}",
                "answer": f"A1 marker {marker}",
            },
        ]

        patch_response = requests.patch(f"{API}/site-menus", json={"faq_items": faq_items}, timeout=20)
        assert patch_response.status_code == 200, patch_response.text
        payload = patch_response.json()
        assert payload["faq_items"] == faq_items

        mongo, collection = _mongo_collection()
        try:
            persisted = collection.find_one({"id": "singleton"}, {"_id": 0})
            assert isinstance(persisted.get("faq_items"), list)
            assert persisted["faq_items"] == faq_items
        finally:
            mongo.close()

    def test_get_returns_exact_saved_faq_items_not_hardcoded_defaults(self, site_menus_snapshot):
        marker = str(int(time.time() * 1000))
        faq_items = [
            {
                "id": f"qa-only-{marker}",
                "question": f"Persisted question {marker}",
                "answer": f"Persisted answer {marker}",
            }
        ]

        patch_response = requests.patch(f"{API}/site-menus", json={"faq_items": faq_items}, timeout=20)
        assert patch_response.status_code == 200, patch_response.text

        get_response = requests.get(f"{API}/site-menus", timeout=20)
        assert get_response.status_code == 200, get_response.text
        data = get_response.json()
        assert data["faq_items"] == faq_items

    def test_patch_faq_add_edit_reorder_delete_without_touching_other_fields(self, site_menus_snapshot):
        baseline_response = requests.get(f"{API}/site-menus", timeout=20)
        assert baseline_response.status_code == 200, baseline_response.text
        baseline = baseline_response.json()

        add_payload = [
            {"id": "qa-faq-a", "question": "Question A", "answer": "Answer A"},
            {"id": "qa-faq-b", "question": "Question B", "answer": "Answer B"},
        ]
        added = requests.patch(f"{API}/site-menus", json={"faq_items": add_payload}, timeout=20)
        assert added.status_code == 200, added.text
        assert added.json()["faq_items"] == add_payload

        reorder_edit_payload = [
            {"id": "qa-faq-b", "question": "Question B edited", "answer": "Answer B edited"},
            {"id": "qa-faq-a", "question": "Question A", "answer": "Answer A"},
        ]
        reordered = requests.patch(f"{API}/site-menus", json={"faq_items": reorder_edit_payload}, timeout=20)
        assert reordered.status_code == 200, reordered.text
        assert reordered.json()["faq_items"] == reorder_edit_payload

        delete_payload = [reorder_edit_payload[0]]
        deleted = requests.patch(f"{API}/site-menus", json={"faq_items": delete_payload}, timeout=20)
        assert deleted.status_code == 200, deleted.text
        deleted_data = deleted.json()
        assert deleted_data["faq_items"] == delete_payload

        # Confirm omitted fields are preserved
        assert deleted_data["get_help"] == baseline["get_help"]
        assert deleted_data["contact_form"] == baseline["contact_form"]
        assert deleted_data["footer"] == baseline["footer"]

    def test_footer_persists_enabled_links_and_custom_text(self, site_menus_snapshot):
        footer = {
            "enabled": False,
            "links": [
                {"id": "qa-footer-returns", "label": "Returns", "link_type": "page", "page": "returns-policy", "url": ""},
                {"id": "qa-footer-status", "label": "Order status", "link_type": "url", "url": "https://example.com/orders", "page": ""},
            ],
            "custom_text": "© QA Footer · ABN 12 345 678 901",
        }
        response = requests.patch(f"{API}/site-menus", json={"footer": footer}, timeout=20)
        assert response.status_code == 200, response.text
        assert response.json()["footer"] == footer

        mongo, collection = _mongo_collection()
        try:
            persisted = collection.find_one({"id": "singleton"}, {"_id": 0})
            assert persisted["footer"] == footer
        finally:
            mongo.close()

    def test_footer_rejects_unknown_page_or_missing_external_url(self, site_menus_snapshot):
        bad_page = requests.patch(f"{API}/site-menus", json={"footer": {"links": [
            {"id": "bad-page", "label": "Broken", "link_type": "page", "page": "not-a-page"},
        ]}}, timeout=20)
        assert bad_page.status_code == 400
        assert "unknown footer page" in bad_page.json()["detail"].lower()

        bad_url = requests.patch(f"{API}/site-menus", json={"footer": {"links": [
            {"id": "bad-url", "label": "Broken", "link_type": "url", "url": ""},
        ]}}, timeout=20)
        assert bad_url.status_code == 400
        assert "url is required" in bad_url.json()["detail"].lower()

    def test_legacy_singleton_migration_rehydrates_faq_items_on_get(self, site_menus_snapshot):
        mongo, collection = _mongo_collection()
        try:
            collection.update_one({"id": "singleton"}, {"$unset": {"faq_items": ""}})

            missing = collection.find_one({"id": "singleton"}, {"_id": 0})
            assert "faq_items" not in missing

            get_response = requests.get(f"{API}/site-menus", timeout=20)
            assert get_response.status_code == 200, get_response.text
            data = get_response.json()
            assert isinstance(data.get("faq_items"), list)

            persisted_after_get = collection.find_one({"id": "singleton"}, {"_id": 0})
            assert isinstance(persisted_after_get.get("faq_items"), list)
        finally:
            mongo.close()

    def test_legacy_singleton_migration_adds_footer_on_get(self, site_menus_snapshot):
        mongo, collection = _mongo_collection()
        try:
            collection.update_one({"id": "singleton"}, {"$unset": {"footer": ""}})
            response = requests.get(f"{API}/site-menus", timeout=20)
            assert response.status_code == 200, response.text
            assert response.json()["footer"] == {"enabled": True, "links": [], "custom_text": ""}
            persisted = collection.find_one({"id": "singleton"}, {"_id": 0})
            assert persisted["footer"] == {"enabled": True, "links": [], "custom_text": ""}
        finally:
            mongo.close()

    def test_contact_route_is_explicit_when_disabled_or_key_missing(self, site_menus_snapshot):
        disabled = requests.patch(f"{API}/site-menus", json={"contact_form": {"enabled": False}}, timeout=20)
        assert disabled.status_code == 200, disabled.text
        payload = {"name": "Ada", "email": "ada@example.com", "message": "I need help."}
        response = requests.post(f"{API}/support/contact", json=payload, timeout=20)
        assert response.status_code == 403
        assert "unavailable" in response.json()["detail"].lower()

        contact_form = {**(site_menus_snapshot.get("contact_form") or {}), "enabled": True}
        restored = requests.patch(
            f"{API}/site-menus",
            json={"contact_form": contact_form},
            timeout=20,
        )
        assert restored.status_code == 200
        settings = requests.get(f"{API}/push/settings", timeout=20).json()
        if not settings["resend_api_key_set"]:
            response = requests.post(f"{API}/support/contact", json=payload, timeout=20)
            assert response.status_code == 503
            assert "resend api key is not configured" in response.json()["detail"].lower()