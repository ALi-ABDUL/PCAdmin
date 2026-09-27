"""Google Sign-In configuration is admin-only; public reads exclude the secret."""
from __future__ import annotations

import os
import pathlib
import uuid

import pytest
import requests
from dotenv import load_dotenv
from pymongo import MongoClient


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


def _collection():
    client = MongoClient(os.environ["MONGO_URL"])
    return client, client[os.environ["DB_NAME"]].site_settings


@pytest.fixture(scope="module", autouse=True)
def restore_site_settings():
    client, collection = _collection()
    snapshot = collection.find_one({"id": "singleton"})
    try:
        yield
    finally:
        collection.delete_one({"id": "singleton"})
        if snapshot:
            collection.replace_one({"id": "singleton"}, snapshot, upsert=True)
        client.close()


def _admin_session():
    session = requests.Session()
    response = session.post(f"{API}/admin-accounts/login", json={"email": "qa@prettycheap.com.au", "password": "QaTest123!"}, timeout=20)
    assert response.status_code == 200, response.text
    return session


def _manager_session():
    admin = _admin_session()
    email = f"qa-manager-{uuid.uuid4().hex[:8]}@prettycheap.com.au"
    password = "QaTest123!"
    create = admin.post(f"{API}/admin-accounts", json={
        "name": "QA Manager",
        "email": email,
        "role": "manager",
        "password": password,
    }, timeout=20)
    assert create.status_code == 200, create.text
    manager_id = create.json()["id"]

    manager = requests.Session()
    login = manager.post(f"{API}/admin-accounts/login", json={"email": email, "password": password}, timeout=20)
    assert login.status_code == 200, login.text
    return manager, admin, manager_id


def test_public_site_settings_seeds_google_defaults_without_secret():
    response = requests.get(f"{API}/site-settings", timeout=20)
    assert response.status_code == 200, response.text
    data = response.json()
    assert data == {"google_signin_enabled": True, "google_client_id": ""}
    assert "google_client_secret" not in data


def test_google_signin_admin_settings_require_session():
    response = requests.get(f"{API}/site-settings/google-signin", timeout=20)
    assert response.status_code == 401
    response = requests.patch(f"{API}/site-settings/google-signin", json={"google_client_id": "blocked"}, timeout=20)
    assert response.status_code == 401


def test_google_signin_admin_settings_forbid_manager_role():
    manager, admin, manager_id = _manager_session()
    try:
        response = manager.get(f"{API}/site-settings/google-signin", timeout=20)
        assert response.status_code == 403
        response = manager.patch(f"{API}/site-settings/google-signin", json={"google_client_id": "forbidden"}, timeout=20)
        assert response.status_code == 403
    finally:
        admin.delete(f"{API}/admin-accounts/{manager_id}", timeout=20)


def test_admin_save_masks_secret_and_public_proxy_excludes_it():
    session = _admin_session()
    response = session.patch(f"{API}/site-settings/google-signin", json={
        "google_signin_enabled": True,
        "google_client_id": "123.apps.googleusercontent.com",
        "google_client_secret": "GOCSPX-qa-secret-9876",
    }, timeout=20)
    assert response.status_code == 200, response.text
    admin_data = response.json()
    assert admin_data["google_client_secret_set"] is True
    assert admin_data["google_client_secret_masked"].endswith("9876")
    assert "GOCSPX-qa-secret-9876" not in str(admin_data)

    public = requests.get(f"{API}/site-settings", timeout=20).json()
    assert public == {"google_signin_enabled": True, "google_client_id": "123.apps.googleusercontent.com"}
    assert "secret" not in str(public).lower()
    assert "google_client_secret_set" not in public
    assert "google_client_secret_masked" not in public

    client, collection = _collection()
    try:
        stored = collection.find_one({"id": "singleton"}, {"_id": 0})
        assert stored["google_client_secret"] == "GOCSPX-qa-secret-9876"
    finally:
        client.close()


def test_empty_secret_does_not_overwrite_existing_secret():
    session = _admin_session()
    response = session.patch(f"{API}/site-settings/google-signin", json={"google_client_secret": ""}, timeout=20)
    assert response.status_code == 400

    client, collection = _collection()
    try:
        stored = collection.find_one({"id": "singleton"}, {"_id": 0})
        assert stored["google_client_secret"] == "GOCSPX-qa-secret-9876"
    finally:
        client.close()


def test_unknown_payload_keys_are_rejected_with_no_update():
    session = _admin_session()
    response = session.patch(f"{API}/site-settings/google-signin", json={"unexpected": "value"}, timeout=20)
    assert response.status_code == 400