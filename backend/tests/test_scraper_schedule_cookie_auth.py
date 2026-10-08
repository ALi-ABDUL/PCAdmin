"""Scraper schedule + scraper settings auth regressions.

Verifies admin login issues HTTP-only session cookie and protected scraper
endpoints accept authenticated browser-style cookie sessions.
"""

from __future__ import annotations

import os
from pathlib import Path

import requests


def _read_env_value(path: str, key: str) -> str:
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        if not line or line.strip().startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        if k.strip() == key:
            return v.strip()
    return ""


def _base_url() -> str:
    env_url = (os.environ.get("REACT_APP_BACKEND_URL") or "").strip()
    if env_url:
        return env_url.rstrip("/")
    file_url = _read_env_value("/app/frontend/.env", "REACT_APP_BACKEND_URL")
    if not file_url:
        raise RuntimeError("REACT_APP_BACKEND_URL missing")
    return file_url.rstrip("/")


BASE_URL = _base_url()
ADMIN_EMAIL = "qa@prettycheap.com.au"
ADMIN_PASSWORD = "QaTest123!"


def _admin_login_session() -> tuple[requests.Session, requests.Response]:
    session = requests.Session()
    response = session.post(
        f"{BASE_URL}/api/admin-accounts/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=30,
    )
    return session, response


def test_admin_login_sets_http_only_cookie_for_browser_session():
    session, response = _admin_login_session()

    assert response.status_code == 200
    body = response.json()
    assert body.get("email") == ADMIN_EMAIL

    set_cookie = response.headers.get("set-cookie", "")
    assert "admin_access_token=" in set_cookie
    assert "HttpOnly" in set_cookie
    assert "Secure" in set_cookie
    assert "SameSite=None" in set_cookie
    assert "admin_access_token" in session.cookies.get_dict()


def test_anonymous_schedule_request_is_rejected_with_401():
    response = requests.get(f"{BASE_URL}/api/scraper/schedule", timeout=30)

    assert response.status_code == 401
    detail = (response.json() or {}).get("detail", "")
    assert isinstance(detail, str)
    assert detail.strip() != ""


def test_authenticated_schedule_request_succeeds_after_login():
    session, login_response = _admin_login_session()
    assert login_response.status_code == 200

    response = session.get(f"{BASE_URL}/api/scraper/schedule", timeout=30)

    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, dict)
    assert "schedules" in data
    assert isinstance(data.get("schedules"), list)


def test_authenticated_scraper_provider_usage_succeeds_for_admin_session():
    session, login_response = _admin_login_session()
    assert login_response.status_code == 200

    response = session.get(f"{BASE_URL}/api/scraper/provider-usage", timeout=30)

    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, dict)
    assert isinstance(data.get("providers"), list)
    assert isinstance(data.get("totals"), dict)
    assert "requests" in data["totals"]


def test_authenticated_scraper_api_settings_succeeds_for_admin_session():
    session, login_response = _admin_login_session()
    assert login_response.status_code == 200

    response = session.get(f"{BASE_URL}/api/scraper/apis", timeout=30)

    assert response.status_code == 200
    data = response.json()
    providers = data.get("providers")
    assert isinstance(providers, list)
    assert len(providers) >= 1
