"""Provider-usage dashboard API regressions.

Module focus: auth, YYYY-MM validation, historical totals, and secret-free rows.
"""
from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

import requests

sys.path.insert(0, "/app/backend")
import server  # noqa: E402


ADMIN_EMAIL = "qa@prettycheap.com.au"
ADMIN_PASSWORD = "QaTest123!"


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


def _run(coro):
    try:
        loop = asyncio.get_event_loop()
        if loop.is_closed():
            raise RuntimeError("closed")
    except Exception:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
    return loop.run_until_complete(coro)


BASE_URL = _base_url()


def _login_admin() -> requests.Session:
    session = requests.Session()
    resp = session.post(
        f"{BASE_URL}/api/admin-accounts/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=30,
    )
    assert resp.status_code == 200
    return session


def test_provider_usage_requires_authenticated_admin():
    resp = requests.get(f"{BASE_URL}/api/scraper/provider-usage", timeout=30)
    assert resp.status_code == 401


def test_provider_usage_rejects_invalid_period_format():
    session = _login_admin()
    resp = session.get(
        f"{BASE_URL}/api/scraper/provider-usage",
        params={"period": "2026-13"},
        timeout=30,
    )
    assert resp.status_code == 400
    assert "YYYY-MM" in (resp.json().get("detail") or "")


def test_provider_usage_historical_month_totals_and_secret_free_rows():
    session = _login_admin()
    period = "1999-01"

    async def seed_usage():
        await server.db.scraper_provider_usage.delete_many({
            "period": period,
            "provider_id": {"$in": ["scrapingbee", "scraperapi"]},
        })
        await server.db.scraper_provider_usage.insert_many([
            {
                "provider_id": "scrapingbee",
                "period": period,
                "requests": 3,
                "successful_requests": 2,
                "failed_requests": 1,
                "last_used_at": "1999-01-15T00:00:00+00:00",
                "created_at": "1999-01-15T00:00:00+00:00",
            },
            {
                "provider_id": "scraperapi",
                "period": period,
                "requests": 1,
                "successful_requests": 1,
                "failed_requests": 0,
                "last_used_at": "1999-01-16T00:00:00+00:00",
                "created_at": "1999-01-16T00:00:00+00:00",
            },
        ])

    async def cleanup_usage():
        await server.db.scraper_provider_usage.delete_many({
            "period": period,
            "provider_id": {"$in": ["scrapingbee", "scraperapi"]},
        })

    _run(seed_usage())
    try:
        resp = session.get(
            f"{BASE_URL}/api/scraper/provider-usage",
            params={"period": period},
            timeout=30,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data.get("period") == period

        providers = data.get("providers") or []
        provider_map = {row.get("id"): row for row in providers}
        assert "scrapingbee" in provider_map
        assert "scraperapi" in provider_map

        sb = provider_map["scrapingbee"]
        sa = provider_map["scraperapi"]
        assert sb["requests"] == 3
        assert sb["successful_requests"] == 2
        assert sb["failed_requests"] == 1
        assert sa["requests"] == 1
        assert sa["successful_requests"] == 1
        assert sa["failed_requests"] == 0

        totals = data.get("totals") or {}
        assert totals.get("requests") == 4
        assert totals.get("successful_requests") == 3
        assert totals.get("failed_requests") == 1

        for row in providers:
            assert "api_key" not in row
            assert "username" not in row
            assert "password" not in row
    finally:
        _run(cleanup_usage())
