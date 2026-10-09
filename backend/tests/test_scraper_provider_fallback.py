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


def test_auto_uses_scrapebadger_after_html_providers_before_custom(monkeypatch):
    calls = []

    async def manual(_url):
        calls.append("manual")
        raise scraper.BlockedError("blocked")

    async def provider(_url, config):
        calls.append(config["id"])
        if config["id"] == "scrapebadger":
            return {"item": {"item_id": "1234567890", "title": "Structured item"}}
        raise scraper.ScrapeError("failed")

    monkeypatch.setattr(scraper, "_fetch_manual", manual)
    monkeypatch.setattr(scraper, "_fetch_provider", provider)
    payload, used = asyncio.run(scraper.fetch_html("https://www.ebay.com.au/itm/1234567890", providers=[
        {"id": "scrapingbee", "type": "scrapingbee", "enabled": True, "api_key": "key"},
        {"id": "scrapebadger", "type": "scrapebadger", "enabled": True, "api_key": "key"},
        {"id": "custom-one", "type": "custom", "enabled": True, "endpoint": "https://example.com", "auth_mode": "none"},
    ]))
    assert used == "scrapebadger"
    assert payload["item"]["title"] == "Structured item"
    assert calls == ["manual", "scrapingbee", "scrapebadger"]


def test_scrapebadger_json_maps_to_normalised_item_schema():
    payload = {
        "item": {
            "item_id": "1234567890", "title": "Demo Monitor", "price": {"value": "299.95", "currency": "AUD"},
            "images": [{"url": "https://images.example/monitor.jpg"}], "description": "A tested monitor.",
            "shipping_cost": {"value": "12.50"}, "shipping_options": ["Standard post"],
            "availability": "In stock", "quantity_available": 3,
        }
    }
    mapped = scraper.parse_scrapebadger_item(payload, "https://www.ebay.com.au/itm/1234567890")
    assert mapped["item_id"] == "1234567890"
    assert mapped["title"] == "Demo Monitor"
    assert mapped["price_value"] == 299.95
    assert mapped["postage_fee"] == 12.5
    assert mapped["images"] == ["https://images.example/monitor.jpg"]
    assert mapped["stock_status"] == "live"


def test_scrapebadger_request_uses_item_id_domain_and_header(monkeypatch):
    captured = {}

    class FakeResponse:
        status_code = 200
        def json(self): return {"item": {"item_id": "1234567890"}}

    class FakeClient:
        async def __aenter__(self): return self
        async def __aexit__(self, *_args): return False
        async def get(self, url, params, headers):
            captured.update({"url": url, "params": params, "headers": headers})
            return FakeResponse()

    monkeypatch.setattr(scraper.httpx, "AsyncClient", lambda **_kwargs: FakeClient())
    payload = asyncio.run(scraper._fetch_scrapebadger("https://www.ebay.com.au/itm/1234567890", {"api_key": "test-key"}))
    assert payload["item"]["item_id"] == "1234567890"
    assert captured["url"].endswith("/1234567890")
    assert captured["params"] == {"domain": "com.au"}
    assert captured["headers"] == {"x-api-key": "test-key"}


def test_scrapebadger_url_extraction_accepts_au_itm_and_query_item():
    assert scraper.ebay_item_id_from_url("https://www.ebay.com.au/itm/123456789012") == "123456789012"
    assert scraper.ebay_item_id_from_url("www.ebay.com.au/itm/Title-Here/987654321098") == "987654321098"
    assert scraper.ebay_item_id_from_url("https://www.ebay.com.au/sch/i.html?item=112233445566") == "112233445566"


def test_scrapebadger_url_extraction_rejects_non_au_or_missing_item_id():
    with pytest.raises(scraper.NotEbayAUError):
        scraper.ebay_item_id_from_url("https://www.ebay.com/itm/123456789012")
    with pytest.raises(scraper.ScrapeError, match="Could not extract"):
        scraper.ebay_item_id_from_url("https://www.ebay.com.au/sch/i.html?_nkw=monitor")


def test_scrapebadger_fetch_invalid_json_raises_safe_error(monkeypatch):
    class FakeResponse:
        status_code = 200

        def json(self):
            raise ValueError("bad json")

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return False

        async def get(self, _url, params, headers):
            assert params == {"domain": "com.au"}
            assert "x-api-key" in headers
            return FakeResponse()

    monkeypatch.setattr(scraper.httpx, "AsyncClient", lambda **_kwargs: FakeClient())
    with pytest.raises(scraper.ScrapeError, match="invalid JSON"):
        asyncio.run(scraper._fetch_scrapebadger("https://www.ebay.com.au/itm/1234567890", {"api_key": "test-key"}))


