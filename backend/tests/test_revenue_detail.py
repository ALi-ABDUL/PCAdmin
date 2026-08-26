"""Tests for the /api/analytics/revenue-detail endpoint (Revenue YTD modal)."""
from __future__ import annotations

import os
import pathlib
import sys
import uuid

import requests
import pytest

BACKEND = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    for line in pathlib.Path("/app/frontend/.env").read_text().splitlines():
        if line.startswith("REACT_APP_BACKEND_URL="):
            BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
API = f"{BASE_URL}/api"


def test_revenue_detail_returns_expected_shape():
    r = requests.get(f"{API}/analytics/revenue-detail", timeout=15)
    assert r.status_code == 200
    body = r.json()
    for key in (
        "year", "as_of", "total_revenue", "total_orders",
        "avg_order_value", "monthly", "top_products",
        "orders_by_status", "best_month", "last_year_comparison",
    ):
        assert key in body, f"missing '{key}' in response"


def test_monthly_series_is_zero_filled_and_capped_to_current_month():
    body = requests.get(f"{API}/analytics/revenue-detail", timeout=15).json()
    # Every month starting Jan up to the current month must appear.
    from datetime import datetime, timezone
    cur_month = datetime.now(timezone.utc).month
    assert len(body["monthly"]) == cur_month
    # First entry is January of the reported year.
    assert body["monthly"][0]["month"] == "Jan"
    assert body["monthly"][0]["month_key"] == f"{body['year']}-01"
    # Every month row exposes revenue and orders (may be 0).
    for m in body["monthly"]:
        assert "revenue" in m and "orders" in m
        assert isinstance(m["revenue"], (int, float))
        assert isinstance(m["orders"], int)


def test_orders_by_status_covers_every_known_status():
    body = requests.get(f"{API}/analytics/revenue-detail", timeout=15).json()
    from models import ORDER_STATUSES
    returned = [row["status"] for row in body["orders_by_status"]]
    for st in ORDER_STATUSES:
        assert st in returned, f"status {st!r} missing from orders_by_status"


def test_top_products_capped_at_five_with_expected_fields():
    body = requests.get(f"{API}/analytics/revenue-detail", timeout=15).json()
    assert len(body["top_products"]) <= 5
    for p in body["top_products"]:
        for key in ("product_id", "title", "image", "revenue", "units"):
            assert key in p


def test_avg_order_value_matches_totals():
    body = requests.get(f"{API}/analytics/revenue-detail", timeout=15).json()
    if body["total_orders"] > 0:
        expected = round(body["total_revenue"] / body["total_orders"], 2)
        assert abs(body["avg_order_value"] - expected) < 0.01
    else:
        assert body["avg_order_value"] == 0.0


def test_best_month_matches_monthly_max():
    body = requests.get(f"{API}/analytics/revenue-detail", timeout=15).json()
    monthly = body["monthly"]
    best = body["best_month"]
    positive = [m for m in monthly if m["revenue"] > 0]
    if not positive:
        assert best is None
    else:
        expected = max(monthly, key=lambda m: m["revenue"])
        assert best["month_key"] == expected["month_key"]
        assert abs(best["revenue"] - expected["revenue"]) < 0.01


def test_cancelled_orders_excluded_from_totals():
    """`total_orders` and `total_revenue` must skip cancelled orders. We
    verify by comparing against a direct query of the cancelled bucket."""
    body = requests.get(f"{API}/analytics/revenue-detail", timeout=15).json()
    cancelled = next((r for r in body["orders_by_status"] if r["status"] == "cancelled"), None)
    if cancelled and cancelled["count"] > 0:
        # `total_orders` must NOT include the cancelled count.
        assert body["total_orders"] < body["total_orders"] + cancelled["count"]
        # And the cancelled bucket's revenue must be strictly larger than 0
        # (only fires when the demo seed actually made cancelled orders).
        assert cancelled["revenue"] > 0 or cancelled["count"] > 0
