"""Tests for IP-based country access control middleware + endpoints.

Uses the live server via `requests` (same pattern as the rest of the
backend suite).

The middleware fails-open when the `CF-IPCountry` header is absent — that
lets us drive it deterministically by simply setting or omitting the
header on each call. Cleanup: every test that mutates the singleton restores
its original state so the suite stays order-independent.
"""
from __future__ import annotations

import os
import pathlib
import sys
import time
import uuid

import requests
import pytest

# Serialize this module — all tests mutate the same singleton and would
# stomp on each other under xdist's parallel workers otherwise.
pytestmark = pytest.mark.xdist_group("country_access")

BACKEND = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    for line in pathlib.Path("/app/frontend/.env").read_text().splitlines():
        if line.startswith("REACT_APP_BACKEND_URL="):
            BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
API = f"{BASE_URL}/api"

# Cloudflare / ingress in front of the public URL strips arbitrary
# CF-IPCountry values from clients — the middleware only trusts the header
# on direct-origin hits. Point tests at localhost so our fake headers land.
ORIGIN = "http://localhost:8001/api"


def _reset_settings():
    """Restore the seeded default state (AU + MA allowed, no bypass sessions).

    Note: setup/teardown deliberately omits the `CF-IPCountry` header so
    the middleware fails-open and lets us restore state even if a test
    cleared the allow-list entirely.
    """
    requests.patch(f"{ORIGIN}/security/country-access",
                   json={"allowed_country_codes": ["AU", "MA"]},
                   timeout=10)
    settings = requests.get(f"{ORIGIN}/security/country-access",
                            timeout=10).json()
    for s in settings.get("active_bypass_sessions") or []:
        requests.delete(f"{ORIGIN}/security/bypass-sessions/{s['ip']}",
                        timeout=10)


def setup_function(_fn):
    _reset_settings()


def teardown_function(_fn):
    _reset_settings()


# ---------------------------------------------------------------------------
# Middleware
# ---------------------------------------------------------------------------

def test_missing_cf_header_fails_open():
    """Without CF-IPCountry the middleware must let the request through so
    admins don't lock themselves out during local dev / misconfiguration."""
    r = requests.get(f"{ORIGIN}/products?limit=1", timeout=10)
    assert r.status_code == 200


def test_blocked_country_returns_plain_403():
    r = requests.get(f"{ORIGIN}/products?limit=1",
                     headers={"CF-IPCountry": "US"}, timeout=10)
    assert r.status_code == 403
    body = r.json()
    assert body["code"] == "country_blocked"
    assert body["country"] == "US"
    # Response body is the plain "Access Denied" copy — nothing else leaks.
    assert body["detail"] == "Access Denied"


def test_allowed_country_passes():
    r = requests.get(f"{ORIGIN}/products?limit=1",
                     headers={"CF-IPCountry": "AU"}, timeout=10)
    assert r.status_code == 200


def test_options_preflight_never_blocked():
    """CORS preflights must not be gated or the browser refuses to load
    the app at all."""
    r = requests.options(f"{ORIGIN}/products",
                         headers={"CF-IPCountry": "US",
                                  "Origin": "https://example.com",
                                  "Access-Control-Request-Method": "GET"},
                         timeout=10)
    assert r.status_code < 400


def test_exempt_paths_are_reachable_when_blocked():
    """/api/security/status and /api/security/bypass/... must always answer
    so a blocked user can render the 403 page and use the emergency URL."""
    r = requests.get(f"{ORIGIN}/security/status",
                     headers={"CF-IPCountry": "KP"}, timeout=10)
    assert r.status_code == 200
    body = r.json()
    assert body["country"] == "KP"
    assert body["allowed"] is False


# ---------------------------------------------------------------------------
# Country-access settings CRUD
# ---------------------------------------------------------------------------

def test_default_allow_list_seeded():
    r = requests.get(f"{ORIGIN}/security/country-access",
                     headers={"CF-IPCountry": "AU"}, timeout=10).json()
    assert set(r["allowed_country_codes"]) >= {"AU", "MA"}
    assert r["bypass_token"], "bypass token must be seeded"
    assert r["bypass_url"].endswith(f"/bypass/{r['bypass_token']}")


def test_patch_upper_cases_and_deduplicates_codes():
    r = requests.patch(f"{ORIGIN}/security/country-access",
                       json={"allowed_country_codes": ["au", "au", "MA", "us", "US", "xx"]},
                       headers={"CF-IPCountry": "AU"}, timeout=10).json()
    # au+AU collapse, xx dropped (not ISO), US uppercased
    assert r["allowed_country_codes"] == ["AU", "MA", "US"]


def test_patch_can_clear_allow_list():
    """Empty list is allowed — admin can lock everyone out and rely on
    the bypass URL."""
    r = requests.patch(f"{ORIGIN}/security/country-access",
                       json={"allowed_country_codes": []},
                       headers={"CF-IPCountry": "AU"}, timeout=10)
    assert r.status_code == 200
    # After clearing, an AU request is no longer allowed.
    blocked = requests.get(f"{ORIGIN}/products?limit=1",
                           headers={"CF-IPCountry": "AU"}, timeout=10)
    assert blocked.status_code == 403


