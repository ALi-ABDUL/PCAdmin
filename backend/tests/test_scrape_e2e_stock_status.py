"""E2E-style tests for the stock_status fix.

Uses in-process parse_and_enrich with synthetic HTML (the accepted alternative
per the review request, since real eBay scrapes may be rate-limited).
Also attempts a live scrape via /api/scrape and gracefully skips on block.
"""
import asyncio
import os
import sys
import pytest
import requests

sys.path.insert(0, "/app/backend")
from scraper import parse_and_enrich  # noqa: E402

def _load_backend_url() -> str:
    val = os.environ.get("REACT_APP_BACKEND_URL")
    if not val:
        try:
            with open("/app/frontend/.env") as f:
                for line in f:
                    if line.startswith("REACT_APP_BACKEND_URL="):
                        val = line.split("=", 1)[1].strip()
                        break
        except FileNotFoundError:
            pass
    if not val:
        raise RuntimeError("REACT_APP_BACKEND_URL not configured")
    return val.rstrip("/")


BASE_URL = _load_backend_url()


def _mk_html(availability_url: str, extra_scripts: str = "", extra_body: str = "") -> str:
    return f"""<!doctype html><html><head>
    <title>Test Item | eBay</title>
    <script type="application/ld+json">
    {{"@context":"https://schema.org","@type":"Product","name":"Synthetic Test Item",
      "offers":{{"@type":"Offer","price":"99.00","priceCurrency":"AUD",
                "availability":"{availability_url}"}}}}
    </script>
    {extra_scripts}
    </head><body>
    <h1 class="x-item-title__mainTitle">Synthetic Test Item</h1>
    <div class="x-price-primary">AU $99.00</div>
    {extra_body}
    </body></html>"""


class TestParseAndEnrichStockStatus:
    """In-process E2E: exercise the exact classifier used by /api/scrape."""

    def test_live_listing_with_noisy_scripts_stays_live(self):
        # #5 – InStock main offer + script/footer noise containing OOS phrases
        html = _mk_html(
            "https://schema.org/InStock",
            extra_scripts='<script>window.__data={"msg":"out of stock","help":"no longer available"};</script>',
            extra_body='<footer>If an item is no longer available, contact support. This item has sold in similar categories.</footer>'
                      '<aside class="related"><div>Related: out of stock</div></aside>',
        )
        data = asyncio.get_event_loop().run_until_complete(
            parse_and_enrich(html, "https://www.ebay.com.au/itm/999999999999", fetch_desc=False)
        )
        assert data.get("stock_status") == "live", f"Expected live, got {data.get('stock_status')}"
        assert data.get("is_sold") is False

    def test_out_of_stock_main_offer_flips_sold(self):
        # #6 – positive signal path still works
        html = _mk_html("https://schema.org/OutOfStock")
        data = asyncio.get_event_loop().run_until_complete(
            parse_and_enrich(html, "https://www.ebay.com.au/itm/999999999998", fetch_desc=False)
        )
        assert data.get("stock_status") == "out_of_stock"
        assert data.get("is_sold") is True

    def test_default_when_no_signal_is_live(self):
        # #7 – no InStock, no OOS, no banner → live
        html = """<!doctype html><html><head><title>Bare Item | eBay</title></head><body>
                  <h1 class="x-item-title__mainTitle">Bare Item</h1>
                  <div class="x-price-primary">AU $10</div></body></html>"""
        data = asyncio.get_event_loop().run_until_complete(
            parse_and_enrich(html, "https://www.ebay.com.au/itm/999999999997", fetch_desc=False)
        )
        assert data.get("stock_status") == "live"
        assert data.get("is_sold") is False


class TestScrapeEndpointLive:
    """Real HTTP hit to /api/scrape. Skips on eBay anti-bot block (expected)."""

    def test_live_ebay_url_returns_live(self):
        url = "https://www.ebay.com.au/itm/278060232957"
        try:
            r = requests.post(f"{BASE_URL}/api/scrape", json={"url": url, "save": False}, timeout=60)
        except Exception as e:
            pytest.skip(f"Network error hitting endpoint: {e}")
        if r.status_code == 502:
            pytest.skip(f"eBay anti-bot block (expected/allowed): {r.text[:200]}")
        assert r.status_code == 200, f"Unexpected status: {r.status_code} body={r.text[:400]}"
        body = r.json()
        item = body.get("item", body)
        assert item.get("stock_status") == "live", item
        assert item.get("is_sold") is False, item
