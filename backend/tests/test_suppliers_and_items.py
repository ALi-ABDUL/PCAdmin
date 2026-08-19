"""Backend tests: refactored Suppliers (auto eBay sellers) + Items filters."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # fallback to frontend/.env
    from pathlib import Path
    for line in Path("/app/frontend/.env").read_text().splitlines():
        if line.startswith("REACT_APP_BACKEND_URL="):
            BASE_URL = line.split("=", 1)[1].strip().rstrip("/")

API = f"{BASE_URL}/api"


# --- Suppliers ---------------------------------------------------------------

class TestSuppliers:
    def test_list_suppliers_shape(self):
        r = requests.get(f"{API}/suppliers", timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert "suppliers" in data and "total" in data
        assert isinstance(data["suppliers"], list)
        if data["suppliers"]:
            s = data["suppliers"][0]
            for k in ["id", "name", "location", "total_products", "total_orders",
                      "revenue_generated", "last_active", "status"]:
                assert k in s, f"missing {k}"
            assert s["status"] in ("active", "inactive")
            # Ensure NO B2B fields
            for forbidden in ["lead_time_days", "payment_terms", "rating", "spend",
                              "quality_score", "code", "terms"]:
                assert forbidden not in s, f"forbidden field present: {forbidden}"

    def test_suppliers_search_q(self):
        r = requests.get(f"{API}/suppliers", params={"q": "zzznonexistentxyz"}, timeout=30)
        assert r.status_code == 200
        assert r.json()["suppliers"] == []

    def test_suppliers_status_filter(self):
        r_all = requests.get(f"{API}/suppliers", timeout=30).json()
        r_active = requests.get(f"{API}/suppliers", params={"status": "active"}, timeout=30).json()
        r_inactive = requests.get(f"{API}/suppliers", params={"status": "inactive"}, timeout=30).json()
        assert all(s["status"] == "active" for s in r_active["suppliers"])
        assert all(s["status"] == "inactive" for s in r_inactive["suppliers"])
        assert len(r_active["suppliers"]) + len(r_inactive["suppliers"]) == r_all["total"]

    def test_suppliers_sort(self):
        for sort in ["revenue_desc", "orders_desc", "products_desc", "name_asc", "last_active_desc"]:
            r = requests.get(f"{API}/suppliers", params={"sort": sort}, timeout=30)
            assert r.status_code == 200, f"sort {sort} failed"

        r = requests.get(f"{API}/suppliers", params={"sort": "products_desc"}, timeout=30).json()
        prods = [s["total_products"] for s in r["suppliers"]]
        assert prods == sorted(prods, reverse=True)

        r2 = requests.get(f"{API}/suppliers", params={"sort": "name_asc"}, timeout=30).json()
        names = [s["name"].lower() for s in r2["suppliers"]]
        assert names == sorted(names)

    def test_suppliers_summary(self):
        r = requests.get(f"{API}/suppliers/summary", timeout=30)
        assert r.status_code == 200
        d = r.json()
        for k in ["total", "active", "top_suppliers", "aggregate"]:
            assert k in d
        assert len(d["top_suppliers"]) <= 5
        agg = d["aggregate"]
        for k in ["total_revenue", "total_orders", "total_products"]:
            assert k in agg
        # forbidden legacy fields
        for f in ["total_spend", "avg_rating", "quality_suppliers"]:
            assert f not in d and f not in agg

    def test_old_b2b_endpoints_removed(self):
        # POST /suppliers
        r = requests.post(f"{API}/suppliers", json={"name": "x"}, timeout=15)
        assert r.status_code in (404, 405), f"POST returned {r.status_code}"
        r = requests.post(f"{API}/suppliers/import", json={}, timeout=15)
        assert r.status_code in (404, 405)
        r = requests.patch(f"{API}/suppliers/xyz", json={}, timeout=15)
        assert r.status_code in (404, 405)
        r = requests.delete(f"{API}/suppliers/xyz", timeout=15)
        assert r.status_code in (404, 405)


# --- Items -------------------------------------------------------------------

class TestItems:
    def test_items_status_filter(self):
        r_all = requests.get(f"{API}/items", timeout=30).json()
        r_live = requests.get(f"{API}/items", params={"status": "live"}, timeout=30).json()
        r_sold = requests.get(f"{API}/items", params={"status": "sold"}, timeout=30).json()
        assert r_all["total"] >= 1
        assert r_live["total"] + r_sold["total"] == r_all["total"]
        assert all(not it.get("is_sold") for it in r_live["items"])
        assert all(it.get("is_sold") for it in r_sold["items"])

    def test_items_sort(self):
        for sort in ["price_desc", "price_asc", "created_at_asc", "title_asc"]:
            r = requests.get(f"{API}/items", params={"sort": sort, "limit": 20}, timeout=30)
            assert r.status_code == 200, f"{sort} failed"
        r = requests.get(f"{API}/items", params={"sort": "price_desc", "limit": 50}, timeout=30).json()
        prices = [it.get("price_value") for it in r["items"] if it.get("price_value") is not None]
        assert prices == sorted(prices, reverse=True)


# --- Scraper endpoint smoke checks ------------------------------------------

class TestScraperEndpoints:
    def test_refresh_status(self):
        r = requests.get(f"{API}/items/refresh-status", timeout=15)
        assert r.status_code == 200

    def test_sold_events(self):
        r = requests.get(f"{API}/sold-events", params={"unread_only": False, "mark_seen": False}, timeout=15)
        assert r.status_code == 200
        assert "events" in r.json()

    def test_scrape_validation(self):
        # No URL should 4xx
        r = requests.post(f"{API}/scrape", json={"url": ""}, timeout=15)
        assert r.status_code in (400, 422)

    def test_refresh_all_endpoint_exists(self):
        # Do a HEAD/OPTIONS to confirm route exists without hitting eBay
        r = requests.options(f"{API}/items/refresh-all", timeout=15)
        assert r.status_code in (200, 204, 405)
