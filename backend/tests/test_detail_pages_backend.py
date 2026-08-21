"""Backend regression tests for the new Product/Order detail pages.
Covers GET/PATCH/DELETE product and GET/PATCH order.
"""
import uuid
from pathlib import Path
import requests

BASE_URL = ""
for line in Path("/app/frontend/.env").read_text().splitlines():
    if line.startswith("REACT_APP_BACKEND_URL="):
        BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
API = f"{BASE_URL}/api"


def _find_seeded_product():
    r = requests.get(f"{API}/products?limit=200", timeout=15).json()
    for p in r.get("products", []):
        if p.get("product_code") == "AF21-PC0826":
            return p["id"]
    return None


def _find_seeded_order():
    r = requests.get(f"{API}/orders?limit=200", timeout=15).json()
    for o in r.get("orders", []):
        if o.get("reference") == "TF21-PC0826-2":
            return o["id"]
    return None


class TestProductDetail:
    def test_get_seeded_product_full_payload(self):
        pid = _find_seeded_product()
        assert pid, "seeded AF21-PC0826 missing"
        r = requests.get(f"{API}/products/{pid}", timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d["product_code"] == "AF21-PC0826"
        assert len(d.get("images", [])) >= 1
        assert len(d.get("variants", [])) == 6
        assert "review_count" in d and "average_rating" in d
        assert d.get("source_url", "").startswith("https://www.ebay.com.au")

    def test_patch_title_and_verify(self):
        body = {"title": f"TEST_{uuid.uuid4().hex[:6]}", "price": 10, "cost": 5, "stock": 1}
        p = requests.post(f"{API}/products", json=body, timeout=15).json()
        try:
            new_title = "TEST_updated_" + uuid.uuid4().hex[:6]
            r = requests.patch(f"{API}/products/{p['id']}", json={"title": new_title}, timeout=15)
            assert r.status_code == 200
            got = requests.get(f"{API}/products/{p['id']}", timeout=15).json()
            assert got["title"] == new_title
        finally:
            requests.delete(f"{API}/products/{p['id']}", timeout=15)

    def test_patch_category_and_verify(self):
        cats = requests.get(f"{API}/categories", timeout=15).json()
        cats = cats.get("categories", cats) if isinstance(cats, dict) else cats
        assert cats, "no categories seeded"
        slug = cats[0]["slug"]
        body = {"title": f"TEST_{uuid.uuid4().hex[:6]}", "price": 10, "cost": 5, "stock": 1}
        p = requests.post(f"{API}/products", json=body, timeout=15).json()
        try:
            r = requests.patch(f"{API}/products/{p['id']}", json={"category": slug}, timeout=15)
            assert r.status_code == 200
            assert requests.get(f"{API}/products/{p['id']}", timeout=15).json()["category"] == slug
        finally:
            requests.delete(f"{API}/products/{p['id']}", timeout=15)

    def test_delete_product(self):
        body = {"title": f"TEST_{uuid.uuid4().hex[:6]}", "price": 10, "cost": 5, "stock": 1}
        p = requests.post(f"{API}/products", json=body, timeout=15).json()
        r = requests.delete(f"{API}/products/{p['id']}", timeout=15)
        assert r.status_code in (200, 204)
        assert requests.get(f"{API}/products/{p['id']}", timeout=15).status_code == 404


class TestOrderDetail:
    def test_get_seeded_order(self):
        oid = _find_seeded_order()
        assert oid, "seeded TF21-PC0826-2 missing"
        r = requests.get(f"{API}/orders/{oid}", timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d["reference"] == "TF21-PC0826-2"
        # Expect customer + shipping fields available for detail page
        assert "customer" in d or "customer_name" in d
        assert "total" in d or "unit_price" in d

    def test_patch_order_status_cycle(self):
        oid = _find_seeded_order()
        assert oid
        original = requests.get(f"{API}/orders/{oid}", timeout=15).json().get("status", "new")
        try:
            for s in ["pending", "processing", "shipped", "delivered"]:
                r = requests.patch(f"{API}/orders/{oid}", json={"status": s}, timeout=15)
                assert r.status_code == 200, f"patch to {s} failed: {r.text}"
                got = requests.get(f"{API}/orders/{oid}", timeout=15).json()
                assert got["status"] == s
        finally:
            requests.patch(f"{API}/orders/{oid}", json={"status": original}, timeout=15)
