"""Backend tests for the Customer Portal: JWT auth, verified-purchase reviews,
helpful/not-helpful voting, and public product reviews endpoint.
"""
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


def _new_email():
    return f"portal-test-{uuid.uuid4().hex[:10]}@example.com"


def _pick_existing_purchaser():
    """Return (email, product_id, product_title) from an existing paid-ish order."""
    r = requests.get(f"{API}/orders", timeout=30)
    orders = r.json()
    orders = orders.get("orders", orders) if isinstance(orders, dict) else orders
    for o in orders:
        if o.get("customer_email") and o.get("product_id") and o.get("status") in ("paid", "processing", "shipped", "delivered", "completed"):
            return o["customer_email"], o["product_id"], o.get("product_title", "")
    raise RuntimeError("no eligible order in DB")


class TestPortalRegister:
    def test_register_requires_prior_order(self):
        r = requests.post(f"{API}/portal/register",
            json={"email": _new_email(), "password": "secret123"}, timeout=15)
        assert r.status_code == 403
        assert "orders" in r.json()["detail"].lower()

    def test_register_rejects_short_password(self):
        r = requests.post(f"{API}/portal/register",
            json={"email": _new_email(), "password": "short"}, timeout=15)
        assert r.status_code == 400

    def test_register_returns_token(self):
        email, _, _ = _pick_existing_purchaser()
        # ensure account doesn't already exist — if it does, we expect 409
        r = requests.post(f"{API}/portal/register",
            json={"email": email, "password": "secret123"}, timeout=15)
        assert r.status_code in (200, 201, 409)
        if r.status_code < 400:
            body = r.json()
            assert body.get("token")
            assert body["customer"]["email"] == email.lower()


class TestPortalLogin:
    def test_login_bad_credentials(self):
        r = requests.post(f"{API}/portal/login",
            json={"email": "does-not-exist@example.com", "password": "whatever"}, timeout=15)
        assert r.status_code == 401

    def test_login_success(self):
        email, _, _ = _pick_existing_purchaser()
        requests.post(f"{API}/portal/register",
            json={"email": email, "password": "secret123"}, timeout=15)  # idempotent-ish
        r = requests.post(f"{API}/portal/login",
            json={"email": email, "password": "secret123"}, timeout=15)
        assert r.status_code == 200
        assert r.json().get("token")

    def test_me_requires_auth(self):
        r = requests.get(f"{API}/portal/me", timeout=15)
        assert r.status_code == 401


class TestPortalReviewFlow:
    @classmethod
    def _auth_headers(cls):
        email, product_id, title = _pick_existing_purchaser()
        requests.post(f"{API}/portal/register",
            json={"email": email, "password": "secret123"}, timeout=15)
        r = requests.post(f"{API}/portal/login",
            json={"email": email, "password": "secret123"}, timeout=15)
        return {"Authorization": f"Bearer {r.json()['token']}"}, email, product_id, title

    def test_orders_include_review_flags(self):
        headers, _, product_id, _ = self._auth_headers()
        r = requests.get(f"{API}/portal/orders", headers=headers, timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert data["total"] > 0
        for o in data["orders"]:
            assert "can_review" in o and "already_reviewed" in o

    def test_review_unpurchased_product_rejected(self):
        headers, _, _, _ = self._auth_headers()
        r = requests.post(f"{API}/portal/reviews",
            headers=headers,
            json={"product_id": "does-not-exist-xyz", "rating": 4, "body": "nope"}, timeout=15)
        assert r.status_code == 403

    def test_rating_range_enforced(self):
        headers, _, product_id, _ = self._auth_headers()
        r = requests.post(f"{API}/portal/reviews",
            headers=headers,
            json={"product_id": product_id, "rating": 7, "body": "too high"}, timeout=15)
        assert r.status_code == 400

    def test_public_reviews_endpoint_returns_aggregate(self):
        _, product_id, _ = _pick_existing_purchaser()
        r = requests.get(f"{API}/products/{product_id}/reviews", timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert "reviews" in d and "total" in d
        assert "average_rating" in d
        assert "rating_distribution" in d
        assert set(d["rating_distribution"].keys()) == {"1","2","3","4","5"}
        # If reviews exist, average must be within 1-5
        if d["total"] > 0:
            assert 1.0 <= d["average_rating"] <= 5.0
            for r_obj in d["reviews"]:
                assert "helpful_count" in r_obj and "not_helpful_count" in r_obj


class TestReviewVoting:
    def test_vote_requires_auth(self):
        r = requests.post(f"{API}/reviews/nonexistent/vote", json={"vote": "helpful"}, timeout=15)
        assert r.status_code == 401

    def test_vote_missing_review_404(self):
        # need auth first
        email, _, _ = _pick_existing_purchaser()
        requests.post(f"{API}/portal/register",
            json={"email": email, "password": "secret123"}, timeout=15)
        tok = requests.post(f"{API}/portal/login",
            json={"email": email, "password": "secret123"}, timeout=15).json()["token"]
        r = requests.post(f"{API}/reviews/does-not-exist/vote",
            headers={"Authorization": f"Bearer {tok}"},
            json={"vote": "helpful"}, timeout=15)
        assert r.status_code == 404

    def test_vote_bad_value_400(self):
        # produce or reuse any review
        r_all = requests.get(f"{API}/reviews", timeout=15).json()["reviews"]
        if not r_all:
            pytest.skip("no reviews yet to vote on")
        rid = r_all[0]["id"]
        email, _, _ = _pick_existing_purchaser()
        requests.post(f"{API}/portal/register", json={"email": email, "password": "secret123"}, timeout=15)
        tok = requests.post(f"{API}/portal/login", json={"email": email, "password": "secret123"}, timeout=15).json()["token"]
        r = requests.post(f"{API}/reviews/{rid}/vote",
            headers={"Authorization": f"Bearer {tok}"},
            json={"vote": "maybe"}, timeout=15)
        # Either 400 (bad vote value) OR 400 (self-vote if same email as review author)
        assert r.status_code == 400
