"""Scraper imports are hidden drafts until the dedicated publish action."""
from __future__ import annotations

import os
import pathlib
import uuid

import requests
from dotenv import load_dotenv
from pymongo import MongoClient


def _api_url() -> str:
    value = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
    if value:
        return f"{value}/api"
    for line in pathlib.Path("/app/frontend/.env").read_text().splitlines():
        if line.startswith("REACT_APP_BACKEND_URL="):
            return f"{line.split('=', 1)[1].strip().rstrip('/')}/api"
    raise RuntimeError("REACT_APP_BACKEND_URL is not configured")


API = _api_url()
load_dotenv("/app/backend/.env")


def _items():
    client = MongoClient(os.environ["MONGO_URL"])
    return client, client[os.environ["DB_NAME"]].items


def test_scraper_added_product_starts_as_draft_then_publishes():
    client, items = _items()
    item_id = f"draft-item-{uuid.uuid4().hex}"
    items.insert_one({"id": item_id, "title": "Draft import QA", "price_value": 24.5, "images": [], "category": "other", "item_id": item_id, "url": f"https://www.ebay.com.au/itm/{item_id}"})
    product_id = None
    try:
        created = requests.post(f"{API}/products/from-item/{item_id}", timeout=20)
        assert created.status_code == 200, created.text
        product = created.json()
        product_id = product["id"]
        assert product["draft"] is True
        assert product["active"] is False

        saved = requests.patch(f"{API}/products/{product_id}", json={"title": "Draft import updated", "active": False}, timeout=20)
        assert saved.status_code == 200, saved.text
        blocked = requests.patch(f"{API}/products/{product_id}", json={"active": True}, timeout=20)
        assert blocked.status_code == 409

        hidden = requests.get(f"{API}/store/products/{product_id}", timeout=20)
        assert hidden.status_code == 404
        published = requests.post(f"{API}/products/{product_id}/publish", timeout=20)
        assert published.status_code == 200, published.text
        assert published.json()["draft"] is False
        assert published.json()["active"] is True
        visible = requests.get(f"{API}/store/products/{product_id}", timeout=20)
        assert visible.status_code == 200, visible.text
    finally:
        if product_id:
            requests.delete(f"{API}/products/{product_id}", timeout=20)
        items.delete_one({"id": item_id})
        client.close()


def test_manual_product_defaults_to_active_non_draft():
    created = requests.post(f"{API}/products", json={
        "title": f"TEST_manual_default_{uuid.uuid4().hex[:8]}",
        "sku": f"TEST-manual-{uuid.uuid4().hex[:6]}",
        "price": 41.95,
        "cost": 12.0,
        "stock": 5,
        "category": "other",
    }, timeout=20)
    assert created.status_code == 200, created.text
    product = created.json()
    product_id = product["id"]
    try:
        assert product["active"] is True
        assert product["draft"] is False
        public = requests.get(f"{API}/store/products/{product_id}", timeout=20)
        assert public.status_code == 200, public.text
    finally:
        requests.delete(f"{API}/products/{product_id}", timeout=20)


def test_manual_draft_publish_response_marks_non_draft():
    created = requests.post(f"{API}/products", json={
        "title": f"TEST_manual_draft_{uuid.uuid4().hex[:8]}",
        "sku": f"TEST-draft-{uuid.uuid4().hex[:6]}",
        "price": 31.95,
        "cost": 10.0,
        "stock": 4,
        "category": "other",
        "active": False,
        "draft": True,
    }, timeout=20)
    assert created.status_code == 200, created.text
    product_id = created.json()["id"]
    try:
        published = requests.post(f"{API}/products/{product_id}/publish", timeout=20)
        assert published.status_code == 200, published.text
        response_doc = published.json()
        assert response_doc["draft"] is False
        assert response_doc["active"] is True

        reloaded = requests.get(f"{API}/products/{product_id}", timeout=20)
        assert reloaded.status_code == 200, reloaded.text
        assert reloaded.json()["draft"] is False
        assert reloaded.json()["active"] is True
    finally:
        requests.delete(f"{API}/products/{product_id}", timeout=20)