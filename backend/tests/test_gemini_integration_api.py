"""Gemini integrations API regression tests (auth, masking, model persistence, no-key rewrite)."""

import os

import pytest
import requests
from dotenv import load_dotenv


load_dotenv("/app/frontend/.env")


# Module scope: Gemini settings endpoints + product description rewrite gate behavior.


def _base_url() -> str:
    raw = os.environ.get("REACT_APP_BACKEND_URL")
    if not raw:
        pytest.fail("REACT_APP_BACKEND_URL is required for public-endpoint API tests")
    return raw.rstrip("/")


@pytest.fixture
def admin_session() -> requests.Session:
    session = requests.Session()
    login = session.post(
        f"{_base_url()}/api/admin-accounts/login",
        json={"email": "qa@prettycheap.com.au", "password": "QaTest123!"},
        timeout=30,
    )
    assert login.status_code == 200, login.text
    set_cookie = login.headers.get("set-cookie", "")
    assert "admin_access_token=" in set_cookie
    assert "httponly" in set_cookie.lower()
    assert "admin_access_token" in session.cookies.get_dict()
    yield session

    # Teardown: keep shared QA environment detached + default model restored.
    session.post(f"{_base_url()}/api/integrations/gemini/clear-secret", timeout=20)
    session.patch(
        f"{_base_url()}/api/integrations/gemini",
        json={"model": "gemini-2.5-flash"},
        timeout=20,
    )


def test_gemini_settings_endpoints_require_admin_session():
    base = _base_url()

    anonymous_get = requests.get(f"{base}/api/integrations/gemini", timeout=20)
    assert anonymous_get.status_code in {401, 403}

    anonymous_patch = requests.patch(
        f"{base}/api/integrations/gemini",
        json={"model": "gemini-2.0-flash"},
        timeout=20,
    )
    assert anonymous_patch.status_code in {401, 403}

    anonymous_clear = requests.post(f"{base}/api/integrations/gemini/clear-secret", timeout=20)
    assert anonymous_clear.status_code in {401, 403}


def test_gemini_get_omits_secret_and_persists_selected_model(admin_session: requests.Session):
    base = _base_url()

    clear = admin_session.post(f"{base}/api/integrations/gemini/clear-secret", timeout=20)
    assert clear.status_code == 200, clear.text

    patch = admin_session.patch(
        f"{base}/api/integrations/gemini",
        json={"model": "gemini-2.0-flash"},
        timeout=20,
    )
    assert patch.status_code == 200, patch.text
    saved = patch.json()
    assert saved["model"] == "gemini-2.0-flash"
    assert saved["api_key_set"] is False
    assert saved["status"] == "disconnected"
    assert "api_key" not in saved

    fetched = admin_session.get(f"{base}/api/integrations/gemini", timeout=20)
    assert fetched.status_code == 200, fetched.text
    data = fetched.json()
    assert data["model"] == "gemini-2.0-flash"
    assert data["api_key_set"] is False
    assert data["status"] == "disconnected"
    assert "api_key" not in data


def test_no_key_rewrite_returns_exact_configuration_message(admin_session: requests.Session):
    base = _base_url()

    clear = admin_session.post(f"{base}/api/integrations/gemini/clear-secret", timeout=20)
    assert clear.status_code == 200, clear.text

    response = admin_session.post(
        f"{base}/api/products/description/rewrite",
        json={"description": "<p>Existing copy</p>", "product_title": "Desk Lamp"},
        timeout=20,
    )
    assert response.status_code == 400
    payload = response.json()
    assert payload.get("detail") == "Configure Gemini API in Integrations to use AI Rewrite."


def test_clear_secret_keeps_model_and_disconnected_status(admin_session: requests.Session):
    base = _base_url()

    set_model = admin_session.patch(
        f"{base}/api/integrations/gemini",
        json={"model": "gemini-2.0-flash"},
        timeout=20,
    )
    assert set_model.status_code == 200, set_model.text

    cleared = admin_session.post(f"{base}/api/integrations/gemini/clear-secret", timeout=20)
    assert cleared.status_code == 200, cleared.text
    data = cleared.json()
    assert data["model"] == "gemini-2.0-flash"
    assert data["api_key_set"] is False
    assert data["status"] == "disconnected"
    assert "api_key" not in data