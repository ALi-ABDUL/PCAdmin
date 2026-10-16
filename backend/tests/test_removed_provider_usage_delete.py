"""Deletion coverage for historical removed-provider usage rows."""
import asyncio
import sys

import pytest
from fastapi import HTTPException

sys.path.insert(0, "/app/backend")
import server  # noqa: E402


def _run(coro):
    return asyncio.run(coro)


class _Result:
    def __init__(self, deleted_count): self.deleted_count = deleted_count


class _Settings:
    def __init__(self, providers): self.document = {"id": "singleton", "providers": providers}
    async def find_one(self, _query, _projection=None): return dict(self.document)


class _Usage:
    def __init__(self, deleted_count): self.deleted_count = deleted_count; self.query = None
    async def delete_many(self, query): self.query = query; return _Result(self.deleted_count)


class _Db:
    def __init__(self, providers, deleted_count):
        self.scraper_api_settings = _Settings(providers)
        self.scraper_provider_usage = _Usage(deleted_count)


def test_removed_usage_delete_permanently_deletes_all_period_rows(monkeypatch):
    fake_db = _Db([], 4)
    monkeypatch.setattr(server, "db", fake_db)

    result = _run(server.delete_removed_scraper_provider_usage("custom-1791461461495", current_admin={"id": "admin"}))

    assert result == {"provider_id": "custom-1791461461495", "deleted_count": 4}
    assert fake_db.scraper_provider_usage.query == {"provider_id": "custom-1791461461495"}


def test_active_provider_usage_cannot_be_deleted_as_removed(monkeypatch):
    monkeypatch.setattr(server, "db", _Db([{"id": "scrapingbee"}], 1))

    with pytest.raises(HTTPException) as error:
        _run(server.delete_removed_scraper_provider_usage("scrapingbee", current_admin={"id": "admin"}))

    assert error.value.status_code == 400