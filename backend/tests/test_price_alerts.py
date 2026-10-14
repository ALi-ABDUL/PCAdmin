"""Regression tests for the Price Alerts item feed.

The suite inserts local test records only. It never invokes an eBay scraper or
any PCStore/email integration.
"""
import asyncio
import sys
import uuid
from datetime import datetime, timedelta, timezone

sys.path.insert(0, "/app/backend")
import server  # noqa: E402


def _run(coro):
    try:
        loop = asyncio.get_event_loop()
        if loop.is_closed():
            raise RuntimeError("closed loop")
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
    return loop.run_until_complete(coro)


def _history(*prices):
    start = datetime.now(timezone.utc) - timedelta(days=10)
    return [
        {"value": value, "at": (start + timedelta(hours=index)).isoformat()}
        for index, value in enumerate(prices)
    ]


class TestPriceAlerts:
    def test_returns_every_sellable_item_with_any_price_change(self):
        prefix = f"price-alert-{uuid.uuid4().hex[:10]}"
        ids = []

        def row(name, history, **extra):
            item_id = f"{prefix}-{name}"
            ids.append(item_id)
            return {
                "id": item_id,
                "item_id": item_id,
                "url": "https://example.invalid/item",
                "title": name,
                "price_history": history,
                "is_sold": False,
                "stock_status": "live",
                "created_at": datetime.now(timezone.utc).isoformat(),
                **extra,
            }

        docs = [
            row("active-change", _history(100, 120)),
            # A change is still a valid alert when the latest price returns to
            # the initial price; the old first-vs-last filter lost this item.
            row("returned-to-start", _history(100, 120, 100)),
            row("sold", _history(100, 120), is_sold=True, stock_status="sold"),
            row("ended", _history(100, 120), stock_status="ended"),
            row("out-of-stock", _history(100, 120), stock_status="out_of_stock"),
            row("unchanged", _history(100, 100)),
        ]
        _run(server.db.items.insert_many(docs))
        try:
            result = _run(server.list_items(status="price_changed", limit=50, skip=0))
            returned = {item["item_id"] for item in result["items"] if item["item_id"].startswith(prefix)}
            assert returned == {f"{prefix}-active-change", f"{prefix}-returned-to-start"}
            assert result["total"] >= len(returned)
        finally:
            _run(server.db.items.delete_many({"item_id": {"$in": ids}}))