def test_structured_json_provider_uses_header_auth_and_maps_paths(monkeypatch):
    captured = {}

    class FakeResponse:
        status_code = 200
        def json(self): return {"product": {"name": "Mapped Widget", "price": "42.50", "images": [{"url": "https://img.example/widget.jpg"}], "description": "JSON description"}, "shipping": {"cost": "8.50"}, "inventory": {"quantity": 4}}

    class FakeClient:
        async def __aenter__(self): return self
        async def __aexit__(self, *_args): return False
        async def get(self, url, params, headers):
            captured.update({"url": url, "params": params, "headers": headers})
            return FakeResponse()

    monkeypatch.setattr(scraper.httpx, "AsyncClient", lambda **_kwargs: FakeClient())
    provider = {
        "id": "chocodata", "type": "structured_json", "label": "Chocodata", "api_key": "test-key",
        "endpoint": "https://api.example.com/products/{item_id}", "structured_auth_mode": "header", "structured_auth_name": "X-API-Key",
        "field_mappings": {"title": "product.name", "price": "product.price", "images": "product.images[*].url", "description": "product.description", "shipping_cost": "shipping.cost", "stock_quantity": "inventory.quantity"},
    }
    result = asyncio.run(scraper._fetch_structured_json("https://www.ebay.com.au/itm/1234567890", provider))
    mapped = scraper.parse_structured_json_item(result, "https://www.ebay.com.au/itm/1234567890")
    assert captured["url"].endswith("/1234567890")
    assert captured["headers"] == {"X-API-Key": "test-key"}
    assert captured["params"] == {}
    assert mapped["title"] == "Mapped Widget"
    assert mapped["price_value"] == 42.5
    assert mapped["postage_fee"] == 8.5
    assert mapped["images"] == ["https://img.example/widget.jpg"]
    assert mapped["quantity_available"] == 4


def test_structured_json_provider_uses_query_auth_and_key_placeholder(monkeypatch):
    captured = {}

    class FakeResponse:
        status_code = 200
        def json(self): return {"title": "Query item"}

    class FakeClient:
        async def __aenter__(self): return self
        async def __aexit__(self, *_args): return False
        async def get(self, url, params, headers):
            captured.update({"url": url, "params": params, "headers": headers})
            return FakeResponse()

    monkeypatch.setattr(scraper.httpx, "AsyncClient", lambda **_kwargs: FakeClient())
    provider = {"id": "json-query", "type": "structured_json", "api_key": "test-key", "endpoint": "https://api.example.com/items/{item_id}?token={key}", "structured_auth_mode": "query", "structured_auth_name": "api_key", "field_mappings": {"title": "title"}}
    asyncio.run(scraper._fetch_structured_json("https://www.ebay.com.au/itm/1234567890", provider))
    assert "token=test-key" in captured["url"]
    assert captured["params"] == {"api_key": "test-key"}
    assert captured["headers"] == {}


def test_scrapebadger_mapper_flags_out_of_stock_quantity_zero():
    payload = {
        "item": {
            "item_id": "1234567890",
            "title": "Demo Item",
            "price": {"value": "19.99", "currency": "AUD"},
            "quantity_available": 0,
            "shipping_cost": {"value": "0"},
            "free_shipping": True,
        }
    }
    mapped = scraper.parse_scrapebadger_item(payload, "https://www.ebay.com.au/itm/1234567890")
    assert mapped["is_sold"] is True
    assert mapped["stock_status"] == "out_of_stock"
    assert mapped["postage_fee"] == 0.0


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


def test_provider_attempt_callback_counts_success_and_failure(monkeypatch):
    attempts = []

    async def manual(_url):
        raise scraper.BlockedError("blocked")

    async def provider(_url, config):
        if config["id"] == "scrapingbee":
            raise scraper.ScrapeError("provider failed")
        return "<html>ok</html>"

    async def tracker(provider_id, succeeded):
        attempts.append((provider_id, succeeded))

    monkeypatch.setattr(scraper, "_fetch_manual", manual)
    monkeypatch.setattr(scraper, "_fetch_provider", provider)
    _, used = asyncio.run(scraper.fetch_html("https://www.ebay.com.au/itm/123", providers=[
        {"id": "scrapingbee", "type": "scrapingbee", "enabled": True, "api_key": "key"},
        {"id": "scraperapi", "type": "scraperapi", "enabled": True, "api_key": "key"},
    ], on_provider_attempt=tracker))

    assert used == "scraperapi"
    assert attempts == [("scrapingbee", False), ("scraperapi", True)]


def test_manual_mode_does_not_emit_provider_attempt(monkeypatch):
    attempts = []

    async def manual(_url):
        return "<html>manual-ok</html>"

    async def tracker(provider_id, succeeded):
        attempts.append((provider_id, succeeded))

    monkeypatch.setattr(scraper, "_fetch_manual", manual)
    html, used = asyncio.run(scraper.fetch_html(
        "https://www.ebay.com.au/itm/123",
        method="manual",
        providers=[{"id": "scrapingbee", "type": "scrapingbee", "enabled": True, "api_key": "key"}],
        on_provider_attempt=tracker,
    ))

    assert used == "manual"
    assert html == "<html>manual-ok</html>"
    assert attempts == []