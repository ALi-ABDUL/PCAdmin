"""Tests for customer first_name/last_name schema + portal mirror + email greetings."""
import os
import time
import uuid
import requests
import pytest

def _load_frontend_env():
    p = "/app/frontend/.env"
    if os.path.exists(p):
        for line in open(p):
            if line.startswith("REACT_APP_BACKEND_URL="):
                return line.split("=", 1)[1].strip()
    return None

BASE_URL = (os.environ.get('REACT_APP_BACKEND_URL') or _load_frontend_env()).rstrip('/')
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{API}/admin-accounts/login",
                      json={"email": "qa@prettycheap.com.au", "password": "QaTest123!"})
    if r.status_code != 200:
        pytest.skip(f"admin login failed: {r.status_code} {r.text}")
    return r.json().get("token") or r.json().get("access_token") or ""


@pytest.fixture(scope="module")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"} if admin_token else {}


@pytest.fixture(scope="module")
def product_id():
    r = requests.get(f"{API}/products")
    assert r.status_code == 200, r.text
    items = r.json()
    if isinstance(items, dict):
        items = items.get("items") or items.get("products") or []
    if not items:
        pytest.skip("No products available for order flow")
    return items[0].get("id") or items[0].get("_id") or items[0].get("product_id")


created_customer_ids = []


# ------------ Customers CRUD: first/last <-> name coherence ------------

def test_create_customer_with_first_last_composes_name(admin_headers):
    email = f"TEST_fl_{uuid.uuid4().hex[:8]}@example.com"
    payload = {"first_name": "Alice", "last_name": "Wonder", "name": "", "email": email}
    r = requests.post(f"{API}/customers", json=payload, headers=admin_headers)
    assert r.status_code in (200, 201), r.text
    body = r.json()
    cid = body.get("id") or body.get("_id")
    assert cid, body
    created_customer_ids.append(cid)
    assert body.get("first_name") == "Alice"
    assert body.get("last_name") == "Wonder"
    assert (body.get("name") or "").strip() == "Alice Wonder"


def test_create_customer_with_only_name_splits(admin_headers):
    email = f"TEST_fl_{uuid.uuid4().hex[:8]}@example.com"
    payload = {"name": "Grace Hopper", "email": email}
    r = requests.post(f"{API}/customers", json=payload, headers=admin_headers)
    assert r.status_code in (200, 201), r.text
    body = r.json()
    cid = body.get("id") or body.get("_id")
    created_customer_ids.append(cid)
    assert body.get("first_name") == "Grace"
    assert body.get("last_name") == "Hopper"


def test_patch_customer_name_resyncs_first_last(admin_headers):
    email = f"TEST_fl_{uuid.uuid4().hex[:8]}@example.com"
    r = requests.post(f"{API}/customers",
                      json={"name": "Original Person", "email": email},
                      headers=admin_headers)
    assert r.status_code in (200, 201), r.text
    cid = r.json().get("id") or r.json().get("_id")
    created_customer_ids.append(cid)

    r2 = requests.patch(f"{API}/customers/{cid}",
                        json={"name": "Ada Byron King"}, headers=admin_headers)
    assert r2.status_code == 200, r2.text
    b = r2.json()
    assert b.get("first_name") == "Ada"
    assert b.get("last_name") == "Byron King"

    r3 = requests.patch(f"{API}/customers/{cid}",
                        json={"first_name": "Marie", "last_name": "Curie"},
                        headers=admin_headers)
    assert r3.status_code == 200, r3.text
    b3 = r3.json()
    assert b3.get("first_name") == "Marie"
    assert b3.get("last_name") == "Curie"
    assert (b3.get("name") or "").strip() == "Marie Curie"


# ------------ Full portal flow: register -> verify -> login -> me PATCH ------------