def test_regenerate_token_rotates_url():
    before = requests.get(f"{ORIGIN}/security/country-access",
                          headers={"CF-IPCountry": "AU"}, timeout=10).json()
    after = requests.post(f"{ORIGIN}/security/country-access/regenerate-token",
                          headers={"CF-IPCountry": "AU"}, timeout=10).json()
    assert after["bypass_token"] != before["bypass_token"]
    # Fresh URL must be reachable, old must 404.
    ok = requests.get(f"{ORIGIN}/security/bypass/{after['bypass_token']}",
                      allow_redirects=False, timeout=10)
    assert ok.status_code == 303
    stale = requests.get(f"{ORIGIN}/security/bypass/{before['bypass_token']}",
                         allow_redirects=False, timeout=10)
    assert stale.status_code == 404


# ---------------------------------------------------------------------------
# Emergency bypass
# ---------------------------------------------------------------------------

def test_bypass_grants_ip_access_for_24h():
    settings = requests.get(f"{ORIGIN}/security/country-access",
                            headers={"CF-IPCountry": "AU"}, timeout=10).json()
    token = settings["bypass_token"]

    # Confirm the US IP is blocked first.
    blocked_ip = f"203.0.113.{uuid.uuid4().int % 250}"
    r = requests.get(f"{ORIGIN}/products?limit=1",
                     headers={"CF-IPCountry": "US", "CF-Connecting-IP": blocked_ip},
                     timeout=10)
    assert r.status_code == 403

    # Visit the bypass URL from that IP — must 303 redirect + set headers.
    r = requests.get(f"{ORIGIN}/security/bypass/{token}",
                     headers={"CF-IPCountry": "US", "CF-Connecting-IP": blocked_ip},
                     allow_redirects=False, timeout=10)
    assert r.status_code == 303
    assert r.headers.get("x-bypass-granted") == "1"
    assert r.headers.get("x-bypass-expires")

    # Now the same US IP passes.
    r = requests.get(f"{ORIGIN}/products?limit=1",
                     headers={"CF-IPCountry": "US", "CF-Connecting-IP": blocked_ip},
                     timeout=10)
    assert r.status_code == 200

    # Another US IP is still blocked.
    r = requests.get(f"{ORIGIN}/products?limit=1",
                     headers={"CF-IPCountry": "US", "CF-Connecting-IP": "198.51.100.7"},
                     timeout=10)
    assert r.status_code == 403


def test_bypass_wrong_token_never_reveals_shape():
    r = requests.get(f"{ORIGIN}/security/bypass/definitely-not-a-real-token",
                     allow_redirects=False, timeout=10)
    assert r.status_code == 404
    assert r.json() == {"detail": "Not found"}


def test_bypass_session_can_be_revoked():
    settings = requests.get(f"{ORIGIN}/security/country-access",
                            headers={"CF-IPCountry": "AU"}, timeout=10).json()
    token = settings["bypass_token"]
    ip = "192.0.2.42"
    requests.get(f"{ORIGIN}/security/bypass/{token}",
                 headers={"CF-IPCountry": "IR", "CF-Connecting-IP": ip},
                 allow_redirects=False, timeout=10)
    # Session is active — request passes.
    r = requests.get(f"{ORIGIN}/products?limit=1",
                     headers={"CF-IPCountry": "IR", "CF-Connecting-IP": ip},
                     timeout=10)
    assert r.status_code == 200
    # Revoke → blocked again.
    d = requests.delete(f"{ORIGIN}/security/bypass-sessions/{ip}",
                        headers={"CF-IPCountry": "AU"}, timeout=10).json()
    assert d["deleted"] == 1
    r = requests.get(f"{ORIGIN}/products?limit=1",
                     headers={"CF-IPCountry": "IR", "CF-Connecting-IP": ip},
                     timeout=10)
    assert r.status_code == 403


def test_status_reports_active_bypass():
    settings = requests.get(f"{ORIGIN}/security/country-access",
                            headers={"CF-IPCountry": "AU"}, timeout=10).json()
    token = settings["bypass_token"]
    ip = "192.0.2.99"
    requests.get(f"{ORIGIN}/security/bypass/{token}",
                 headers={"CF-IPCountry": "RU", "CF-Connecting-IP": ip},
                 allow_redirects=False, timeout=10)
    status = requests.get(f"{ORIGIN}/security/status",
                          headers={"CF-IPCountry": "RU", "CF-Connecting-IP": ip},
                          timeout=10).json()
    assert status["bypass_active"] is True
    assert status["allowed"] is True
    assert status["country"] == "RU"


# ---------------------------------------------------------------------------
# Metadata endpoints
# ---------------------------------------------------------------------------

def test_country_list_endpoint_returns_full_iso_set():
    r = requests.get(f"{ORIGIN}/security/countries",
                     headers={"CF-IPCountry": "AU"}, timeout=10).json()
    codes = {c["code"] for c in r["countries"]}
    # Sanity: obvious top codes are present.
    for expected in ("AU", "MA", "US", "GB", "JP", "CN", "IN", "BR"):
        assert expected in codes
    assert len(r["countries"]) >= 240
