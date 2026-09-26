"""Security + delivery contract for email-template test-send flow."""
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


def _mongo():
    client = MongoClient(os.environ["MONGO_URL"])
    return client, client[os.environ["DB_NAME"]]


# Auth/session checks for protected send-test route
def test_01_send_test_route_rejects_anonymous_requests_without_cookie():
    response = requests.post(f"{API}/email-templates/verification/send-test", json={}, timeout=30)
    assert response.status_code == 401
    assert "sign in" in response.json()["detail"].lower()


# Admin login issues server-managed httpOnly cookie
def test_02_admin_login_issues_http_only_session_cookie():
    session = requests.Session()
    response = session.post(
        f"{API}/admin-accounts/login",
        json={"email": "qa@prettycheap.com.au", "password": "QaTest123!"},
        timeout=30,
    )
    assert response.status_code == 200, response.text
    assert "admin_access_token" in session.cookies
    set_cookie = response.headers.get("set-cookie", "")
    assert "HttpOnly" in set_cookie
    assert "SameSite=None" in set_cookie


def test_02b_admin_account_crud_requires_an_authenticated_admin():
    for method, url, payload in [
        (requests.get, f"{API}/admin-accounts", None),
        (requests.post, f"{API}/admin-accounts", {"name": "No Auth", "email": "noauth@example.com", "role": "admin", "password": "password123"}),
        (requests.delete, f"{API}/admin-accounts/not-real", None),
    ]:
        response = method(url, json=payload, timeout=20) if payload else method(url, timeout=20)
        assert response.status_code == 401, response.text


def test_02c_login_lockout_blocks_sixth_invalid_attempt():
    email = f"lockout_{uuid.uuid4().hex[:10]}@example.com"
    try:
        for _ in range(4):
            response = requests.post(f"{API}/admin-accounts/login", json={"email": email, "password": "wrong-password"}, timeout=20)
            assert response.status_code == 401
        fifth = requests.post(f"{API}/admin-accounts/login", json={"email": email, "password": "wrong-password"}, timeout=20)
        assert fifth.status_code == 429
        sixth = requests.post(f"{API}/admin-accounts/login", json={"email": email, "password": "wrong-password"}, timeout=20)
        assert sixth.status_code == 429
    finally:
        client, db = _mongo()
        try:
            db.admin_login_attempts.delete_many({"email": email})
        finally:
            client.close()


def test_02d_credentialed_cors_does_not_allow_untrusted_origins():
    response = requests.options(f"{API}/admin-accounts/login", headers={
        "Origin": "https://evil.example", "Access-Control-Request-Method": "POST",
    }, timeout=20)
    assert response.headers.get("access-control-allow-origin") != "https://evil.example"


def test_02e_manager_session_cannot_send_test_emails():
    qa = requests.Session()
    login = qa.post(f"{API}/admin-accounts/login", json={"email": "qa@prettycheap.com.au", "password": "QaTest123!"}, timeout=20)
    assert login.status_code == 200, login.text
    email = f"manager_{uuid.uuid4().hex[:10]}@example.com"
    created = qa.post(f"{API}/admin-accounts", json={
        "name": "QA Manager", "email": email, "role": "manager", "password": "ManagerPass123!",
    }, timeout=20)
    assert created.status_code == 200, created.text
    try:
        manager = requests.Session()
        signed_in = manager.post(f"{API}/admin-accounts/login", json={"email": email, "password": "ManagerPass123!"}, timeout=20)
        assert signed_in.status_code == 200, signed_in.text
        blocked = manager.post(f"{API}/email-templates/verification/send-test", json={}, timeout=20)
        assert blocked.status_code == 403, blocked.text
    finally:
        qa.delete(f"{API}/admin-accounts/{created.json()['id']}", timeout=20)


@pytest.fixture(scope="module")
def temp_admin_account():
    """Create disposable delivered@resend.dev admin account and clean up send logs."""
    qa = requests.Session()
    login = qa.post(
        f"{API}/admin-accounts/login",
        json={"email": "qa@prettycheap.com.au", "password": "QaTest123!"},
        timeout=30,
    )
    assert login.status_code == 200, login.text

    existing = qa.get(f"{API}/admin-accounts", timeout=30)
    assert existing.status_code == 200, existing.text
    for row in existing.json().get("accounts", []):
        if (row.get("email") or "").lower() == "delivered@resend.dev" and not row.get("is_main"):
            qa.delete(f"{API}/admin-accounts/{row['id']}", timeout=30)

    password = f"Delivered-{uuid.uuid4().hex[:10]}!"
    created = qa.post(
        f"{API}/admin-accounts",
        json={
            "name": "Delivered Sink",
            "email": "delivered@resend.dev",
            "role": "admin",
            "password": password,
        },
        timeout=30,
    )
    assert created.status_code == 200, created.text
    admin = created.json()

    try:
        yield {"id": admin["id"], "email": "delivered@resend.dev", "password": password}
    finally:
        qa.delete(f"{API}/admin-accounts/{admin['id']}", timeout=30)
        client, db = _mongo()
        try:
            db.email_template_test_sends.delete_many({"admin_id": admin["id"]})
        finally:
            client.close()


@pytest.fixture(scope="module")
def temp_admin_session(temp_admin_account):
    sess = requests.Session()
    login = sess.post(
        f"{API}/admin-accounts/login",
        json={"email": temp_admin_account["email"], "password": temp_admin_account["password"]},
        timeout=30,
    )
    assert login.status_code == 200, login.text
    assert "admin_access_token" in sess.cookies
    return sess


# Route contract checks: template-id validation + server-resolved recipient + body hardening
def test_03_send_test_route_rejects_unknown_template_ids_when_authenticated(temp_admin_session):
    response = temp_admin_session.post(
        f"{API}/email-templates/not-real/send-test",
        json={},
        timeout=30,
    )
    assert response.status_code == 404
    assert "not found" in response.json().get("detail", "").lower()


def test_04_send_test_uses_server_side_recipient_and_ignores_caller_payload(temp_admin_session):
    response = temp_admin_session.post(
        f"{API}/email-templates/verification/send-test",
        json={
            "to": ["attacker@example.com"],
            "subject": "Injected subject",
            "html": "<p>Injected html</p>",
        },
        timeout=45,
    )
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["sent"] is True
    assert data["template_id"] == "verification"
    assert "delivered@resend.dev" in data["message"].lower()
    assert "attacker@example.com" not in data["message"].lower()


# Per-admin rate-limit guardrail checks
def test_05_rate_limit_blocks_second_send_within_60_seconds(temp_admin_session):
    response = temp_admin_session.post(
        f"{API}/email-templates/verification/send-test",
        json={},
        timeout=30,
    )
    assert response.status_code == 429, response.text
    assert "one minute" in response.json().get("detail", "").lower()