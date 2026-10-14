"""Price Alerts endpoint regression tests.

Validates /api/items?status=price_changed behavior using local DB fixtures only.
No scraper, email, or PCStore integrations are invoked.
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
    start = datetime.now(timezone.utc) - timedelta(days=12)
    return [
        {"value": value, "at": (start + timedelta(hours=i)).isoformat()}
        for i, value in enumerate(prices)
    ]


def _mk_item(prefix: str, name: str, history, **extra):
    item_id = f"{prefix}-{name}"
    return {
        "id": item_id,
        "item_id": item_id,
        "url": "https://example.invalid/item",
        "title": f"{prefix} {name}",
        "price_history": history,
        "price_value": history[-1]["value"] if history else None,
        "is_sold": False,
        "stock_status": "live",
        "created_at": datetime.now(timezone.utc).isoformat(),
        **extra,
    }


class TestPriceAlertsEndpoint:
    # Module: items API (price_alerts filter contract)
    def test_status_price_changed_includes_changed_and_returned_items(self):
        prefix = f"api-price-alert-{uuid.uuid4().hex[:10]}"
        docs = [
            _mk_item(prefix, "active-change", _history(100, 125)),
            _mk_item(prefix, "returned-to-start", _history(100, 125, 100)),
            _mk_item(prefix, "unchanged", _history(100, 100)),
        ]
        ids = [d["item_id"] for d in docs]
        _run(server.db.items.insert_many(docs))
        try:
            payload = _run(server.list_items(status="price_changed", q=prefix, limit=200, skip=0))
            assert "items" in payload and "total" in payload
            returned = {
                item.get("item_id")
                for item in payload["items"]
                if (item.get("item_id") or "").startswith(prefix)
            }
            assert f"{prefix}-active-change" in returned
            assert f"{prefix}-returned-to-start" in returned
            assert f"{prefix}-unchanged" not in returned
        finally:
            _run(server.db.items.delete_many({"item_id": {"$in": ids}}))

    # Module: items API (sellable-only exclusions)
    def test_status_price_changed_excludes_sold_ended_out_of_stock(self):
        prefix = f"api-price-alert-excl-{uuid.uuid4().hex[:10]}"
        docs = [
            _mk_item(prefix, "kept", _history(90, 99)),
            _mk_item(prefix, "sold", _history(90, 99), is_sold=True, stock_status="sold"),
            _mk_item(prefix, "ended", _history(90, 99), stock_status="ended"),
            _mk_item(prefix, "out", _history(90, 99), stock_status="out_of_stock"),
        ]
        ids = [d["item_id"] for d in docs]
        _run(server.db.items.insert_many(docs))
        try:
            payload = _run(server.list_items(status="price_changed", q=prefix, limit=200, skip=0))
            returned = {
                item.get("item_id")
                for item in payload["items"]
                if (item.get("item_id") or "").startswith(prefix)
            }
            assert returned == {f"{prefix}-kept"}
        finally:
            _run(server.db.items.delete_many({"item_id": {"$in": ids}}))
