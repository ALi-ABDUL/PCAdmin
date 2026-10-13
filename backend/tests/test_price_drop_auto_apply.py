"""Regression coverage for scraper-driven source-price synchronization.

These tests only exercise PCAdmin's database path. No eBay provider or PCStore
network call is made: PCStore reads the updated document via the documented
``GET /api/store/products`` contract.
"""
import asyncio
import sys
import uuid
from datetime import datetime, timezone

import pytest

sys.path.insert(0, "/app/backend")
import helpers  # noqa: E402
import server  # noqa: E402


def _run(coro):
    try:
        loop = asyncio.get_event_loop()
        if loop.is_closed():
            raise RuntimeError("closed")
    except Exception:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
    return loop.run_until_complete(coro)


class TestSourcePriceSynchronisation:
    @pytest.fixture(autouse=True)
    def _cleanup(self):
        created_ids = []
        yield created_ids
        _run(server.db.products.delete_many({"id": {"$in": created_ids}}))
        _run(server.db.notifications.delete_many({"product_id": {"$in": created_ids}}))

    async def _make_linked_product(self, ebay_item_id, *, cost, price, margin, reference):
        product_id = str(uuid.uuid4())
        await server.db.products.insert_one({
            "id": product_id,
            "title": "Test linked product",
            "price": price,
            "cost": cost,
            "pricing_margin": margin,
            "pricing_reference_sell_price": reference,
            "original_price": None,
            "stock": 5,
            "active": True,
            "archived": False,
            "source_item_id": ebay_item_id,
            "images": ["https://example.com/image.jpg"],
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        return product_id

    def test_source_increase_keeps_import_percentage_and_clears_was_price(self, _cleanup):
        """Acceptance case: $699 + 10% becomes $1,555.40 for a $1,414 source.

        The source increase is above the original source price, so PCStore must
        receive no discount/was price through its live product response.
        """
        ebay_id = f"projector-{uuid.uuid4().hex[:8]}"
        product_id = _run(self._make_linked_product(
            ebay_id, cost=699.0, price=768.90,
            margin={"kind": "percent", "value": 10.0}, reference=768.90,
        ))
        _cleanup.append(product_id)

        _run(helpers._emit_price_change_notifications(
            item={"item_id": ebay_id, "id": ebay_id, "url": "https://example.com/item", "images": []},
            new_image=None, new_title="Projector", old_price=699.0, new_price=1414.0,
            now_iso=datetime.now(timezone.utc).isoformat(),
        ))

        updated = _run(server.db.products.find_one({"id": product_id}, {"_id": 0}))
        assert updated["cost"] == 1414.0
        assert updated["price"] == 1555.40
        assert updated["pricing_margin"] == {"kind": "percent", "value": 10.0}
        assert updated["original_price"] is None
        storefront = server._shape_storefront_product(updated)
        assert storefront["price"] == 1555.40
        assert storefront["original_price"] is None
        assert storefront["discount_percent"] is None

    def test_source_drop_uses_original_sell_price_as_the_only_was_anchor(self, _cleanup):
        ebay_id = f"drop-{uuid.uuid4().hex[:8]}"
        product_id = _run(self._make_linked_product(
            ebay_id, cost=699.0, price=768.90,
            margin={"kind": "percent", "value": 10.0}, reference=768.90,
        ))
        _cleanup.append(product_id)

        _run(helpers._emit_price_change_notifications(
            item={"item_id": ebay_id, "id": ebay_id, "url": "https://example.com/item", "images": []},
            new_image=None, new_title="Projector", old_price=699.0, new_price=600.0,
            now_iso=datetime.now(timezone.utc).isoformat(),
        ))

        updated = _run(server.db.products.find_one({"id": product_id}, {"_id": 0}))
        assert updated["cost"] == 600.0
        assert updated["price"] == 660.0
        assert updated["original_price"] == 768.90
        storefront = server._shape_storefront_product(updated)
        assert storefront["original_price"] == 768.90
        assert storefront["discount_percent"] == 14

    def test_legacy_product_gets_one_time_fixed_margin_snapshot(self, _cleanup):
        ebay_id = f"legacy-{uuid.uuid4().hex[:8]}"
        product_id = str(uuid.uuid4())
        _cleanup.append(product_id)
        _run(server.db.products.insert_one({
            "id": product_id, "title": "Legacy item", "price": 120.0, "cost": 100.0,
            "stock": 5, "active": True, "archived": False, "source_item_id": ebay_id,
            "images": [], "created_at": datetime.now(timezone.utc).isoformat(),
        }))

        _run(helpers._emit_price_change_notifications(
            item={"item_id": ebay_id, "id": ebay_id, "url": "https://example.com/item", "images": []},
            new_image=None, new_title="Legacy item", old_price=100.0, new_price=150.0,
            now_iso=datetime.now(timezone.utc).isoformat(),
        ))

        updated = _run(server.db.products.find_one({"id": product_id}, {"_id": 0}))
        assert updated["pricing_margin"] == {"kind": "fixed", "value": 20.0}
        assert updated["pricing_reference_sell_price"] == 120.0
        assert updated["price"] == 170.0
        assert updated["original_price"] is None