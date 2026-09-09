"""Tests for price-drop auto-apply into linked products.

When the eBay scraper detects a price change on an item that has one or
more linked products AND the rule-derived sell price DROPS:

  * every linked product's current `price` is stashed into
    `original_price` (or the existing higher value is kept),
  * every linked product's `price` is set to the new sell price.

Price INCREASES must never touch `original_price`.
"""
import asyncio
import os
import sys
import uuid
from datetime import datetime, timezone

import pytest

sys.path.insert(0, "/app/backend")
import server  # noqa: E402
import helpers  # noqa: E402


def _run(coro):
    try:
        loop = asyncio.get_event_loop()
        if loop.is_closed():
            raise RuntimeError("closed")
    except Exception:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
    return loop.run_until_complete(coro)


class TestPriceDropAutoApply:
    """Serialised on one worker via loadscope + single class."""

    @pytest.fixture(autouse=True)
    def _cleanup(self):
        created_ids: list = []
        yield created_ids
        # Remove any test products created by the test.
        _run(server.db.products.delete_many({"id": {"$in": created_ids}}))

    async def _make_linked_product(self, ebay_item_id: str, sell_price: float, original_price=None) -> str:
        pid = str(uuid.uuid4())
        doc = {
            "id": pid,
            "title": "Test product for price-drop auto-apply",
            "price": sell_price,
            "original_price": original_price,
            "cost": 10.0,
            "stock": 5,
            "active": True,
            "archived": False,
            "source_item_id": ebay_item_id,
            "images": ["https://example.com/img.jpg"],
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        await server.db.products.insert_one(doc)
        return pid

    def test_price_drop_moves_current_into_original(self, _cleanup):
        ebay_id = f"test-item-{uuid.uuid4().hex[:8]}"
        pid = _run(self._make_linked_product(ebay_id, sell_price=150.0, original_price=None))
        _cleanup.append(pid)

        # Simulate scraper detecting a drop from old_price=100 → new_price=50.
        # The pricing rules will derive smaller/bigger sells but the KEY is
        # that new_sell < old_sell → auto-apply fires.
        _run(helpers._emit_price_change_notifications(
            item={"item_id": ebay_id, "id": ebay_id, "url": "https://x", "images": []},
            new_image=None,
            new_title="Test",
            old_price=100.0,
            new_price=50.0,
            now_iso=datetime.now(timezone.utc).isoformat(),
        ))

        updated = _run(server.db.products.find_one({"id": pid}, {"_id": 0}))
        # `original_price` must have been set to the previous sell price (150)
        assert updated["original_price"] == 150.0, f"expected 150.0, got {updated['original_price']}"
        # `price` must be lower than 150 (the auto-apply happened).
        assert updated["price"] < 150.0, f"expected drop from 150, got {updated['price']}"

    def test_price_drop_preserves_existing_higher_original(self, _cleanup):
        ebay_id = f"test-item-{uuid.uuid4().hex[:8]}"
        # Admin already set original_price=999 manually — a subsequent drop
        # should keep the higher anchor, not shrink the strikethrough.
        pid = _run(self._make_linked_product(ebay_id, sell_price=150.0, original_price=999.0))
        _cleanup.append(pid)

        _run(helpers._emit_price_change_notifications(
            item={"item_id": ebay_id, "id": ebay_id, "url": "https://x", "images": []},
            new_image=None, new_title="Test",
            old_price=100.0, new_price=50.0,
            now_iso=datetime.now(timezone.utc).isoformat(),
        ))

        updated = _run(server.db.products.find_one({"id": pid}, {"_id": 0}))
        assert updated["original_price"] == 999.0, "should have kept the higher anchor"
        assert updated["price"] < 150.0

    def test_price_increase_leaves_original_untouched(self, _cleanup):
        ebay_id = f"test-item-{uuid.uuid4().hex[:8]}"
        pid = _run(self._make_linked_product(ebay_id, sell_price=150.0, original_price=None))
        _cleanup.append(pid)

        # eBay price INCREASE: old=50 → new=100. Sell derived from rules
        # increases too. Auto-apply must NOT fire.
        _run(helpers._emit_price_change_notifications(
            item={"item_id": ebay_id, "id": ebay_id, "url": "https://x", "images": []},
            new_image=None, new_title="Test",
            old_price=50.0, new_price=100.0,
            now_iso=datetime.now(timezone.utc).isoformat(),
        ))

        updated = _run(server.db.products.find_one({"id": pid}, {"_id": 0}))
        # Unchanged.
        assert updated["price"] == 150.0
        assert updated.get("original_price") is None

    def test_no_change_when_current_sell_already_below_new_sell(self, _cleanup):
        """Admin manually lowered price to $30. Scraper detects an eBay drop
        that would derive a new sell of e.g. $60. Auto-apply must NOT raise
        the price back up."""
        ebay_id = f"test-item-{uuid.uuid4().hex[:8]}"
        pid = _run(self._make_linked_product(ebay_id, sell_price=30.0, original_price=None))
        _cleanup.append(pid)

        _run(helpers._emit_price_change_notifications(
            item={"item_id": ebay_id, "id": ebay_id, "url": "https://x", "images": []},
            new_image=None, new_title="Test",
            old_price=100.0, new_price=50.0,
            now_iso=datetime.now(timezone.utc).isoformat(),
        ))

        updated = _run(server.db.products.find_one({"id": pid}, {"_id": 0}))
        assert updated["price"] == 30.0, "manual lower price should have been respected"
        assert updated.get("original_price") is None

    def test_price_drop_notification_still_emitted(self, _cleanup):
        """Adding the auto-apply must not swallow the existing notification."""
        ebay_id = f"test-item-{uuid.uuid4().hex[:8]}"
        pid = _run(self._make_linked_product(ebay_id, sell_price=150.0))
        _cleanup.append(pid)
        # Wipe any pre-existing notifications for this product.
        _run(server.db.notifications.delete_many({"product_id": pid}))

        _run(helpers._emit_price_change_notifications(
            item={"item_id": ebay_id, "id": ebay_id, "url": "https://x", "images": []},
            new_image=None, new_title="Test",
            old_price=100.0, new_price=50.0,
            now_iso=datetime.now(timezone.utc).isoformat(),
        ))

        notes = _run(server.db.notifications.find({"product_id": pid}).to_list(10))
        assert len(notes) >= 1, "expected a price_change notification for the linked product"

    def test_multiple_linked_products_all_get_updated(self, _cleanup):
        ebay_id = f"test-item-{uuid.uuid4().hex[:8]}"
        pid1 = _run(self._make_linked_product(ebay_id, sell_price=150.0))
        pid2 = _run(self._make_linked_product(ebay_id, sell_price=180.0))
        _cleanup.extend([pid1, pid2])

        _run(helpers._emit_price_change_notifications(
            item={"item_id": ebay_id, "id": ebay_id, "url": "https://x", "images": []},
            new_image=None, new_title="Test",
            old_price=100.0, new_price=50.0,
            now_iso=datetime.now(timezone.utc).isoformat(),
        ))

        p1 = _run(server.db.products.find_one({"id": pid1}, {"_id": 0}))
        p2 = _run(server.db.products.find_one({"id": pid2}, {"_id": 0}))
        assert p1["original_price"] == 150.0
        assert p2["original_price"] == 180.0
        assert p1["price"] < 150.0
        assert p2["price"] < 180.0
