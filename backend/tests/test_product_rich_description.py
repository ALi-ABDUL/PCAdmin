"""Rich product descriptions retain safe formatting and discard unsafe HTML."""
from __future__ import annotations

import os
import pathlib
import uuid

import requests


def _api_url() -> str:
    value = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
    if value:
        return f"{value}/api"
    for line in pathlib.Path("/app/frontend/.env").read_text().splitlines():
        if line.startswith("REACT_APP_BACKEND_URL="):
            return f"{line.split('=', 1)[1].strip().rstrip('/')}/api"
    raise RuntimeError("REACT_APP_BACKEND_URL is not configured")


API = _api_url()


def test_rich_description_html_persists_and_is_sanitised():
    created = requests.post(f"{API}/products", json={
        "title": f"Rich description QA {uuid.uuid4().hex[:8]}", "sku": f"rich-{uuid.uuid4().hex[:8]}",
        "price": 29.95, "cost": 10, "stock": 8, "category": "other",
    }, timeout=20)
    assert created.status_code == 200, created.text
    product_id = created.json()["id"]
    try:
        description = '<h2>Highlights</h2><p><strong>Bold</strong> and <em>italic</em> text.</p><ul><li>First point</li><li>Second point</li></ul><p><a href="https://example.com">Learn more</a></p><script>alert(1)</script><img src="x" onerror="alert(2)">'
        saved = requests.patch(f"{API}/products/{product_id}", json={"description": description}, timeout=20)
        assert saved.status_code == 200, saved.text
        stored = saved.json()["description"]
        assert "<h2>Highlights</h2>" in stored
        assert "<strong>Bold</strong>" in stored
        assert "<em>italic</em>" in stored
        assert "<ul>" in stored and "<li>First point</li>" in stored
        assert 'href="https://example.com"' in stored
        assert "<script" not in stored and "<img" not in stored and "onerror" not in stored

        reloaded = requests.get(f"{API}/products/{product_id}", timeout=20)
        assert reloaded.status_code == 200, reloaded.text
        assert reloaded.json()["description"] == stored
    finally:
        requests.delete(f"{API}/products/{product_id}", timeout=20)


def test_description_sanitiser_keeps_allowed_tags_and_strips_unsafe_markup():
    created = requests.post(f"{API}/products", json={
        "title": f"Rich sanitiser QA {uuid.uuid4().hex[:8]}", "sku": f"rich-safe-{uuid.uuid4().hex[:8]}",
        "price": 49.95, "cost": 15, "stock": 4, "category": "other",
    }, timeout=20)
    assert created.status_code == 200, created.text
    product_id = created.json()["id"]
    try:
        dirty = (
            '<h3 onclick="alert(1)">Specs</h3>'
            '<p><u>Underlined</u> with <strong>bold</strong> and <em>italic</em></p>'
            '<ol><li>First</li><li>Second</li></ol>'
            '<p><a href="mailto:qa@example.com" onclick="steal()">Email us</a></p>'
            '<p><a href="javascript:alert(1)">Bad link</a></p>'
            '<img src="x" onerror="alert(1)"><script>alert(1)</script>'
        )
        saved = requests.patch(f"{API}/products/{product_id}", json={"description": dirty}, timeout=20)
        assert saved.status_code == 200, saved.text
        stored = saved.json().get("description", "")

        assert "<h3>Specs</h3>" in stored
        assert "<u>Underlined</u>" in stored
        assert "<strong>bold</strong>" in stored
        assert "<em>italic</em>" in stored
        assert "<ol>" in stored and "<li>First</li>" in stored
        assert 'href="mailto:qa@example.com"' in stored

        assert "<script" not in stored
        assert "<img" not in stored
        assert "onclick=" not in stored
        assert "javascript:" not in stored

        reloaded = requests.get(f"{API}/products/{product_id}", timeout=20)
        assert reloaded.status_code == 200, reloaded.text
        assert reloaded.json().get("description") == stored
    finally:
        requests.delete(f"{API}/products/{product_id}", timeout=20)