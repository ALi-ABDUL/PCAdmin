"""Regression coverage for Store Settings → Login Modal Settings APIs and registration validation."""
import os
import uuid
from pathlib import Path

import pytest
import requests


def _base_url() -> str:
    value = (os.environ.get("REACT_APP_BACKEND_URL") or "").strip()
    if value:
        return value.rstrip("/")
    for line in Path("/app/frontend/.env").read_text(encoding="utf-8").splitlines():
        if line.startswith("REACT_APP_BACKEND_URL="):
            return line.split("=", 1)[1].strip().rstrip("/")
    raise RuntimeError("REACT_APP_BACKEND_URL is missing")


API = f"{_base_url()}/api"
ADMIN_EMAIL = "qa@prettycheap.com.au"
ADMIN_PASSWORD = "QaTest123!"


@pytest.fixture
def admin_session() -> requests.Session:
    """Admin-cookie authenticated session for protected Store Settings routes."""
    session = requests.Session()
    response = session.post(
        f"{API}/admin-accounts/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=30,
    )
    assert response.status_code == 200, response.text
    # Core auth contract: admin login sets an httpOnly cookie-backed session.
    assert "admin_access_token" in response.cookies.get_dict()
    return session


@pytest.fixture
def restore_login_modal_settings(admin_session: requests.Session):
    """Snapshot and restore singleton settings after each mutation test."""
    before = admin_session.get(f"{API}/login-modal-settings", timeout=30)
    assert before.status_code == 200, before.text
    original = before.json()
    yield original
    restore_payload = {
        "header_title": original.get("header_title", ""),
        "offer_message": original.get("offer_message", ""),
        "demo_notice": original.get("demo_notice", ""),
        "signup_fields": original.get("signup_fields", []),
    }
    restored = admin_session.patch(f"{API}/login-modal-settings", json=restore_payload, timeout=30)
    assert restored.status_code == 200, restored.text


def test_login_modal_settings_require_admin_cookie():
    assert requests.get(f"{API}/login-modal-settings", timeout=30).status_code == 401
    assert requests.patch(f"{API}/login-modal-settings", json={"header_title": "Nope"}, timeout=30).status_code == 401


def test_admin_can_save_login_modal_and_public_apis_reflect_changes(
    admin_session: requests.Session,
    restore_login_modal_settings,
):
    marker = uuid.uuid4().hex[:8]
    updated = {
        "header_title": f"Member access {marker}",
        "offer_message": "Unlock member pricing when you create your account.",
        "demo_notice": "Demo mode available",
        "signup_fields": [
            {"key": "first_name", "label": "First name", "placeholder": "First name", "type": "text", "required": False},
            {"key": "phone", "label": "Mobile number", "placeholder": "04xx xxx xxx", "type": "tel", "required": True},
        ],
    }
    saved = admin_session.patch(f"{API}/login-modal-settings", json=updated, timeout=30)
    assert saved.status_code == 200, saved.text
    saved_json = saved.json()
    assert saved_json["header_title"] == updated["header_title"]
    assert [f["key"] for f in saved_json["signup_fields"]] == ["first_name", "phone"]
    assert saved_json["signup_fields"][1]["required"] is True

    public_modal = requests.get(f"{API}/store/login-modal", timeout=30)
    assert public_modal.status_code == 200, public_modal.text
    public_json = public_modal.json()
    assert public_json["header_title"] == updated["header_title"]
    assert public_json["offer_message"] == updated["offer_message"]
    assert public_json["signup_fields"][1]["key"] == "phone"

    public_config = requests.get(f"{API}/store/config", timeout=30)
    assert public_config.status_code == 200, public_config.text
    cfg = public_config.json()
    assert cfg["login_modal"]["header_title"] == updated["header_title"]
    # Public endpoints must not expose secrets.
    assert "google_client_secret" not in cfg
    assert "pcstore_internal_secret" not in cfg


def test_patch_rejects_duplicate_signup_field_keys(admin_session: requests.Session):
    payload = {
        "signup_fields": [
            {"key": "phone", "label": "Mobile", "placeholder": "04xx", "type": "tel", "required": False},
            {"key": "phone", "label": "Mobile 2", "placeholder": "04yy", "type": "tel", "required": False},
        ]
    }
    response = admin_session.patch(f"{API}/login-modal-settings", json=payload, timeout=30)
    assert response.status_code == 422
    assert "unique" in str(response.json().get("detail", "")).lower()


def test_patch_rejects_reserved_signup_field_key(admin_session: requests.Session):
    payload = {
        "signup_fields": [
            {"key": "email", "label": "Email", "placeholder": "Email", "type": "text", "required": True}
        ]
    }
    response = admin_session.patch(f"{API}/login-modal-settings", json=payload, timeout=30)
    assert response.status_code == 422
    assert "keys" in str(response.json().get("detail", "")).lower()


def test_patch_rejects_invalid_signup_field_key(admin_session: requests.Session):
    payload = {
        "signup_fields": [
            {"key": "1bad-key", "label": "Bad", "placeholder": "Bad", "type": "text", "required": False}
        ]
    }
    response = admin_session.patch(f"{API}/login-modal-settings", json=payload, timeout=30)
    assert response.status_code == 422
    assert "keys" in str(response.json().get("detail", "")).lower()


def test_registration_requires_configured_required_profile_field(
    admin_session: requests.Session,
    restore_login_modal_settings,
):
    # Make phone required, then submit registration without phone.
    set_required = {
        "signup_fields": [
            {"key": "phone", "label": "Mobile number", "placeholder": "04xx xxx xxx", "type": "tel", "required": True}
        ]
    }
    patched = admin_session.patch(f"{API}/login-modal-settings", json=set_required, timeout=30)
    assert patched.status_code == 200, patched.text

    marker = uuid.uuid4().hex[:8]
    missing_required = requests.post(
        f"{API}/portal/register",
        json={
            "email": f"modal-required-{marker}@example.com",
            "password": "secret123",
            "profile_fields": {},
        },
        timeout=30,
    )
    assert missing_required.status_code == 400
    assert "required" in str(missing_required.json().get("detail", "")).lower()


def test_registration_rejects_unconfigured_profile_field_key(
    admin_session: requests.Session,
    restore_login_modal_settings,
):
    # Keep only phone in schema, then submit unknown key.
    set_schema = {
        "signup_fields": [
            {"key": "phone", "label": "Mobile number", "placeholder": "04xx xxx xxx", "type": "tel", "required": False}
        ]
    }
    patched = admin_session.patch(f"{API}/login-modal-settings", json=set_schema, timeout=30)
    assert patched.status_code == 200, patched.text

    marker = uuid.uuid4().hex[:8]
    unknown = requests.post(
        f"{API}/portal/register",
        json={
            "email": f"modal-unknown-{marker}@example.com",
            "password": "secret123",
            "profile_fields": {"not_enabled": "x", "phone": "0412 345 678"},
        },
        timeout=30,
    )
    assert unknown.status_code == 422
    assert "not enabled" in str(unknown.json().get("detail", "")).lower()