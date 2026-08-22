"""Regression tests for the auto-created-from-eBay category flow.

When an eBay item is scraped/imported, its category is picked from the
listing's breadcrumb path. If the category (by slug) doesn't already exist in
db.categories, it is created on the fly so no manual admin action is required.
"""
import asyncio
import os
import re
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE))

# Import async helpers directly (in-process — avoids network + eBay anti-bot).
from helpers import _ensure_ebay_category, _slug  # noqa: E402
from deps import db  # noqa: E402


def _run(coro):
    """Run an async coroutine on a fresh event loop for test isolation."""
    return asyncio.get_event_loop().run_until_complete(coro) if not asyncio.get_event_loop().is_closed() else asyncio.new_event_loop().run_until_complete(coro)


@pytest.fixture(autouse=True)
def cleanup_test_cats():
    """Wipe test-only categories before + after each test."""
    async def _wipe():
        await db.categories.delete_many({"slug": {"$regex": "^auto-test-"}})
    _run(_wipe())
    yield
    _run(_wipe())


class TestEnsureEbayCategory:
    def test_returns_none_for_empty_breadcrumbs(self):
        async def go():
            return await _ensure_ebay_category([])
        assert _run(go()) is None

    def test_returns_none_for_none(self):
        async def go():
            return await _ensure_ebay_category(None)
        assert _run(go()) is None

    def test_returns_none_when_only_ebay_prefix(self):
        async def go():
            return await _ensure_ebay_category(["eBay"])
        assert _run(go()) is None

    def test_creates_new_category_from_leaf(self):
        crumbs = ["eBay", "Home, Furniture & DIY", "Auto Test Kitchen Appliances Unique"]
        async def go():
            slug = await _ensure_ebay_category(crumbs)
            doc = await db.categories.find_one({"slug": slug}, {"_id": 0})
            return slug, doc
        slug, doc = _run(go())
        assert slug == _slug("Auto Test Kitchen Appliances Unique")
        assert doc is not None
        assert doc["name"] == "Auto Test Kitchen Appliances Unique"
        # Group should be the top of the breadcrumb path (after stripping "eBay")
        assert doc["group"] == "Home, Furniture & DIY"
        # Description should include the full trail so admins can inspect origin
        assert "Auto Test Kitchen Appliances Unique" in doc["description"]
        assert "Home, Furniture & DIY" in doc["description"]

    def test_reuses_existing_category_by_slug(self):
        crumbs = ["eBay", "Electronics", "Auto Test Widgets Alpha"]
        async def go():
            slug1 = await _ensure_ebay_category(crumbs)
            count1 = await db.categories.count_documents({"slug": slug1})
            slug2 = await _ensure_ebay_category(crumbs)     # second call
            count2 = await db.categories.count_documents({"slug": slug1})
            return slug1, slug2, count1, count2
        s1, s2, c1, c2 = _run(go())
        assert s1 == s2
        assert c1 == 1
        assert c2 == 1, "Second call must NOT create a duplicate category record."

    def test_case_insensitive_match_by_name(self):
        """If a category with the same NAME (any case) already exists, reuse it
        rather than creating a duplicate with a slightly different slug."""
        async def go():
            # Pre-insert a category with a specific slug + name.
            from models import Category
            existing = Category(
                name="Auto Test Cameras Beta",
                slug="auto-test-cameras-beta",
                group="Electronics",
            )
            await db.categories.insert_one(existing.model_dump())
            # Now scrape with a differently-cased breadcrumb.
            slug = await _ensure_ebay_category(["eBay", "Electronics", "AUTO test CAMERAS beta"])
            count = await db.categories.count_documents({
                "name": {"$regex": r"^auto test cameras beta$", "$options": "i"}
            })
            return slug, count
        slug, count = _run(go())
        assert slug == "auto-test-cameras-beta"
        assert count == 1, "Must not duplicate a category that matches by name (case-insensitive)."

    def test_group_falls_back_to_imported_for_single_crumb(self):
        crumbs = ["Auto Test Single Level Category Zed"]
        async def go():
            slug = await _ensure_ebay_category(crumbs)
            doc = await db.categories.find_one({"slug": slug}, {"_id": 0})
            return slug, doc
        slug, doc = _run(go())
        assert slug == _slug("Auto Test Single Level Category Zed")
        assert doc["group"] == "Imported"
