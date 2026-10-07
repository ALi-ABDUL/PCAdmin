"""Backend tests for scraper Run History Log + Retry-on-Failure logic.

We import `server` in-process and monkey-patch `_refresh_all_items` to avoid
scraping eBay, then drive `_refresh_all_and_record` and `_scheduler_loop`
building blocks directly.
"""
import asyncio
import os
import sys
import uuid
from datetime import datetime, timezone, timedelta

import pytest

sys.path.insert(0, "/app/backend")
import server  # noqa: E402
import helpers  # noqa: E402


def _run(coro):
    """Reuse the module-level event loop bound to the Motor client."""
    try:
        loop = asyncio.get_event_loop()
        if loop.is_closed():
            raise RuntimeError("closed")
    except Exception:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
    return loop.run_until_complete(coro)


@pytest.fixture(autouse=True)
def clean_schedule():
    """Reset the schedule mock doc before/after each test."""
    async def _reset():
        await server.db.scraper_schedule.update_one(
            {"id": "singleton"},
            {"$set": {**server.SCRAPER_SCHEDULE_DEFAULTS}},
            upsert=True,
        )
    _run(_reset())
    yield
    _run(_reset())


class TestSchedulerHistoryAndRetry:
    """All tests consolidated into a single class so pytest-xdist's `loadscope`
    pins them to one worker (they share the singleton scraper_schedule doc)."""

    def test_manual_success_appends_history(self, monkeypatch):
        async def _fake(**kw):
            return {"refreshed": 5, "sold_found": 1, "failed": 0, "total": 5}
        monkeypatch.setattr(helpers, "_refresh_all_items", _fake)

        summary = _run(server._refresh_all_and_record(trigger="manual", attempt=1))
        assert summary["refreshed"] == 5

        sched = _run(server._get_scraper_schedule())
        hist = sched["run_history"]
        assert len(hist) == 1
        e = hist[0]
        assert e["status"] == "success"
        assert e["trigger"] == "manual"
        assert e["attempt"] == 1
        assert e["duration_seconds"] >= 0
        assert e["stats"]["refreshed"] == 5
        assert e["error"] is None
        assert sched["retry_pending"] is None  # manual doesn't queue retry

    def test_history_capped_at_20(self, monkeypatch):
        async def _fake(**kw):
            return {"refreshed": 1, "sold_found": 0, "failed": 0, "total": 1}
        monkeypatch.setattr(helpers, "_refresh_all_items", _fake)
        for _ in range(25):
            _run(server._refresh_all_and_record(trigger="manual", attempt=1))
        sched = _run(server._get_scraper_schedule())
        assert len(sched["run_history"]) == server.RUN_HISTORY_LIMIT == 20

    def test_newest_first(self, monkeypatch):
        async def _fake(**kw):
            return {"refreshed": 1, "sold_found": 0, "failed": 0, "total": 1}
        monkeypatch.setattr(helpers, "_refresh_all_items", _fake)
        _run(server._refresh_all_and_record(trigger="manual", attempt=1))
        _run(server._refresh_all_and_record(trigger="manual", attempt=1))
        sched = _run(server._get_scraper_schedule())
        h = sched["run_history"]
        assert len(h) == 2
        assert h[0]["started_at"] >= h[1]["started_at"]

    def test_scheduled_failure_without_item_results_does_not_queue_retry(self, monkeypatch):
        async def _fail(**kw):
            return {"refreshed": 0, "sold_found": 0, "failed": 3, "total": 3}
        monkeypatch.setattr(helpers, "_refresh_all_items", _fail)

        _run(server._refresh_all_and_record(trigger="scheduled", attempt=1))
        sched = _run(server._get_scraper_schedule())
        assert sched["retry_pending"] is None
        assert sched["failed_retry_pending"] is None
        h = sched["run_history"]
        assert len(h) == 1 and h[0]["status"] == "failed" and h[0]["attempt"] == 1

    def test_exception_without_item_results_does_not_queue_retry(self, monkeypatch):
        async def _boom(**kw):
            raise RuntimeError("boom-network")
        monkeypatch.setattr(helpers, "_refresh_all_items", _boom)

        _run(server._refresh_all_and_record(trigger="scheduled", attempt=1))
        sched = _run(server._get_scraper_schedule())
        assert sched["retry_pending"] is None
        assert sched["failed_retry_pending"] is None
        h = sched["run_history"]
        assert h[0]["status"] == "failed"
        assert "boom-network" in (h[0]["error"] or "")

    def test_scheduled_failure_without_product_ids_has_no_generic_retry(self, monkeypatch):
        async def _fail(**kw):
            return {"refreshed": 0, "sold_found": 0, "failed": 2, "total": 2}
        monkeypatch.setattr(helpers, "_refresh_all_items", _fail)
        _run(server._refresh_all_and_record(trigger="scheduled", attempt=1))
        sched = _run(server._get_scraper_schedule())
        assert sched["retry_pending"] is None
        assert sched["failed_retry_pending"] is None
        assert len(sched["run_history"]) == 1

    def test_no_retry_is_queued_without_eligible_product_ids(self, monkeypatch):
        async def _fail(**kw):
            return {"refreshed": 0, "sold_found": 0, "failed": 4, "total": 4}
        monkeypatch.setattr(helpers, "_refresh_all_items", _fail)
        _run(server._refresh_all_and_record(trigger="scheduled", attempt=1))
        sched = _run(server._get_scraper_schedule())
        assert sched["retry_pending"] is None
        assert sched["failed_retry_pending"] is None

    def test_manual_failure_does_not_queue_retry(self, monkeypatch):
        async def _fail(**kw):
            return {"refreshed": 0, "sold_found": 0, "failed": 1, "total": 1}
        monkeypatch.setattr(helpers, "_refresh_all_items", _fail)
        _run(server._refresh_all_and_record(trigger="manual", attempt=1))
        sched = _run(server._get_scraper_schedule())
        assert sched["retry_pending"] is None
        assert sched["run_history"][0]["status"] == "failed"

    def test_clear_history_wipes_entries(self, monkeypatch):
        async def _fake(**kw):
            return {"refreshed": 1, "sold_found": 0, "failed": 0, "total": 1}
        monkeypatch.setattr(helpers, "_refresh_all_items", _fake)
        _run(server._refresh_all_and_record(trigger="manual", attempt=1))

        _run(server.clear_scraper_history())

        sched = _run(server._get_scraper_schedule())
        assert sched["run_history"] == []
        assert sched["retry_pending"] is None

    def test_item_retry_only_scrapes_active_live_linked_products(self, monkeypatch):
        prefix = f"retry-live-{uuid.uuid4().hex[:8]}"
        item_ids = [f"{prefix}-{kind}" for kind in ("active", "inactive", "sold", "out", "archived", "missing")]

        async def seed():
            for item_id in item_ids:
                await server.db.items.insert_one({"id": item_id, "item_id": item_id, "title": item_id, "url": f"https://example.com/{item_id}", "images": []})
            for kind, fields in {
                "active": {"active": True, "stock_status": "live", "stock": 4, "archived": False},
                "inactive": {"active": False, "stock_status": "live", "stock": 4, "archived": False},
                "sold": {"active": True, "stock_status": "sold", "stock": 4, "archived": False},
                "out": {"active": True, "stock_status": "live", "stock": 0, "archived": False},
                "archived": {"active": True, "stock_status": "live", "stock": 4, "archived": True},
            }.items():
                await server.db.products.insert_one({"id": f"product-{prefix}-{kind}", "source_item_id": f"{prefix}-{kind}", **fields})

        async def cleanup():
            await server.db.items.delete_many({"id": {"$in": item_ids}})
            await server.db.products.delete_many({"id": {"$regex": f"^product-{prefix}"}})

        _run(seed())
        calls = []
        async def fake_scrape(item, **_kwargs):
            calls.append(item["id"])
            return {"id": item["id"], "ok": True, "sold": False}
        monkeypatch.setattr(helpers, "_scrape_one_item", fake_scrape)
        try:
            result = _run(helpers._retry_scrape_items(item_ids))
            assert calls == [f"{prefix}-active"]
            assert result["retried"] == 1
            assert set(result["skipped_ids"]) == set(item_ids) - {f"{prefix}-active"}
        finally:
            _run(cleanup())

    def test_scheduled_auto_retry_queues_only_live_product_items(self, monkeypatch):
        prefix = f"retry-queue-{uuid.uuid4().hex[:8]}"
        active_id, sold_id = f"{prefix}-active", f"{prefix}-sold"

        async def seed():
            for item_id in (active_id, sold_id):
                await server.db.items.insert_one({"id": item_id, "item_id": item_id, "title": item_id, "url": f"https://example.com/{item_id}", "images": []})
            await server.db.products.insert_one({"id": f"product-{active_id}", "source_item_id": active_id, "active": True, "stock_status": "live", "stock": 2, "archived": False})
            await server.db.products.insert_one({"id": f"product-{sold_id}", "source_item_id": sold_id, "active": True, "stock_status": "sold", "stock": 2, "archived": False})

        async def cleanup():
            await server.db.items.delete_many({"id": {"$in": [active_id, sold_id]}})
            await server.db.products.delete_many({"id": {"$in": [f"product-{active_id}", f"product-{sold_id}"]}})

        _run(seed())
        async def failed_run(**_kwargs):
            return {"refreshed": 0, "sold_found": 0, "failed": 2, "total": 2, "results": [{"id": active_id, "ok": False}, {"id": sold_id, "ok": False}]}
        monkeypatch.setattr(helpers, "_refresh_all_items", failed_run)
        try:
            _run(helpers._refresh_all_and_record(trigger="scheduled", attempt=1))
            schedule = _run(helpers._get_scraper_schedule())
            assert schedule["failed_retry_pending"]["item_ids"] == [active_id]
        finally:
            _run(cleanup())

    def test_item_retry_does_not_requeue_inactive_skipped_ids(self, monkeypatch):
        prefix = f"retry-pending-{uuid.uuid4().hex[:8]}"
        active_id, inactive_id = f"{prefix}-active", f"{prefix}-inactive"

        async def seed():
            for item_id in (active_id, inactive_id):
                await server.db.items.insert_one({"id": item_id, "item_id": item_id, "title": item_id, "url": f"https://example.com/{item_id}", "images": []})
            await server.db.products.insert_one({"id": f"product-{active_id}", "source_item_id": active_id, "active": True, "stock_status": "live", "stock": 1, "archived": False})
            await server.db.products.insert_one({"id": f"product-{inactive_id}", "source_item_id": inactive_id, "active": False, "stock_status": "live", "stock": 1, "archived": False})

        async def cleanup():
            await server.db.items.delete_many({"id": {"$in": [active_id, inactive_id]}})
            await server.db.products.delete_many({"id": {"$in": [f"product-{active_id}", f"product-{inactive_id}"]}})

        async def fake_scrape(item, **_kwargs):
            return {"id": item["id"], "ok": False, "sold": False, "error": "still failing"}

        _run(seed())
        monkeypatch.setattr(helpers, "_scrape_one_item", fake_scrape)
        try:
            _run(server.db.scraper_schedule.update_one(
                {"id": "singleton"},
                {"$set": {**server.SCRAPER_SCHEDULE_DEFAULTS, "failed_retry_pending": {"retry_at": datetime.now(timezone.utc).isoformat(), "item_ids": [active_id, inactive_id], "attempt": 1}}},
                upsert=True,
            ))
            _run(helpers._run_failed_item_retry({"item_ids": [active_id, inactive_id], "attempt": 1}))
            schedule = _run(helpers._get_scraper_schedule())
            queued = (schedule.get("failed_retry_pending") or {}).get("item_ids") or []
            assert inactive_id not in queued
            assert queued == [active_id]
            assert schedule["run_history"][0]["trigger"] == "item_retry"
            assert schedule["run_history"][0]["stats"]["skipped_inactive"] == 1
        finally:
            _run(cleanup())
