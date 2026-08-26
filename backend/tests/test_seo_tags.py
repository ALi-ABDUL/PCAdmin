"""Tests for SEO tag auto-suggestion + product tags round-trip via the API.

Uses the same requests-against-live-server pattern as the other backend
tests in this repo.
"""
from __future__ import annotations

import os
import sys
import pathlib
import uuid

import requests
import pytest

# Ensure backend package importable regardless of pytest cwd.
BACKEND = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

from helpers import _suggest_tags, _default_seo  # noqa: E402


BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    for line in pathlib.Path("/app/frontend/.env").read_text().splitlines():
        if line.startswith("REACT_APP_BACKEND_URL="):
            BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
API = f"{BASE_URL}/api"


def _uniq(): return f"test-{uuid.uuid4().hex[:8]}"


# -----------------------------------------------------------------------------
# Pure helper tests
# -----------------------------------------------------------------------------

def test_suggest_tags_basic_title():
    tags = _suggest_tags("Sony WH-1000XM5 Wireless Headphones")
    assert "sony" in tags
    assert "wireless" in tags
    assert "headphones" in tags
    assert "the" not in tags and "and" not in tags


def test_suggest_tags_prepends_category_tokens():
    tags = _suggest_tags("Robot Vacuum X500", category="vacuums-cleaning")
    assert tags[0] == "vacuums"
    assert tags[1] == "cleaning"


def test_suggest_tags_dedupes_and_lowercases():
    tags = _suggest_tags("APPLE apple Apple iPhone 15 Pro")
    assert tags.count("apple") == 1
    assert "iphone" in tags and "15" in tags and "pro" in tags


def test_suggest_tags_skips_category_other():
    tags = _suggest_tags("Sample product", category="other")
    assert "other" not in tags


def test_suggest_tags_caps_at_limit():
    long_title = "one two three four five six seven eight nine ten"
    tags = _suggest_tags(long_title, limit=5)
    assert len(tags) == 5


def test_suggest_tags_drops_stopwords():
    tags = _suggest_tags("A cup of coffee is on the table")
    for w in ("a", "of", "is", "on", "the"):
        assert w not in tags
    assert "cup" in tags and "coffee" in tags


def test_suggest_tags_handles_empty_input():
    assert _suggest_tags("") == []
    assert _suggest_tags("", category=None) == []


def test_default_seo_includes_tags():
    seo = _default_seo("Sony WH-1000XM5 Wireless Headphones", "", "electronics")
    assert "tags" in seo
    assert isinstance(seo["tags"], list)
    assert "electronics" in seo["tags"]
    assert "sony" in seo["tags"]


# -----------------------------------------------------------------------------
# API round-trip tests
# -----------------------------------------------------------------------------

def test_create_product_seeds_tags_from_title_and_category():
    r = requests.post(f"{API}/products", json={
        "title": "Dyson V15 Detect Cordless Vacuum",
        "price": 999.0, "cost": 700.0, "stock": 5,
        "category": "vacuums-cleaning",
        "sku": _uniq(),
    }, timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    try:
        assert isinstance(body.get("tags"), list) and len(body["tags"]) > 0
        assert "vacuums" in body["tags"] and "cleaning" in body["tags"]
        assert "dyson" in body["tags"]
    finally:
        requests.delete(f"{API}/products/{body['id']}", timeout=15)


def test_patch_tags_normalises_and_persists():
    r = requests.post(f"{API}/products", json={
        "title": "Test Product for Tags",
        "price": 100.0, "cost": 50.0, "stock": 1,
        "category": "other",
        "sku": _uniq(),
    }, timeout=15)
    pid = r.json()["id"]
    try:
        r = requests.patch(f"{API}/products/{pid}", json={
            "tags": ["Camping", " camping ", "OUTDOOR", "tent", "Tent", ""],
        }, timeout=15)
        assert r.status_code == 200

        fresh = requests.get(f"{API}/products/{pid}", timeout=15).json()
        assert fresh["tags"] == ["camping", "outdoor", "tent"]

        # Clearing via empty list persists.
        r = requests.patch(f"{API}/products/{pid}", json={"tags": []}, timeout=15)
        assert r.status_code == 200
        fresh = requests.get(f"{API}/products/{pid}", timeout=15).json()
        assert fresh["tags"] == []
    finally:
        requests.delete(f"{API}/products/{pid}", timeout=15)


def test_patch_tags_does_not_touch_other_seo_fields():
    r = requests.post(f"{API}/products", json={
        "title": "Another Tag Test",
        "price": 12.0, "cost": 6.0, "stock": 2,
        "category": "other",
        "sku": _uniq(),
    }, timeout=15)
    pid = r.json()["id"]
    try:
        original = requests.get(f"{API}/products/{pid}", timeout=15).json()
        requests.patch(f"{API}/products/{pid}", json={"tags": ["a", "b"]}, timeout=15)
        fresh = requests.get(f"{API}/products/{pid}", timeout=15).json()

        assert fresh["tags"] == ["a", "b"]
        assert fresh["meta_title"] == original["meta_title"]
        assert fresh["meta_description"] == original["meta_description"]
        assert fresh["url_slug"] == original["url_slug"]
        assert fresh["image_alt_text"] == original["image_alt_text"]
    finally:
        requests.delete(f"{API}/products/{pid}", timeout=15)
