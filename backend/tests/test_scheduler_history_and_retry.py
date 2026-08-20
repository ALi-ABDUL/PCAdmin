"""Backend tests for scraper Run History Log + Retry-on-Failure logic.

We import `server` in-process and monkey-patch `_refresh_all_items` to avoid
scraping eBay, then drive `_refresh_all_and_record` and `_scheduler_loop`
building blocks directly.
"""
import asyncio
import os
import sys
from datetime import datetime, timezone, timedelta

import pytest

sys.path.insert(0, "/app/backend")
import server  # noqa: E402


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
        monkeypatch.setattr(server, "_refresh_all_items", _fake)

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
        monkeypatch.setattr(server, "_refresh_all_items", _fake)
        for _ in range(25):
            _run(server._refresh_all_and_record(trigger="manual", attempt=1))
        sched = _run(server._get_scraper_schedule())
        assert len(sched["run_history"]) == server.RUN_HISTORY_LIMIT == 20

    def test_newest_first(self, monkeypatch):
        async def _fake(**kw):
            return {"refreshed": 1, "sold_found": 0, "failed": 0, "total": 1}
        monkeypatch.setattr(server, "_refresh_all_items", _fake)
        _run(server._refresh_all_and_record(trigger="manual", attempt=1))
        _run(server._refresh_all_and_record(trigger="manual", attempt=1))
        sched = _run(server._get_scraper_schedule())
        h = sched["run_history"]
        assert len(h) == 2
        assert h[0]["started_at"] >= h[1]["started_at"]

    def test_scheduled_failure_queues_retry(self, monkeypatch):
        async def _fail(**kw):
            return {"refreshed": 0, "sold_found": 0, "failed": 3, "total": 3}
        monkeypatch.setattr(server, "_refresh_all_items", _fail)

        _run(server._refresh_all_and_record(trigger="scheduled", attempt=1))
        sched = _run(server._get_scraper_schedule())
        assert sched["retry_pending"] is not None
        rp = sched["retry_pending"]
        assert rp["trigger"] == "scheduled"
        assert rp["original_run_id"]
        retry_at = datetime.fromisoformat(rp["retry_at"])
        now = datetime.now(timezone.utc)
        delta = (retry_at - now).total_seconds()
        assert 14 * 60 <= delta <= 16 * 60
        h = sched["run_history"]
        assert len(h) == 1 and h[0]["status"] == "failed" and h[0]["attempt"] == 1

    def test_exception_also_queues_retry(self, monkeypatch):
        async def _boom(**kw):
            raise RuntimeError("boom-network")
        monkeypatch.setattr(server, "_refresh_all_items", _boom)

        _run(server._refresh_all_and_record(trigger="scheduled", attempt=1))
        sched = _run(server._get_scraper_schedule())
        assert sched["retry_pending"] is not None
        h = sched["run_history"]
        assert h[0]["status"] == "failed"
        assert "boom-network" in (h[0]["error"] or "")

    def test_retry_success_clears_pending(self, monkeypatch):
        async def _fail(**kw):
            return {"refreshed": 0, "sold_found": 0, "failed": 2, "total": 2}
        monkeypatch.setattr(server, "_refresh_all_items", _fail)
        _run(server._refresh_all_and_record(trigger="scheduled", attempt=1))
        sched = _run(server._get_scraper_schedule())
        rp = sched["retry_pending"]
        assert rp is not None

        async def _ok(**kw):
            return {"refreshed": 2, "sold_found": 0, "failed": 0, "total": 2}
        monkeypatch.setattr(server, "_refresh_all_items", _ok)
        _run(server._refresh_all_and_record(trigger="retry", attempt=2, original_run_id=rp["original_run_id"]))

        sched = _run(server._get_scraper_schedule())
        assert sched["retry_pending"] is None
        h = sched["run_history"]
        assert len(h) == 2
        assert h[0]["status"] == "success" and h[0]["attempt"] == 2 and h[0]["trigger"] == "retry"
        assert h[1]["status"] == "failed" and h[1]["attempt"] == 1

    def test_retry_failure_marks_dead(self, monkeypatch):
        async def _fail(**kw):
            return {"refreshed": 0, "sold_found": 0, "failed": 4, "total": 4}
        monkeypatch.setattr(server, "_refresh_all_items", _fail)
        _run(server._refresh_all_and_record(trigger="scheduled", attempt=1))
        sched = _run(server._get_scraper_schedule())
        rp = sched["retry_pending"]

        _run(server._refresh_all_and_record(trigger="retry", attempt=2, original_run_id=rp["original_run_id"]))
        sched = _run(server._get_scraper_schedule())
        assert sched["retry_pending"] is None
        h = sched["run_history"]
        assert h[0]["status"] == "dead" and h[0]["attempt"] == 2

    def test_manual_failure_does_not_queue_retry(self, monkeypatch):
        async def _fail(**kw):
            return {"refreshed": 0, "sold_found": 0, "failed": 1, "total": 1}
        monkeypatch.setattr(server, "_refresh_all_items", _fail)
        _run(server._refresh_all_and_record(trigger="manual", attempt=1))
        sched = _run(server._get_scraper_schedule())
        assert sched["retry_pending"] is None
        assert sched["run_history"][0]["status"] == "failed"

    def test_clear_history_wipes_entries(self, monkeypatch):
        async def _fake(**kw):
            return {"refreshed": 1, "sold_found": 0, "failed": 0, "total": 1}
        monkeypatch.setattr(server, "_refresh_all_items", _fake)
        _run(server._refresh_all_and_record(trigger="manual", attempt=1))

        _run(server.clear_scraper_history())

        sched = _run(server._get_scraper_schedule())
        assert sched["run_history"] == []
        assert sched["retry_pending"] is None
