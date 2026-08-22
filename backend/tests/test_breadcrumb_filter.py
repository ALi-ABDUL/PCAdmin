"""Regression tests for breadcrumb cleaning + meaningful-leaf selection.

Rules under test:
  * "See more", "See all", "View all", "…", store prefixes ("eBay", "Home")
    are stripped from the breadcrumb trail.
  * The LAST meaningful level of the trail is used as the category name.
  * When the leaf is too specific/redundant (over-long, parenthesised
    qualifier, chained "&/", exact duplicate of parent), fall back to the
    second-to-last level.
"""
import asyncio
import sys
import uuid
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE))

from helpers import (  # noqa: E402
    _clean_breadcrumb_trail,
    _pick_meaningful_leaf,
    _ensure_ebay_category,
    _slug,
)
from deps import db  # noqa: E402


def _run(coro):
    """Run an async coroutine on a shared event loop, creating one only if
    none exists. Matches the pattern used by the sibling category tests so
    the motor client (bound to the initial loop) stays healthy.
    """
    try:
        loop = asyncio.get_event_loop()
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
    if loop.is_closed():
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
    return loop.run_until_complete(coro)


_RUN_ID = uuid.uuid4().hex[:8]


@pytest.fixture(autouse=True)
def cleanup():
    async def _wipe():
        await db.categories.delete_many({"slug": {"$regex": f"^bc-{_RUN_ID}-"}})
    yield
    _run(_wipe())


# --------------------------------------------------------------------------
# _clean_breadcrumb_trail
# --------------------------------------------------------------------------

class TestCleanBreadcrumbTrail:
    def test_strips_ebay_prefix(self):
        assert _clean_breadcrumb_trail(["eBay", "Cameras", "Digital Cameras"]) == ["Cameras", "Digital Cameras"]

    def test_strips_ebay_multi_word_prefix(self):
        # "eBay Motors", "eBay Stores", etc. are site-header prefixes, not categories.
        assert _clean_breadcrumb_trail(["eBay Motors", "Vehicle Parts", "Car Audio"]) == ["Vehicle Parts", "Car Audio"]
        assert _clean_breadcrumb_trail(["eBay Stores", "Home", "Furniture"]) == ["Furniture"]

    def test_strips_see_more(self):
        assert _clean_breadcrumb_trail([
            "eBay", "Motors", "Vehicle Parts", "See more", "Car Audio",
        ]) == ["Motors", "Vehicle Parts", "Car Audio"]

    def test_strips_see_all_view_all_show_more(self):
        assert _clean_breadcrumb_trail([
            "eBay", "See all", "Home & Garden", "View all Furniture", "Show more", "Sofas",
        ]) == ["Home & Garden", "Sofas"]

    def test_strips_ellipsis_and_home(self):
        assert _clean_breadcrumb_trail(["Home", "…", "Sports", "...", "Tennis"]) == ["Sports", "Tennis"]

    def test_collapses_consecutive_duplicates(self):
        assert _clean_breadcrumb_trail(["Car Audio", "Car Audio", "In-Dash Units"]) == [
            "Car Audio", "In-Dash Units"
        ]

    def test_case_insensitive_duplicate_collapse(self):
        assert _clean_breadcrumb_trail(["Cameras", "CAMERAS", "Digital"]) == ["Cameras", "Digital"]

    def test_ignores_empty_and_whitespace(self):
        assert _clean_breadcrumb_trail(["", None, "   ", "Toys", "\t\n", "Puzzles"]) == ["Toys", "Puzzles"]

    def test_strips_trailing_arrows_and_punctuation(self):
        assert _clean_breadcrumb_trail(["Books ›", "Fiction:", "Thrillers >"]) == ["Books", "Fiction", "Thrillers"]


# --------------------------------------------------------------------------
# _pick_meaningful_leaf
# --------------------------------------------------------------------------

