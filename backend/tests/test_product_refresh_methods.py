"""Method-selection coverage for product refresh, with no live scraping."""
import asyncio
import sys

from pymongo.errors import DuplicateKeyError

sys.path.insert(0, "/app/backend")
import server  # noqa: E402
from models import Product, RefreshAllRequest  # noqa: E402


def _run(coro):
    return asyncio.run(coro)


class _Products:
    def __init__(self):
        self.document = {
            "id": "product-1", "title": "Old title", "source_url": "https://www.ebay.com.au/itm/123456789012",
            "images": [], "cost": 10.0, "active": True, "description": "", "stock": 2,
        }

    async def find_one(self, _query, _projection=None):
        return dict(self.document)

    async def update_one(self, _query, update):
        self.document.update(update["$set"])


class _Db:
    def __init__(self):
        self.products = _Products()


def test_product_refresh_passes_selected_provider_method(monkeypatch):
    fake_db = _Db()
    captured = {}

    async def fake_fetch(url, **kwargs):
        captured["url"] = url
        captured["method"] = kwargs["method"]
        return "<html></html>", "scraperapi"

    async def fake_parse(_html, _url):
        return {"title": "Fresh title", "images": ["https://example.invalid/image.jpg"], "price_value": 12.0, "stock_status": "live", "is_sold": False, "description": "Fresh"}

    async def fake_settings():
        return {"providers": [{"id": "scraperapi", "enabled": True}]}

    monkeypatch.setattr(server, "db", fake_db)
    monkeypatch.setattr(server, "fetch_html", fake_fetch)
    monkeypatch.setattr(server, "parse_and_enrich", fake_parse)
    monkeypatch.setattr(server, "_get_scraper_api_settings", fake_settings)

    refreshed = _run(server.refresh_product_from_ebay("product-1", RefreshAllRequest(method="scraperapi")))

    assert captured["method"] == "scraperapi"
    assert refreshed["method_used"] == "scraperapi"
    assert refreshed["title"] == "Fresh title"


def test_product_refresh_manual_method_is_forwarded(monkeypatch):
    fake_db = _Db()
    captured = {}

    async def fake_fetch(_url, **kwargs):
        captured["method"] = kwargs["method"]
        return "<html></html>", "manual"

    async def fake_parse(_html, _url):
        return {"title": "Fresh title", "images": [], "price_value": 10.0, "stock_status": "live", "is_sold": False}

    monkeypatch.setattr(server, "db", fake_db)
    monkeypatch.setattr(server, "fetch_html", fake_fetch)
    monkeypatch.setattr(server, "parse_and_enrich", fake_parse)
    monkeypatch.setattr(server, "_get_scraper_api_settings", lambda: asyncio.sleep(0, result={"providers": []}))

    _run(server.refresh_product_from_ebay("product-1", RefreshAllRequest(method="manual")))

    assert captured["method"] == "manual"


def test_product_refresh_empty_body_defaults_to_auto(monkeypatch):
    """Endpoint compatibility: empty POST body should default to auto method."""
    fake_db = _Db()
    captured = {}

    async def fake_fetch(_url, **kwargs):
        captured["method"] = kwargs["method"]
        return "<html></html>", "auto"

    async def fake_parse(_html, _url):
        return {"title": "Fresh title", "images": [], "price_value": 10.0, "stock_status": "live", "is_sold": False}

    monkeypatch.setattr(server, "db", fake_db)
    monkeypatch.setattr(server, "fetch_html", fake_fetch)
    monkeypatch.setattr(server, "parse_and_enrich", fake_parse)
    monkeypatch.setattr(server, "_get_scraper_api_settings", lambda: asyncio.sleep(0, result={"providers": []}))

    _run(server.refresh_product_from_ebay("product-1", None))

    assert captured["method"] == "auto"


def test_product_insert_retries_product_code_collision(monkeypatch):
    class _InsertProducts:
        def __init__(self):
            self.codes = []

        async def insert_one(self, document):
            self.codes.append(document["product_code"])
            if len(self.codes) == 1:
                raise DuplicateKeyError("E11000 duplicate key error index: product_code_1")

    class _InsertDb:
        def __init__(self):
            self.products = _InsertProducts()

    fake_db = _InsertDb()
    codes = iter(["KF15-PC1026", "KF15-PC1026-2"])

    async def fake_code(_title):
        return next(codes)

    monkeypatch.setattr(server, "db", fake_db)
    monkeypatch.setattr(server, "_generate_unique_product_code", fake_code)
    product = Product(title="Keyboard", price=99, cost=50, stock=1)

    saved = _run(server._insert_product_with_unique_code(product))

    assert fake_db.products.codes == ["KF15-PC1026", "KF15-PC1026-2"]
    assert saved.product_code == "KF15-PC1026-2"