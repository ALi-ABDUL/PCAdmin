"""Scraper API settings auth/masking/update regressions.

Covers admin login, cookie/session gating, CORS credentials headers,
and add/remove custom provider behavior while preserving built-ins.
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Tuple

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
    env_url = os.environ.get("REACT_APP_BACKEND_URL", "").strip()
    if env_url:
        return env_url.rstrip("/")
    file_url = _read_env_value("/app/frontend/.env", "REACT_APP_BACKEND_URL")
    if not file_url:
        raise RuntimeError("REACT_APP_BACKEND_URL missing")
    return file_url.rstrip("/")


BASE_URL = _base_url()
ADMIN_EMAIL = "qa@prettycheap.com.au"
ADMIN_PASSWORD = "QaTest123!"


def _login_admin() -> Tuple[requests.Session, requests.Response]:
    session = requests.Session()
    resp = session.post(
        f"{BASE_URL}/api/admin-accounts/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=30,
    )
    return session, resp


def test_admin_login_success_sets_http_only_cookie():
    session, resp = _login_admin()
    assert resp.status_code == 200
    body = resp.json()
    assert body["email"] == ADMIN_EMAIL
    set_cookie = resp.headers.get("set-cookie", "")
    assert "admin_access_token=" in set_cookie
    assert "HttpOnly" in set_cookie
    assert "Secure" in set_cookie
    assert "SameSite=None" in set_cookie
    assert "admin_access_token" in session.cookies.get_dict()


def test_admin_login_lockout_after_five_failures_unique_ip():
    session = requests.Session()
    fail_headers = {"X-Forwarded-For": "203.0.113.77"}
    statuses = []
    for _ in range(5):
        resp = session.post(
            f"{BASE_URL}/api/admin-accounts/login",
            json={"email": ADMIN_EMAIL, "password": "wrong-password"},
            headers=fail_headers,
            timeout=30,
        )
        statuses.append(resp.status_code)
    assert statuses[:4] == [401, 401, 401, 401]
    assert statuses[4] == 429


def test_scraper_apis_requires_authenticated_admin():
    resp = requests.get(f"{BASE_URL}/api/scraper/apis", timeout=30)
    assert resp.status_code == 401


def test_scraper_apis_returns_masked_metadata_only():
    session, login_resp = _login_admin()
    assert login_resp.status_code == 200

    resp = session.get(f"{BASE_URL}/api/scraper/apis", timeout=30)
    assert resp.status_code == 200
    data = resp.json()
    providers = data.get("providers") or []

    assert len(providers) >= 6
    ids = [p.get("id") for p in providers]
    for builtin_id in ["scrapingbee", "scraperapi", "scrapedo", "brightdata", "decodo", "webscrapingapi"]:
        assert builtin_id in ids

    for p in providers:
        # Raw secrets must never be present on GET.
        assert "api_key" not in p
        assert "username" not in p
        assert "password" not in p
        # Masked metadata shape must always be present.
        for secret in ("api_key", "username", "password"):
            assert f"{secret}_set" in p
            assert f"{secret}_masked" in p


def test_scraper_apis_patch_add_then_remove_custom_preserves_builtins():
    session, login_resp = _login_admin()
    assert login_resp.status_code == 200

    before = session.get(f"{BASE_URL}/api/scraper/apis", timeout=30)
    assert before.status_code == 200
    before_providers = before.json().get("providers") or []
    before_ids = [p.get("id") for p in before_providers]

    custom_id = "custom-qa-provider"
    custom_payload = {
        "id": custom_id,
        "type": "custom",
        "label": "QA Custom Provider",
        "enabled": True,
        "endpoint": "https://example.com/scrape",
        "request_method": "get",
        "auth_mode": "none",
        "api_key_param": "api_key",
        "url_param": "url",
    }

    add_payload = {
        "providers": [
            *[{"id": p.get("id"), "type": p.get("type"), "label": p.get("label"), "enabled": bool(p.get("enabled"))} for p in before_providers],
            custom_payload,
        ]
    }
    add_resp = session.patch(f"{BASE_URL}/api/scraper/apis", json=add_payload, timeout=30)
    assert add_resp.status_code == 200
    add_ids = [p.get("id") for p in (add_resp.json().get("providers") or [])]
    for builtin_id in ["scrapingbee", "scraperapi", "scrapedo", "brightdata", "decodo", "webscrapingapi"]:
        assert builtin_id in add_ids
    assert custom_id in add_ids

    remove_payload = {
        "providers": [
            {"id": p.get("id"), "type": p.get("type"), "label": p.get("label"), "enabled": bool(p.get("enabled"))}
            for p in before_providers
        ]
    }
    remove_resp = session.patch(f"{BASE_URL}/api/scraper/apis", json=remove_payload, timeout=30)
    assert remove_resp.status_code == 200
    remove_ids = [p.get("id") for p in (remove_resp.json().get("providers") or [])]
    for builtin_id in ["scrapingbee", "scraperapi", "scrapedo", "brightdata", "decodo", "webscrapingapi"]:
        assert builtin_id in remove_ids
    assert custom_id not in remove_ids
    # Ensure no built-in disappeared after roundtrip.
    for builtin_id in ["scrapingbee", "scraperapi", "scrapedo", "brightdata", "decodo", "webscrapingapi"]:
        assert builtin_id in before_ids


def test_scraper_apis_rejects_non_https_custom_endpoint():
    session, login_resp = _login_admin()
    assert login_resp.status_code == 200

    # Keep payload intentionally minimal while including all built-ins.
    current = session.get(f"{BASE_URL}/api/scraper/apis", timeout=30)
    assert current.status_code == 200
    providers = current.json().get("providers") or []
    payload = {
        "providers": [
            *[{"id": p.get("id"), "type": p.get("type"), "label": p.get("label"), "enabled": bool(p.get("enabled"))} for p in providers],
            {
                "id": "custom-http-provider",
                "type": "custom",
                "label": "Invalid HTTP Provider",
                "enabled": True,
                "endpoint": "http://example.com/scrape",
                "request_method": "get",
                "auth_mode": "none",
            },
        ]
    }
    resp = session.patch(f"{BASE_URL}/api/scraper/apis", json=payload, timeout=30)
    assert resp.status_code == 400
    assert "HTTPS" in (resp.json().get("detail") or "")


def test_admin_login_options_has_explicit_origin_and_credentials_headers():
    origin = BASE_URL
    resp = requests.options(
        f"{BASE_URL}/api/admin-accounts/login",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "POST",
        },
        timeout=30,
    )
    # Starlette CORS preflight typically returns 200.
    assert resp.status_code in (200, 204)
    assert resp.headers.get("access-control-allow-credentials") == "true"
    assert resp.headers.get("access-control-allow-origin") == origin
