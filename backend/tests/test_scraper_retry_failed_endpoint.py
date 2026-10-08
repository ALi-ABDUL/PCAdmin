"""Endpoint tests for manual failed-item retry overrides and request limits.

Feature focus: POST /api/scraper/retry-failed provider override + request cap behavior.
"""

import sys
import uuid

import pytest
from fastapi.testclient import TestClient


sys.path.insert(0, "/app/backend")
import server  # noqa: E402


async def _admin_override():
    return {"id": "test-admin", "role": "admin"}


class TestScraperRetryFailedEndpoint:
    """Covers manual retry-failed endpoint input validation + override forwarding."""

    @pytest.mark.parametrize("method,path", [
        ("GET", "/api/scraper/schedule"),
        ("PUT", "/api/scraper/schedules"),
        ("PATCH", "/api/scraper/schedule"),
        ("POST", "/api/scraper/schedule/run-now"),
        ("POST", "/api/scraper/schedule/clear-history"),
        ("PATCH", "/api/scraper/auto-retry"),
        ("POST", "/api/scraper/retry-item"),
        ("POST", "/api/scraper/retry-failed"),
    ])
    def test_schedule_and_retry_routes_require_admin_session(self, method, path):
        client = TestClient(server.app)
        response = client.request(method, path, json={})
        assert response.status_code == 401

    def test_request_limit_zero_is_rejected(self):
        client = TestClient(server.app)
        server.app.dependency_overrides[server.get_current_admin] = _admin_override
        try:
            res = client.post("/api/scraper/retry-failed", json={"request_limit": 0})
            assert res.status_code == 422
            detail = res.json().get("detail") or []
            assert any((d.get("loc") or [None])[-1] == "request_limit" for d in detail if isinstance(d, dict))
        finally:
            server.app.dependency_overrides.clear()

    def test_provider_override_and_request_limit_forwarded_with_deferred_items(self, monkeypatch):
        client = TestClient(server.app)
        prefix = f"endpoint-retry-{uuid.uuid4().hex[:8]}"
        failed_ids = [f"{prefix}-{n}" for n in range(3)]

        async def fake_get_scraper_schedule():
            return {
                **server.SCRAPER_SCHEDULE_DEFAULTS,
                "last_run_results": [
                    {"id": failed_ids[0], "item_id": failed_ids[0], "ok": False},
                    {"id": failed_ids[1], "item_id": failed_ids[1], "ok": False},
                    {"id": failed_ids[2], "item_id": failed_ids[2], "ok": False},
                ],
                "last_run_stats": {"refreshed": 0, "failed": 3, "sold_found": 0, "total": 3},
            }

        async def fake_get_scraper_schedule_public():
            return await fake_get_scraper_schedule()

        async def fake_get_scraper_settings():
            return {
                "providers": [
                    {"id": "scraperapi", "label": "ScraperAPI", "enabled": True},
                ]
            }

        async def fake_retry_scrape_items(ids, method="auto", request_limit=None):
            assert ids == failed_ids
            assert method == "scraperapi"
            assert request_limit == 2
            return {
                "results": [
                    {"id": failed_ids[0], "item_id": failed_ids[0], "ok": True, "sold": False, "error": None},
                    {"id": failed_ids[1], "item_id": failed_ids[1], "ok": True, "sold": False, "error": None},
                    {"id": failed_ids[2], "item_id": failed_ids[2], "ok": False, "sold": False, "error": "deferred"},
                ],
                "stats": {"refreshed": 2, "failed": 1, "sold_found": 0, "total": 3},
                "retried": 2,
                "attempted_ids": failed_ids[:2],
                "skipped_ids": [],
                "deferred_ids": [failed_ids[2]],
                "limit_reached": True,
            }

        monkeypatch.setattr(server, "_get_scraper_api_settings", fake_get_scraper_settings)
        monkeypatch.setattr(server, "_retry_scrape_items", fake_retry_scrape_items)
        monkeypatch.setattr(server, "_get_scraper_schedule", fake_get_scraper_schedule)
        monkeypatch.setattr(server, "get_scraper_schedule", fake_get_scraper_schedule_public)

        server.app.dependency_overrides[server.get_current_admin] = _admin_override
        try:
            res = client.post(
                "/api/scraper/retry-failed",
                json={"provider_id": "scraperapi", "request_limit": 2},
            )
            assert res.status_code == 200
            body = res.json()
            assert body["ok"] is True
            assert body["retried"] == 2
            assert body["limit_reached"] is True
            assert body["deferred_ids"] == [failed_ids[2]]
            deferred_row = next(r for r in body["results"] if r["id"] == failed_ids[2])
            assert deferred_row["ok"] is False
        finally:
            server.app.dependency_overrides.clear()
