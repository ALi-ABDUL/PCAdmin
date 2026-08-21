"""API-level tests for product_code + order reference + new /orders/{oid} route."""
import os
import re
import uuid
from pathlib import Path

import pytest
import requests

BASE = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE:
    for line in Path("/app/frontend/.env").read_text().splitlines():
        if line.startswith("REACT_APP_BACKEND_URL="):
            BASE = line.split("=", 1)[1].strip().rstrip("/")
API = f"{BASE}/api"

CODE_RE = re.compile(r"^[A-Z0-9][MTWFS][0-3][0-9]-PC[0-1][0-9][0-9]{2}(-\d+)?$")


@pytest.fixture(scope="module")
def created_product():
    body = {"title": f"TEST_Keyboard-{uuid.uuid4().hex[:6]}", "price": 25.0, "cost": 10.0, "stock": 8}
    r = requests.post(f"{API}/products", json=body, timeout=15)
    assert r.status_code == 200, r.text
    p = r.json()
    yield p
    requests.delete(f"{API}/products/{p['id']}", timeout=15)


class TestProductsHaveCode:
    def test_create_product_returns_code(self, created_product):
        assert created_product.get("product_code"), created_product
        assert CODE_RE.match(created_product["product_code"]), created_product["product_code"]
        # First letter should be 'T' (TEST_Keyboard title starts with T)
        assert created_product["product_code"][0] == "T"

    def test_list_products_includes_code(self, created_product):
        r = requests.get(f"{API}/products?limit=500", timeout=15)
        assert r.status_code == 200
        data = r.json()
        products = data.get("products") if isinstance(data, dict) else data
        assert isinstance(products, list)
        # Verify our product is present with product_code
        matched = [p for p in products if p.get("id") == created_product["id"]]
        assert matched, "created product not in list"
        assert matched[0].get("product_code") == created_product["product_code"]
        # Also assert general population
        with_code = [p for p in products if p.get("product_code")]
        assert len(with_code) >= 1

    def test_get_product_by_id_has_code(self, created_product):
        r = requests.get(f"{API}/products/{created_product['id']}", timeout=15)
        assert r.status_code == 200
        assert r.json().get("product_code") == created_product["product_code"]


class TestOrdersReferenceAndSingleFetch:
    def test_create_order_populates_reference(self, created_product):
        body = {
            "product_id": created_product["id"],
            "quantity": 1,
            "customer_name": "TEST_Buyer",
            "customer_email": "test_buyer@example.com",
            "status": "pending",
        }
        r = requests.post(f"{API}/orders", json=body, timeout=15)
        assert r.status_code == 200, r.text
        order = r.json()
        assert order.get("reference") == created_product["product_code"]
        assert order.get("id")

        # GET /api/orders/{oid} works
        oid = order["id"]
        r2 = requests.get(f"{API}/orders/{oid}", timeout=15)
        assert r2.status_code == 200
        got = r2.json()
        assert got["id"] == oid
        assert got.get("reference") == created_product["product_code"]

        # 404 on unknown
        r3 = requests.get(f"{API}/orders/does-not-exist-{uuid.uuid4().hex}", timeout=15)
        assert r3.status_code == 404

        # cleanup
        requests.delete(f"{API}/orders/{oid}", timeout=15)

    def test_list_orders_has_reference(self):
        r = requests.get(f"{API}/orders?limit=50", timeout=15)
        assert r.status_code == 200
        data = r.json()
        orders = data.get("orders", [])
        # At least some orders should have reference populated (backfill ran on startup)
        if orders:
            with_ref = [o for o in orders if o.get("reference")]
            # Allow orders whose product was deleted to have empty ref, but expect majority populated
            assert len(with_ref) >= max(1, int(len(orders) * 0.5)), f"Only {len(with_ref)}/{len(orders)} have reference"

    def test_status_counts_still_works(self):
        # Regression: literal route must not be shadowed by /orders/{oid}
        r = requests.get(f"{API}/orders/status-counts", timeout=15)
        assert r.status_code == 200
        j = r.json()
        assert "total" in j and "counts" in j
        assert isinstance(j["counts"], dict)
