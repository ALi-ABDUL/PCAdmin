"""Tests for the Countdown Sale feature."""
from __future__ import annotations

import os
import pathlib
import sys
import uuid
from datetime import datetime, timezone, timedelta

import requests
import pytest

BACKEND = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    for line in pathlib.Path("/app/frontend/.env").read_text().splitlines():
        if line.startswith("REACT_APP_BACKEND_URL="):
            BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
API = f"{BASE_URL}/api"

# Backend module for direct DB access (fast-expire without waiting 60s).
sys.path.insert(0, str(BACKEND))
from server import db  # noqa: E402
from helpers import _now_iso  # noqa: E402
import asyncio  # noqa: E402


def _new_product(**overrides):
    body = {
        "title": overrides.get("title") or f"Countdown Test {uuid.uuid4().hex[:6]}",
        "price": overrides.get("price", 100.0),
        "cost": 50.0,
        "stock": 5,
        "category": "other",
        "sku": f"CD-{uuid.uuid4().hex[:8]}",
    }
    r = requests.post(f"{API}/products", json=body, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


def _cleanup(pid):
    requests.delete(f"{API}/products/{pid}", timeout=10)


# ---------------------------------------------------------------------------
# Model defaults
# ---------------------------------------------------------------------------

def test_new_product_defaults_have_no_countdown():
    p = _new_product()
    try:
        assert p["countdown_enabled"] is False
        assert p["countdown_expired"] is False
        assert p["countdown_sale_price"] is None
        assert p["countdown_started_at"] is None
        assert p["countdown_ends_at"] is None
    finally:
        _cleanup(p["id"])


# ---------------------------------------------------------------------------
# Start / Stop / Restore
# ---------------------------------------------------------------------------

def test_start_countdown_sets_all_fields_and_end_date():
    p = _new_product(price=200.0)
    try:
        r = requests.post(f"{API}/products/{p['id']}/countdown/start",
                          json={"duration_days": 5, "sale_price": 149.99},
                          timeout=10)
        assert r.status_code == 200
        f = r.json()
        assert f["countdown_enabled"] is True
        assert f["countdown_expired"] is False
        assert f["countdown_sale_price"] == 149.99
        assert f["countdown_duration_days"] == 5
        assert f["countdown_started_at"]
        assert f["countdown_ends_at"]
        # End = start + 5 days (± 5 seconds tolerance for round-trip time).
        started = datetime.fromisoformat(f["countdown_started_at"])
        ends = datetime.fromisoformat(f["countdown_ends_at"])
        assert timedelta(days=5) - (ends - started) < timedelta(seconds=5)
    finally:
        _cleanup(p["id"])


def test_start_countdown_rejects_bad_input():
    p = _new_product()
    try:
        # duration_days out of range
        r = requests.post(f"{API}/products/{p['id']}/countdown/start",
                          json={"duration_days": 0, "sale_price": 10}, timeout=10)
        assert r.status_code == 422
        r = requests.post(f"{API}/products/{p['id']}/countdown/start",
                          json={"duration_days": 400, "sale_price": 10}, timeout=10)
        assert r.status_code == 422
        # sale_price must be > 0
        r = requests.post(f"{API}/products/{p['id']}/countdown/start",
                          json={"duration_days": 3, "sale_price": 0}, timeout=10)
        assert r.status_code == 422
    finally:
        _cleanup(p["id"])


def test_stop_countdown_clears_fields_but_keeps_active():
    p = _new_product()
    try:
        requests.post(f"{API}/products/{p['id']}/countdown/start",
                      json={"duration_days": 3, "sale_price": 49}, timeout=10)
        r = requests.post(f"{API}/products/{p['id']}/countdown/stop", timeout=10)
        assert r.status_code == 200
        f = r.json()
        assert f["countdown_enabled"] is False
        assert f["countdown_sale_price"] is None
        assert f["countdown_started_at"] is None
        assert f["countdown_ends_at"] is None
        # Product must remain active — stopping is not the same as expiring.
        assert f["active"] is True
    finally:
        _cleanup(p["id"])


def test_start_on_expired_product_reactivates_it():
    """Starting a fresh countdown on a previously-expired product should
    flip `active=True` and clear `countdown_expired`."""
    p = _new_product()
    try:
        # Force it into the expired state by hitting the DB directly.
        asyncio.get_event_loop().run_until_complete(db.products.update_one(
            {"id": p["id"]},
            {"$set": {"countdown_enabled": True, "countdown_expired": True, "active": False}},
        ))
        r = requests.post(f"{API}/products/{p['id']}/countdown/start",
                          json={"duration_days": 2, "sale_price": 25}, timeout=10)
        assert r.status_code == 200
        f = r.json()
        assert f["active"] is True
        assert f["countdown_expired"] is False
    finally:
        _cleanup(p["id"])


def test_restore_clears_countdown_and_reactivates():
    p = _new_product()
    try:
        # Simulate an expired countdown.
        asyncio.get_event_loop().run_until_complete(db.products.update_one(
            {"id": p["id"]},
            {"$set": {
                "countdown_enabled": True,
                "countdown_expired": True,
                "countdown_sale_price": 30,
                "countdown_duration_days": 1,
                "active": False,
            }},
        ))
        r = requests.post(f"{API}/products/{p['id']}/countdown/restore", timeout=10)
        assert r.status_code == 200
        f = r.json()
        assert f["active"] is True
        assert f["countdown_enabled"] is False
        assert f["countdown_expired"] is False
        assert f["countdown_sale_price"] is None
    finally:
        _cleanup(p["id"])


# ---------------------------------------------------------------------------
# Auto-expiry sweep
# ---------------------------------------------------------------------------

def test_expire_sweep_flags_products_past_end_time():
    p = _new_product()
    try:
        # Insert a countdown that already ended 1 minute ago.
        past = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
        asyncio.get_event_loop().run_until_complete(db.products.update_one(
            {"id": p["id"]},
            {"$set": {
                "countdown_enabled": True,
                "countdown_expired": False,
                "countdown_ends_at": past,
                "active": True,
            }},
        ))
        # Trigger the sweep directly.
        from server import _expire_countdowns
        modified = asyncio.get_event_loop().run_until_complete(_expire_countdowns())
        assert modified >= 1
        fresh = requests.get(f"{API}/products/{p['id']}", timeout=10).json()
        assert fresh["countdown_expired"] is True
        assert fresh["active"] is False
    finally:
        _cleanup(p["id"])


# ---------------------------------------------------------------------------
# Listing filters
# ---------------------------------------------------------------------------

def test_countdown_status_filter_active_lists_only_running():
    p = _new_product()
    try:
        requests.post(f"{API}/products/{p['id']}/countdown/start",
                      json={"duration_days": 3, "sale_price": 40}, timeout=10)
        r = requests.get(f"{API}/products",
                         params={"countdown_status": "active", "limit": 500},
                         timeout=15).json()
        ids = {pp["id"] for pp in r["products"]}
        assert p["id"] in ids
    finally:
        _cleanup(p["id"])


def test_countdown_status_filter_expired_hides_active():
    """The Product Countdown sidebar page passes `countdown_status=expired`
    — only expired ones should surface."""
    p_active = _new_product()
    p_expired = _new_product()
    try:
        requests.post(f"{API}/products/{p_active['id']}/countdown/start",
                      json={"duration_days": 3, "sale_price": 40}, timeout=10)
        # Manually mark p_expired as expired.
        asyncio.get_event_loop().run_until_complete(db.products.update_one(
            {"id": p_expired["id"]},
            {"$set": {"countdown_enabled": True, "countdown_expired": True, "active": False}},
        ))
        r = requests.get(f"{API}/products",
                         params={"countdown_status": "expired", "limit": 500},
                         timeout=15).json()
        ids = {pp["id"] for pp in r["products"]}
        assert p_expired["id"] in ids
        assert p_active["id"] not in ids
    finally:
        _cleanup(p_active["id"])
        _cleanup(p_expired["id"])


def test_default_list_hides_expired_products():
    """Expired-countdown products must NOT appear in the main Products
    list — the whole point of the feature is auto-archival."""
    p = _new_product()
    try:
        asyncio.get_event_loop().run_until_complete(db.products.update_one(
            {"id": p["id"]},
            {"$set": {"countdown_enabled": True, "countdown_expired": True, "active": False}},
        ))
        r = requests.get(f"{API}/products", params={"limit": 500}, timeout=15).json()
        ids = {pp["id"] for pp in r["products"]}
        assert p["id"] not in ids
    finally:
        _cleanup(p["id"])
