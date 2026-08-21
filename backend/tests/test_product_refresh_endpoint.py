"""Backend tests for the product-refresh endpoint (used by the new detail page's
Refresh from eBay button). Full frontend behaviour is covered by the testing agent.
"""
import uuid
from pathlib import Path

import requests

BASE_URL = ""
for line in Path("/app/frontend/.env").read_text().splitlines():
    if line.startswith("REACT_APP_BACKEND_URL="):
        BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
API = f"{BASE_URL}/api"


def _create_product(**kw):
    body = {"title": kw.pop("title", f"Test-{uuid.uuid4().hex[:6]}"), "price": 20, "cost": 10, "stock": 5, **kw}
    r = requests.post(f"{API}/products", json=body, timeout=15)
    r.raise_for_status()
    return r.json()


class TestRefreshEndpoint:
    def test_refresh_without_source_url_returns_400(self):
        p = _create_product()
        try:
            r = requests.post(f"{API}/products/{p['id']}/refresh", timeout=15)
            assert r.status_code == 400
            assert "isn't linked to an eBay URL" in r.json()["detail"]
        finally:
            requests.delete(f"{API}/products/{p['id']}", timeout=15)

    def test_refresh_404_on_missing(self):
        r = requests.post(f"{API}/products/does-not-exist/refresh", timeout=15)
        assert r.status_code == 404

    def test_refresh_rejects_non_ebay_source_url(self):
        p = _create_product(source_url="https://example.com/not-ebay")
        try:
            r = requests.post(f"{API}/products/{p['id']}/refresh", timeout=15)
            assert r.status_code == 400
        finally:
            requests.delete(f"{API}/products/{p['id']}", timeout=15)


class TestGetProduct:
    def test_returns_review_aggregate(self):
        p = _create_product()
        try:
            r = requests.get(f"{API}/products/{p['id']}", timeout=15).json()
            assert "review_count" in r and "average_rating" in r
            assert r["review_count"] == 0
            assert r["average_rating"] == 0.0
        finally:
            requests.delete(f"{API}/products/{p['id']}", timeout=15)