class TestPickMeaningfulLeaf:
    def test_returns_none_for_empty(self):
        assert _pick_meaningful_leaf([]) is None

    def test_returns_only_element(self):
        assert _pick_meaningful_leaf(["Toys"]) == "Toys"

    def test_returns_leaf_by_default(self):
        crumbs = ["Motors", "Vehicle Parts & Accessories", "Vehicle Electronics & GPS", "Car Audio", "Car Audio In-Dash Units"]
        assert _pick_meaningful_leaf(crumbs) == "Car Audio In-Dash Units"

    def test_falls_back_when_leaf_too_long(self):
        parent = "Kitchen Appliances"
        leaf = ("Cordless Handheld Vacuum Cleaner Bagless Rechargeable Stick Vac "
                "Lightweight Home Car Portable")
        assert len(leaf) > 60
        assert _pick_meaningful_leaf(["Home", parent, leaf]) == parent

    def test_falls_back_when_leaf_has_parenthesised_qualifier(self):
        assert _pick_meaningful_leaf(["Toys", "Board Games", "Chess (2-Pack)"]) == "Board Games"

    def test_falls_back_when_leaf_is_chained_slash_and(self):
        # "Radios & Tuners & Amps" - chained descriptors typically = filter, not category
        assert _pick_meaningful_leaf(["Car Audio", "Radios & Tuners & Amps"]) == "Car Audio"
        assert _pick_meaningful_leaf(["Cameras", "Point & Shoot/Bridge/Compact"]) == "Cameras"

    def test_falls_back_when_leaf_equals_parent_case_insensitive(self):
        assert _pick_meaningful_leaf(["Books", "Fiction", "FICTION"]) == "Fiction"

    def test_falls_back_when_leaf_is_sku_style(self):
        assert _pick_meaningful_leaf(["Batteries", "12x AA Alkaline"]) == "Batteries"

    def test_keeps_leaf_with_single_ampersand(self):
        # single "&" is legit ("Home & Garden"); only chained matters
        assert _pick_meaningful_leaf(["Home", "Home & Garden"]) == "Home & Garden"

    def test_leaf_with_no_parent_returns_leaf_even_if_specific(self):
        # only one crumb, no parent to fall back to
        long = "x" * 80
        assert _pick_meaningful_leaf([long]) == long


# --------------------------------------------------------------------------
# Full end-to-end via _ensure_ebay_category
# --------------------------------------------------------------------------

class TestEnsureEbayCategoryUsesFilter:
    def test_car_audio_example_from_user(self):
        """Direct user example: '.../Car Audio › Car Audio In-Dash Units'
        must pick 'Car Audio In-Dash Units' as the category."""
        crumbs = ["eBay Motors", "Vehicle Parts & Accessories",
                  "Vehicle Electronics & GPS", "Car Audio",
                  # Uniquify so parallel tests don't collide
                  f"BC {_RUN_ID} Car Audio In-Dash Units"]
        async def go():
            slug = await _ensure_ebay_category(crumbs)
            doc = await db.categories.find_one({"slug": slug})
            return slug, doc
        # Note: this test's cleanup uses `bc-{_RUN_ID}-` prefix
        # but the created slug won't match — we clean up manually.
        try:
            slug, doc = _run(go())
            assert slug == _slug(f"BC {_RUN_ID} Car Audio In-Dash Units")
            assert doc["name"] == f"BC {_RUN_ID} Car Audio In-Dash Units"
        finally:
            async def cleanup():
                await db.categories.delete_many({"name": {"$regex": f"^BC {_RUN_ID} "}})
            _run(cleanup())

    def test_see_more_row_is_ignored(self):
        crumbs = ["eBay", "Electronics", "See more", f"BC {_RUN_ID} Widgets Alpha"]
        try:
            async def go():
                slug = await _ensure_ebay_category(crumbs)
                doc = await db.categories.find_one({"slug": slug})
                return slug, doc
            slug, doc = _run(go())
            assert doc["name"] == f"BC {_RUN_ID} Widgets Alpha"
            # description should NOT contain "See more"
            assert "See more" not in doc["description"]
            # group should be "Electronics" (the top after cleaning)
            assert doc["group"] == "Electronics"
        finally:
            async def cleanup():
                await db.categories.delete_many({"name": {"$regex": f"^BC {_RUN_ID} "}})
            _run(cleanup())

    def test_falls_back_when_leaf_is_over_specific(self):
        parent = f"BC {_RUN_ID} Parent Category"
        leaf = "x" * 80  # too long → fall back to parent
        crumbs = ["eBay", parent, leaf]
        try:
            async def go():
                slug = await _ensure_ebay_category(crumbs)
                doc = await db.categories.find_one({"slug": slug})
                return slug, doc
            slug, doc = _run(go())
            assert slug == _slug(parent)
            assert doc["name"] == parent
        finally:
            async def cleanup():
                await db.categories.delete_many({"name": {"$regex": f"^BC {_RUN_ID} "}})
            _run(cleanup())
