"""Tests for the /api/branding endpoint (dashboard name + logo)."""
from __future__ import annotations

import base64
import os
import pathlib

import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    for line in pathlib.Path("/app/frontend/.env").read_text().splitlines():
        if line.startswith("REACT_APP_BACKEND_URL="):
            BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
API = f"{BASE_URL}/api"

# 1x1 transparent PNG — enough to prove the data-URL round-trips.
TINY_PNG = (
    "data:image/png;base64,"
    + base64.b64encode(bytes.fromhex(
        "89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C489"
        "0000000A49444154789C6300010000000500010D0A2DB40000000049454E44AE426082"
    )).decode()
)


def _reset():
    requests.put(f"{API}/branding", json={
        "name": "Aussie Admin",
        "subtitle": "v1.1 · AU",
        "logo": None,
    }, timeout=10)


def setup_function(_fn): _reset()
def teardown_function(_fn): _reset()


def test_get_branding_returns_defaults_after_reset():
    r = requests.get(f"{API}/branding", timeout=10)
    assert r.status_code == 200
    body = r.json()
    assert body["name"] == "Aussie Admin"
    assert body["subtitle"] == "v1.1 · AU"
    assert body["logo"] is None
    assert body["updated_at"]


def test_put_branding_persists_new_name_and_subtitle():
    r = requests.put(f"{API}/branding", json={
        "name": "Acme Retail Ops",
        "subtitle": "prod · staging",
        "logo": None,
    }, timeout=10)
    assert r.status_code == 200
    body = r.json()
    assert body["name"] == "Acme Retail Ops"
    assert body["subtitle"] == "prod · staging"
    # Re-read on a fresh GET to prove the change hit the DB.
    fresh = requests.get(f"{API}/branding", timeout=10).json()
    assert fresh["name"] == "Acme Retail Ops"


def test_put_branding_accepts_data_url_logo():
    r = requests.put(f"{API}/branding", json={
        "name": "Custom Logo Co",
        "logo": TINY_PNG,
    }, timeout=10)
    assert r.status_code == 200
    body = r.json()
    assert body["logo"] == TINY_PNG


def test_put_branding_rejects_http_url_logo():
    """Only data:image/… URLs allowed — no cross-origin fetching."""
    r = requests.put(f"{API}/branding", json={
        "name": "Bad Logo Co",
        "logo": "https://example.com/logo.png",
    }, timeout=10)
    assert r.status_code == 422
    assert "data:image" in r.json()["detail"]


def test_put_branding_rejects_empty_name():
    r = requests.put(f"{API}/branding", json={
        "name": "",
    }, timeout=10)
    assert r.status_code == 422


def test_put_branding_caps_name_length():
    r = requests.put(f"{API}/branding", json={
        "name": "x" * 200,
    }, timeout=10)
    assert r.status_code == 422


def test_put_branding_can_clear_subtitle_and_logo():
    """Empty subtitle + null logo must persist so admins can drop them."""
    requests.put(f"{API}/branding", json={
        "name": "With subtitle", "subtitle": "SUB", "logo": TINY_PNG,
    }, timeout=10)
    r = requests.put(f"{API}/branding", json={
        "name": "Clean", "subtitle": "", "logo": None,
    }, timeout=10)
    body = r.json()
    assert body["subtitle"] == ""
    assert body["logo"] is None
