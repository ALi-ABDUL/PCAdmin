"""Unit coverage for permanent scraper-provider deletion.

Uses an in-memory collection double only; no provider network call is made.
"""
import asyncio
import inspect
import sys

import pytest
from fastapi import HTTPException

sys.path.insert(0, "/app/backend")
import server  # noqa: E402


def _run(coro):
    return asyncio.run(coro)


class _Collection:
    def __init__(self, document=None):
        self.document = document
        self.deleted_queries = []

    async def find_one(self, _query, _projection=None):
        return self.document

    async def update_one(self, _query, update, upsert=False):
        if self.document is None:
            self.document = {"id": "singleton"}
        self.document.update(update["$set"])

    async def delete_many(self, query):
        self.deleted_queries.append(query)


class _Db:
    def __init__(self, settings):
        self.scraper_api_settings = _Collection(settings)
        self.scraper_provider_usage = _Collection()


def test_delete_route_declares_admin_session_dependency():
    parameter = inspect.signature(server.delete_scraper_api).parameters["current_admin"]
    assert parameter.default.dependency is server.get_current_admin


def test_delete_builtin_provider_removes_secrets_and_usage(monkeypatch):
    fake_db = _Db({
        "id": "singleton",
        "providers": [
            {"id": "scrapingbee", "type": "scrapingbee", "label": "ScrapingBee", "enabled": True, "api_key": "secret-key"},
            {"id": "custom-keep", "type": "custom", "label": "Keep", "enabled": False, "endpoint": "https://example.com/scrape"},
        ],
    })
    monkeypatch.setattr(server, "db", fake_db)

    result = _run(server.delete_scraper_api("ScrapingBee", current_admin={"id": "admin"}))

    assert [provider["id"] for provider in fake_db.scraper_api_settings.document["providers"]] == ["custom-keep"]
    assert fake_db.scraper_provider_usage.deleted_queries == [{"provider_id": "scrapingbee"}]
    assert [provider["id"] for provider in result["providers"]] == ["custom-keep"]
    assert all("api_key" not in provider for provider in result["providers"])
    # Deleted built-ins must not silently return on later settings reads.
    next_read = _run(server._get_scraper_api_settings())
    assert [provider["id"] for provider in next_read["providers"]] == ["custom-keep"]


def test_delete_missing_provider_returns_404(monkeypatch):
    fake_db = _Db({"id": "singleton", "providers": []})
    monkeypatch.setattr(server, "db", fake_db)

    before = list(fake_db.scraper_api_settings.document["providers"])
    with pytest.raises(HTTPException) as error:
        _run(server.delete_scraper_api("scrapingbee", current_admin={"id": "admin"}))

    assert error.value.status_code == 404
    assert fake_db.scraper_api_settings.document["providers"] == before