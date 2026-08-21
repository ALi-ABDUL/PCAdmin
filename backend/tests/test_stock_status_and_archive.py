"""Backend tests for the stock-status lifecycle + product archive/restore endpoints."""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    from pathlib import Path
    for line in Path("/app/frontend/.env").read_text().splitlines():
        if line.startswith("REACT_APP_BACKEND_URL="):
            BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
API = f"{BASE_URL}/api"


def _create_product(**kw):
    body = {
        "title": kw.pop("title", f"Test-{uuid.uuid4().hex[:6]}"),
        "price": kw.pop("price", 99.0),
        "cost": kw.pop("cost", 40.0),
        "stock": kw.pop("stock", 10),
        "category": kw.pop("category", "other"),
        **kw,
    }
    r = requests.post(f"{API}/products", json=body, timeout=15)
    r.raise_for_status()
    return r.json()


class TestArchiveLifecycle:
    def test_new_product_defaults(self):
        p = _create_product()
        assert p["archived"] is False
        assert p.get("stock_status") in (None, "live")  # default live
        assert p["active"] is True
        requests.delete(f"{API}/products/{p['id']}", timeout=15)

    def test_archive_hides_from_default_list(self):
        p = _create_product(title=f"Archive-me-{uuid.uuid4().hex[:6]}")
        # Count before
        before = requests.get(f"{API}/products", params={"limit": 1000}, timeout=15).json()["total"]
        # Archive
        r = requests.post(f"{API}/products/{p['id']}/archive", timeout=15)
        assert r.status_code == 200
        arch = r.json()
        assert arch["archived"] is True
        assert arch["active"] is False
        assert arch["archived_at"]
        # Not in default list
        after = requests.get(f"{API}/products", params={"limit": 1000}, timeout=15).json()["total"]
        assert after == before - 1
        # But shows up under ?archived=true
        arch_only = requests.get(f"{API}/products", params={"archived": "true", "limit": 1000}, timeout=15).json()
        assert any(x["id"] == p["id"] for x in arch_only["products"])
        # Cleanup
        requests.delete(f"{API}/products/{p['id']}", timeout=15)

    def test_restore_from_archive(self):
        p = _create_product(title=f"Restore-me-{uuid.uuid4().hex[:6]}")
        requests.post(f"{API}/products/{p['id']}/archive", timeout=15)
        r = requests.post(f"{API}/products/{p['id']}/restore", timeout=15)
        assert r.status_code == 200
        restored = r.json()
        assert restored["archived"] is False
        assert restored["archived_at"] in (None, "")
        # Live product → restored to active
        assert restored["active"] is True
        requests.delete(f"{API}/products/{p['id']}", timeout=15)

    def test_restore_does_not_reactivate_sold_product(self):
        p = _create_product(title=f"Sold-{uuid.uuid4().hex[:6]}")
        # Simulate a scrape marking it sold by patching (backend only accepts stock_status via ProductUpdate now)
        requests.patch(f"{API}/products/{p['id']}", json={"stock_status": "sold", "active": False}, timeout=15)
        requests.post(f"{API}/products/{p['id']}/archive", timeout=15)
        r = requests.post(f"{API}/products/{p['id']}/restore", timeout=15).json()
        assert r["archived"] is False
        # Because eBay still shows sold, restore must NOT reactivate
        assert r["active"] is False
        requests.delete(f"{API}/products/{p['id']}", timeout=15)

    def test_archive_404_on_missing(self):
        r = requests.post(f"{API}/products/does-not-exist/archive", timeout=15)
        assert r.status_code == 404


class TestScraperStockStatusClassification:
    """Unit-test the scraper's status classifier via parse_and_enrich by feeding minimal HTML."""

    @staticmethod
    def _parse(html: str) -> dict:
        import asyncio, sys
        sys.path.insert(0, "/app/backend")
        from scraper import parse_and_enrich
        return asyncio.get_event_loop().run_until_complete(
            parse_and_enrich(html, "https://www.ebay.com.au/itm/1234567890")
        )

    def test_html_ended(self):
        data = self._parse("<html><body>This listing has ended.</body></html>")
        assert data["stock_status"] == "ended"
        assert data["is_sold"] is True

    def test_html_sold(self):
        html = '<html><body><span itemprop="itemAvailability">SoldOut</span></body></html>'
        data = self._parse(html)
        assert data["stock_status"] == "sold"
        assert data["is_sold"] is True

    def test_html_out_of_stock(self):
        html = '<html><body><meta itemprop="itemAvailability" content="https://schema.org/OutOfStock"></body></html>'
        data = self._parse(html.lower())
        assert data["stock_status"] == "out_of_stock"
        assert data["is_sold"] is True

    def test_html_live(self):
        html = "<html><body><h1 class='x-item-title__mainTitle'>Widget</h1></body></html>"
        data = self._parse(html)
        assert data["stock_status"] == "live"
        assert data["is_sold"] is False
