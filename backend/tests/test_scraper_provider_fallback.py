"""Provider-chain tests. All network calls are mocked; no provider is contacted."""
from __future__ import annotations

import asyncio
import sys

import pytest

sys.path.insert(0, "/app/backend")
import scraper  # noqa: E402


def test_auto_uses_manual_before_configured_providers(monkeypatch):
    calls = []

    async def manual(url):
        calls.append("manual")
        return "<html>ok</html>"

    async def provider(url, config):
        calls.append(config["id"])
        return "<html>provider</html>"

    monkeypatch.setattr(scraper, "_fetch_manual", manual)
    monkeypatch.setattr(scraper, "_fetch_provider", provider)
    html, used = asyncio.run(scraper.fetch_html("https://www.ebay.com.au/itm/123", providers=[
        {"id": "scrapingbee", "type": "scrapingbee", "enabled": True, "api_key": "key"},
    ]))
    assert html == "<html>ok</html>"
    assert used == "manual"
    assert calls == ["manual"]


def test_auto_keeps_fixed_builtin_order_then_custom(monkeypatch):
    calls = []

    async def manual(url):
        calls.append("manual")
        raise scraper.BlockedError("blocked")

    async def provider(url, config):
        calls.append(config["id"])
        if config["id"] != "scraperapi":
            raise scraper.ScrapeError("provider failed")
        return "<html>ok</html>"

    monkeypatch.setattr(scraper, "_fetch_manual", manual)
    monkeypatch.setattr(scraper, "_fetch_provider", provider)
    _, used = asyncio.run(scraper.fetch_html("https://www.ebay.com.au/itm/123", providers=[
        {"id": "custom-one", "type": "custom", "enabled": True, "endpoint": "https://example.com", "auth_mode": "none"},
        {"id": "scraperapi", "type": "scraperapi", "enabled": True, "api_key": "key"},
        {"id": "scrapingbee", "type": "scrapingbee", "enabled": True, "api_key": "key"},
    ]))
    assert used == "scraperapi"
    assert calls == ["manual", "scrapingbee", "scraperapi"]


def test_auto_skips_disabled_or_incomplete_providers(monkeypatch):
    calls = []

    async def manual(url):
        calls.append("manual")
        raise scraper.BlockedError("blocked")

    async def provider(url, config):
        calls.append(config["id"])
        return "<html>ok</html>"

    monkeypatch.setattr(scraper, "_fetch_manual", manual)
    monkeypatch.setattr(scraper, "_fetch_provider", provider)
    _, used = asyncio.run(scraper.fetch_html("https://www.ebay.com.au/itm/123", providers=[
        {"id": "scrapingbee", "type": "scrapingbee", "enabled": False, "api_key": "key"},
        {"id": "scraperapi", "type": "scraperapi", "enabled": True, "api_key": ""},
        {"id": "custom-one", "type": "custom", "enabled": True, "endpoint": "https://example.com", "auth_mode": "none"},
    ]))
    assert used == "custom-one"
    assert calls == ["manual", "custom-one"]


def test_explicit_provider_requires_saved_configuration():
    with pytest.raises(scraper.ScrapeError, match="not configured"):
        asyncio.run(scraper.fetch_html("https://www.ebay.com.au/itm/123", method="scrapedo", providers=[]))