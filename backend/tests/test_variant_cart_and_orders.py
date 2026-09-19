"""Tests for variant-aware cart & orders (Jan 2026).

Covers:
- PATCH /api/cart guest (session_id) — variant price → line_total / subtotal
- GET /api/cart guest
- Cart replacement semantics on PATCH
- JWT-authenticated cart is independent from guest cart
- PATCH /api/cart with neither JWT nor session_id → 400
- POST /api/orders single-product w/ variant override
- POST /api/orders multi-line items[]
- POST /api/orders with neither product_id nor items → 400
- POST /api/orders with unknown product_id → 404
"""
import os
import uuid
import re
import requests
import pytest

def _load_frontend_env():
    env_path = "/app/frontend/.env"
    if os.path.exists(env_path):
        with open(env_path) as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    return line.strip().split("=", 1)[1]
    return None


BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or _load_frontend_env() or "").rstrip("/")
assert BASE_URL, "REACT_APP_BACKEND_URL not configured"
API = f"{BASE_URL}/api"

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def products(client):
    r = client.get(f"{API}/products", params={"limit": 5})
    assert r.status_code == 200, r.text
    data = r.json()
    # Response shape defensive: list either as `products` or top-level list.
    items = data.get("products") if isinstance(data, dict) else data
    assert items and len(items) >= 2, "need at least 2 products with stock for tests"
    # prefer high-stock products so we don't archive anything
    items = sorted(items, key=lambda p: -(p.get("stock") or 0))
    return items[:3]


@pytest.fixture(scope="module")
def jwt_token(client, products):
    """Create a verified customer via order → register → verify, return Bearer token."""
    email = f"qa+cartjwt_{uuid.uuid4().hex[:8]}@example.com"
    # 1) place order so registration is allowed
    p = products[0]
    r = client.post(f"{API}/orders", json={
        "product_id": p["id"],
        "quantity": 1,
        "customer_name": "QA Cart Tester",
        "customer_email": email,
        "status": "paid",
    })
    assert r.status_code == 200, r.text
    order_id = r.json()["id"]
    # 2) register
    r = client.post(f"{API}/portal/register", json={
        "email": email, "password": "TestPass123!", "name": "QA Cart Tester",
    })
    assert r.status_code == 200, r.text
    j = r.json()
    link = j.get("activation_link")
    if not link:
        pytest.skip(f"no activation_link returned; email may have been sent. resp={j}")
    m = re.search(r"token=([^&]+)", link)
    assert m, f"could not extract token from {link}"
    token_raw = m.group(1)
    # 3) verify → jwt
    r = client.post(f"{API}/portal/verify", json={"token": token_raw})
    assert r.status_code == 200, r.text
    tok = r.json()["token"]
    yield tok
    # cleanup: delete created order
    try:
        client.delete(f"{API}/orders/{order_id}")
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Cart tests
# ---------------------------------------------------------------------------


class TestGuestCart:
    def test_patch_guest_cart_variant_pricing(self, client, products):
        sess = f"qa_sess_{uuid.uuid4().hex[:10]}"
        p1, p2 = products[0], products[1]
        body = {
            "session_id": sess,
            "items": [
                {"product_id": p1["id"], "quantity": 2, "variant_type": "Size",
                 "variant_option": "Large", "variant_price": 99.99},
                {"product_id": p2["id"], "quantity": 1, "variant_type": "Color",
                 "variant_option": "Red", "variant_price": 12.50},
            ],
        }
        r = client.patch(f"{API}/cart", json=body)
        assert r.status_code == 200, r.text
        d = r.json()
        assert len(d["items"]) == 2
        l1 = d["items"][0]; l2 = d["items"][1]
        assert l1["unit_price"] == 99.99
        assert l1["line_total"] == round(99.99 * 2, 2)
        assert l1["variant_type"] == "Size" and l1["variant_option"] == "Large"
        assert l1["variant_price"] == 99.99
        assert l2["unit_price"] == 12.50
        assert l2["line_total"] == 12.50
        expected_subtotal = round(99.99 * 2 + 12.50, 2)
        assert d["subtotal"] == expected_subtotal

        # GET returns the cart just saved
        r2 = client.get(f"{API}/cart", params={"session_id": sess})
        assert r2.status_code == 200
        d2 = r2.json()
        assert d2["subtotal"] == expected_subtotal
        assert len(d2["items"]) == 2

        # REPLACE cart with a new single-item payload
        body2 = {
            "session_id": sess,
            "items": [
                {"product_id": p1["id"], "quantity": 1, "variant_type": "Size",
                 "variant_option": "Small", "variant_price": 50.00},
            ],
        }
        r3 = client.patch(f"{API}/cart", json=body2)
        assert r3.status_code == 200
        d3 = r3.json()
        assert len(d3["items"]) == 1, f"cart should be replaced, got {d3}"
        assert d3["subtotal"] == 50.00

        # cleanup: empty the cart
        client.patch(f"{API}/cart", json={"session_id": sess, "items": []})

    def test_patch_cart_no_identity_400(self, client, products):
        p1 = products[0]
        r = client.patch(f"{API}/cart", json={
            "items": [{"product_id": p1["id"], "quantity": 1}]
        })
        assert r.status_code == 400, r.text


