"""Tests for auto-deletion of empty categories when their last product is
deleted (single or bulk). Behaviour is intentionally applied to any slug
including seeded ones — an empty category clutters the sidebar and will be
re-created automatically the next time a scrape hits that slug via
`_ensure_ebay_category`.
"""
import uuid
from pathlib import Path

import requests

BASE_URL = ""
for line in Path("/app/frontend/.env").read_text().splitlines():
    if line.startswith("REACT_APP_BACKEND_URL="):
        BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
API = f"{BASE_URL}/api"


def _new_category():
    name = f"AutoDel-{uuid.uuid4().hex[:6]}"
    r = requests.post(f"{API}/categories",
                      json={"name": name, "group": "General", "icon": "tag", "color": "#000"},
                      timeout=15)
    r.raise_for_status()
    cat = r.json()
    # `POST /categories` returns the record with slug set by the backend.
    if "slug" not in cat:
        # older shape — look it up
        all_cats = requests.get(f"{API}/categories", timeout=15).json()["categories"]
        cat = next(c for c in all_cats if c["id"] == cat["id"])
    return cat


def _new_product(slug):
    body = {"title": f"P-{uuid.uuid4().hex[:6]}", "price": 1, "cost": 1, "stock": 1, "category": slug}
    r = requests.post(f"{API}/products", json=body, timeout=15)
    r.raise_for_status()
    return r.json()


def _category_slugs():
    return {c["slug"] for c in requests.get(f"{API}/categories", timeout=15).json()["categories"]}


class TestAutoDeleteEmptyCategory:
    def test_last_product_delete_removes_category(self):
        cat = _new_category()
        p = _new_product(cat["slug"])
        assert cat["slug"] in _category_slugs()
        r = requests.delete(f"{API}/products/{p['id']}", timeout=15)
        assert r.status_code == 200
        body = r.json()
        assert body["deleted"] is True
        assert cat["slug"] in body.get("removed_categories", [])
        assert cat["slug"] not in _category_slugs()

    def test_category_kept_when_other_products_remain(self):
        cat = _new_category()
        a = _new_product(cat["slug"])
        b = _new_product(cat["slug"])
        try:
            r = requests.delete(f"{API}/products/{a['id']}", timeout=15)
            assert r.status_code == 200
            assert r.json()["removed_categories"] == []
            assert cat["slug"] in _category_slugs()
        finally:
            requests.delete(f"{API}/products/{b['id']}", timeout=15)
            # cleanup: after deleting b the cat auto-deletes too

    def test_bulk_delete_removes_emptied_category(self):
        cat = _new_category()
        ids = [_new_product(cat["slug"])["id"] for _ in range(3)]
        r = requests.post(f"{API}/products/bulk-delete",
                          json={"product_ids": ids}, timeout=15)
        assert r.status_code == 200
        body = r.json()
        assert body["deleted"] == 3
        assert cat["slug"] in body.get("removed_categories", [])
        assert cat["slug"] not in _category_slugs()

    def test_bulk_delete_leaves_category_when_partial(self):
        cat = _new_category()
        ids = [_new_product(cat["slug"])["id"] for _ in range(3)]
        try:
            # Delete only two of the three — category must remain
            r = requests.post(f"{API}/products/bulk-delete",
                              json={"product_ids": ids[:2]}, timeout=15)
            assert r.status_code == 200
            assert r.json().get("removed_categories") == []
            assert cat["slug"] in _category_slugs()
        finally:
            requests.delete(f"{API}/products/{ids[2]}", timeout=15)

    def test_bulk_delete_removes_multiple_emptied_categories(self):
        cat_a = _new_category()
        cat_b = _new_category()
        ids = [_new_product(cat_a["slug"])["id"], _new_product(cat_b["slug"])["id"]]
        r = requests.post(f"{API}/products/bulk-delete",
                          json={"product_ids": ids}, timeout=15)
        assert r.status_code == 200
        removed = set(r.json().get("removed_categories") or [])
        assert cat_a["slug"] in removed
        assert cat_b["slug"] in removed
        remaining = _category_slugs()
        assert cat_a["slug"] not in remaining
        assert cat_b["slug"] not in remaining