def test_portal_flow_first_last_mirrors_to_customer(admin_headers, product_id):
    unique = uuid.uuid4().hex[:8]
    email = f"TEST_portal_{unique}@example.com"
    password = "Portal12345!"

    # Step 1: create an order for this email so the account gate is satisfied.
    order_payload = {
        "product_id": product_id,
        "quantity": 1,
        "customer_name": "Temp Buyer",
        "customer_email": email,
    }
    order_res = requests.post(f"{API}/orders", json=order_payload, headers=admin_headers)
    assert order_res.status_code in (200, 201), f"order creation failed: {order_res.status_code} {order_res.text}"

    # Step 2: portal register (Note: PortalRegisterBody only supports `name`,
    # so pass a combined name; server will split it into first/last.)
    reg = requests.post(f"{API}/portal/register",
                        json={"email": email, "password": password,
                              "name": "Ivy Green"})
    assert reg.status_code in (200, 201), reg.text
    reg_body = reg.json()

    # If activation required, use activation_link
    token = reg_body.get("token")
    if not token:
        act_link = reg_body.get("activation_link") or reg_body.get("verification_link")
        assert act_link, f"no token and no activation link: {reg_body}"
        # Extract token param
        import urllib.parse as up
        qs = up.urlparse(act_link).query
        params = dict(up.parse_qsl(qs))
        vtoken = params.get("token") or params.get("t")
        assert vtoken, f"cannot parse verification token from {act_link}"
        v = requests.post(f"{API}/portal/verify", json={"token": vtoken})
        assert v.status_code == 200, v.text
        # login
        li = requests.post(f"{API}/portal/login", json={"email": email, "password": password})
        assert li.status_code == 200, li.text
        token = li.json().get("token")

    assert token, "no portal token obtained"
    h = {"Authorization": f"Bearer {token}"}

    # Step 3: GET /portal/me
    me = requests.get(f"{API}/portal/me", headers=h)
    assert me.status_code == 200, me.text
    me_body = me.json()
    cust = me_body.get("customer") or me_body
    assert cust.get("first_name") == "Ivy"
    assert cust.get("last_name") == "Green"

    # Step 4: PATCH /portal/me with new first/last
    p = requests.patch(f"{API}/portal/me",
                       json={"first_name": "Iris", "last_name": "Bloom"}, headers=h)
    assert p.status_code == 200, p.text
    pb = p.json()
    pc = pb.get("customer") or pb
    assert pc.get("first_name") == "Iris"
    assert pc.get("last_name") == "Bloom"
    assert (pc.get("name") or "").strip() == "Iris Bloom"

    # Step 5: verify mirrored to customers collection (admin GET)
    time.sleep(0.5)
    lst = requests.get(f"{API}/customers", headers=admin_headers)
    assert lst.status_code == 200, lst.text
    rows = lst.json()
    if isinstance(rows, dict):
        rows = rows.get("items") or rows.get("customers") or []
    match = [r for r in rows if (r.get("email") or "").lower() == email.lower()]
    assert match, f"customer row for {email} not found"
    row = match[0]
    assert row.get("first_name") == "Iris"
    assert row.get("last_name") == "Bloom"
    if row.get("id") or row.get("_id"):
        created_customer_ids.append(row.get("id") or row.get("_id"))

    # Step 6: PATCH /portal/me with only name splits
    p2 = requests.patch(f"{API}/portal/me",
                        json={"name": "Some Full Name"}, headers=h)
    assert p2.status_code == 200, p2.text
    p2c = (p2.json().get("customer") or p2.json())
    assert p2c.get("first_name") == "Some"
    assert p2c.get("last_name") == "Full Name"


# ------------ Email greeting code path ------------

def test_greeting_first_name_helper():
    import sys
    sys.path.insert(0, "/app/backend")
    from helpers import _greeting_first_name, _split_name  # type: ignore
    assert _greeting_first_name({"first_name": "Bob", "customer_name": "Ignored"}) == "Bob"
    assert _greeting_first_name({"customer_name": "Jane Doe"}) == "Jane"
    assert _greeting_first_name({"customer_name": ""}) == "there"
    assert _split_name("Ada Byron King") == ("Ada", "Byron King")


# ------------ Cleanup ------------

def test_zz_cleanup(admin_headers):
    for cid in set(created_customer_ids):
        try:
            requests.delete(f"{API}/customers/{cid}?permanent=true", headers=admin_headers)
            requests.delete(f"{API}/customers/{cid}", headers=admin_headers)
        except Exception:
            pass