class TestJwtCart:
    def test_jwt_cart_is_independent_from_guest(self, client, products, jwt_token):
        sess = f"qa_sess_{uuid.uuid4().hex[:10]}"
        p1, p2 = products[0], products[1]

        # 1) guest cart with p1
        r = client.patch(f"{API}/cart", json={
            "session_id": sess,
            "items": [{"product_id": p1["id"], "quantity": 1,
                       "variant_type": "Size", "variant_option": "S",
                       "variant_price": 10.00}],
        })
        assert r.status_code == 200
        assert r.json()["subtotal"] == 10.00

        # 2) JWT cart with p2 — no session_id
        auth = {"Authorization": f"Bearer {jwt_token}"}
        r2 = client.patch(f"{API}/cart", json={
            "items": [{"product_id": p2["id"], "quantity": 3,
                       "variant_type": "Color", "variant_option": "Blue",
                       "variant_price": 5.00}],
        }, headers=auth)
        assert r2.status_code == 200, r2.text
        d = r2.json()
        assert d["subtotal"] == 15.00
        assert d["key"].startswith("cust:")

        # 3) GET JWT cart returns same
        r3 = client.get(f"{API}/cart", headers=auth)
        assert r3.status_code == 200
        assert r3.json()["subtotal"] == 15.00

        # 4) Guest cart still has p1 only — independent
        r4 = client.get(f"{API}/cart", params={"session_id": sess})
        assert r4.status_code == 200
        d4 = r4.json()
        assert d4["subtotal"] == 10.00
        assert len(d4["items"]) == 1
        assert d4["items"][0]["product_id"] == p1["id"]

        # cleanup
        client.patch(f"{API}/cart", json={"session_id": sess, "items": []})
        client.patch(f"{API}/cart", json={"items": []}, headers=auth)


# ---------------------------------------------------------------------------
# Orders tests
# ---------------------------------------------------------------------------


class TestOrderVariants:
    def test_single_product_variant_overrides_base_price(self, client, products):
        p = products[0]
        variant_price = 77.77
        r = client.post(f"{API}/orders", json={
            "product_id": p["id"],
            "quantity": 1,
            "variant_type": "Size",
            "variant_option": "XL",
            "variant_price": variant_price,
            "customer_name": "QA Variant",
            "customer_email": f"qa+v_{uuid.uuid4().hex[:6]}@example.com",
            "status": "paid",
        })
        assert r.status_code == 200, r.text
        o = r.json()
        assert o["total"] == variant_price
        assert o["unit_price"] == variant_price
        assert o["variant_type"] == "Size"
        assert o["variant_option"] == "XL"
        assert o["variant_price"] == variant_price
        assert len(o["items"]) == 1
        li = o["items"][0]
        assert li["unit_price"] == variant_price
        assert li["line_total"] == variant_price
        assert li["variant_type"] == "Size"
        assert li["variant_option"] == "XL"
        assert li["variant_price"] == variant_price
        # cleanup
        client.delete(f"{API}/orders/{o['id']}")

    def test_multi_line_order(self, client, products):
        p1, p2, p3 = products[0], products[1], products[2] if len(products) > 2 else products[0]
        payload = {
            "items": [
                {"product_id": p1["id"], "quantity": 2, "variant_type": "Size",
                 "variant_option": "M", "variant_price": 20.00},
                {"product_id": p2["id"], "quantity": 1, "variant_type": "Color",
                 "variant_option": "Red", "variant_price": 15.50},
                {"product_id": p3["id"], "quantity": 1},  # no variant
            ],
            "customer_name": "QA Multi",
            "customer_email": f"qa+m_{uuid.uuid4().hex[:6]}@example.com",
            "status": "paid",
        }
        r = client.post(f"{API}/orders", json=payload)
        assert r.status_code == 200, r.text
        o = r.json()
        assert len(o["items"]) == 3
        # third line: no variant → uses base price
        base_p3 = float(p3.get("price") or 0)
        expected_total = round(20.00 * 2 + 15.50 + base_p3, 2)
        assert o["total"] == expected_total
        assert o["quantity"] == 4
        # top-level variant fields null for multi-line
        assert o["variant_type"] is None
        assert o["variant_option"] is None
        assert o["variant_price"] is None
        # per-line variant fields
        assert o["items"][0]["variant_price"] == 20.00
        assert o["items"][0]["line_total"] == 40.00
        assert o["items"][1]["variant_price"] == 15.50
        assert o["items"][1]["line_total"] == 15.50
        assert o["items"][2]["variant_price"] is None
        assert o["items"][2]["unit_price"] == round(base_p3, 2)
        client.delete(f"{API}/orders/{o['id']}")

    def test_order_neither_product_id_nor_items_returns_400(self, client):
        r = client.post(f"{API}/orders", json={
            "customer_name": "QA Empty", "status": "paid",
        })
        assert r.status_code == 400, r.text

    def test_order_unknown_product_id_returns_404(self, client):
        r = client.post(f"{API}/orders", json={
            "product_id": f"nonexistent-{uuid.uuid4().hex}",
            "quantity": 1,
            "customer_name": "QA 404",
            "status": "paid",
        })
        assert r.status_code == 404, r.text
