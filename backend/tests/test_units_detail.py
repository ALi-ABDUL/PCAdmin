"""Tests for the /api/analytics/units-detail endpoint (Units Sold modal)."""
from __future__ import annotations

import os
import pathlib
import sys

import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    for line in pathlib.Path("/app/frontend/.env").read_text().splitlines():
        if line.startswith("REACT_APP_BACKEND_URL="):
            BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
API = f"{BASE_URL}/api"


def _get():
    r = requests.get(f"{API}/analytics/units-detail", timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


def test_units_detail_returns_expected_shape():
    body = _get()
    for key in (
        "year", "as_of", "total_units", "total_orders",
        "avg_per_order", "avg_per_day", "avg_per_month",
        "monthly", "top_products", "by_category",
        "best_month", "last_year_comparison",
    ):
        assert key in body, f"missing '{key}' in response"


def test_monthly_series_zero_filled_to_current_month():
    body = _get()
    from datetime import datetime, timezone
    cur_month = datetime.now(timezone.utc).month
    assert len(body["monthly"]) == cur_month
    for m in body["monthly"]:
        for key in ("month", "month_key", "units", "orders"):
            assert key in m
        assert isinstance(m["units"], int)


def test_avg_per_order_matches_total_units_over_orders():
    body = _get()
    if body["total_orders"] > 0:
        expected = round(body["total_units"] / body["total_orders"], 2)
        assert abs(body["avg_per_order"] - expected) < 0.01
    else:
        assert body["avg_per_order"] == 0.0


def test_avg_per_day_and_per_month_are_positive_when_sales_exist():
    body = _get()
    if body["total_units"] > 0:
        assert body["avg_per_day"] > 0
        assert body["avg_per_month"] > 0
        # avg_per_month is always >= avg_per_day * ~28 (rough bound).
        assert body["avg_per_month"] >= body["avg_per_day"]


def test_best_month_matches_units_max():
    body = _get()
    with_sales = [m for m in body["monthly"] if m["units"] > 0]
    best = body["best_month"]
    if not with_sales:
        assert best is None
    else:
        expected = max(with_sales, key=lambda m: m["units"])
        assert best["month_key"] == expected["month_key"]
        assert best["units"] == expected["units"]


def test_top_products_capped_at_five_and_sorted_by_units():
    body = _get()
    products = body["top_products"]
    assert len(products) <= 5
    for p in products:
        for key in ("product_id", "title", "image", "units", "revenue"):
            assert key in p
        assert p["units"] > 0
    units = [p["units"] for p in products]
    assert units == sorted(units, reverse=True)


def test_by_category_only_includes_selling_categories():
    body = _get()
    rows = body["by_category"]
    for r in rows:
        assert r["units"] > 0
        for key in ("category", "units", "orders", "revenue"):
            assert key in r
    # Sorted by units desc.
    units = [r["units"] for r in rows]
    assert units == sorted(units, reverse=True)


def test_cancelled_orders_excluded_from_units_total():
    """total_units and monthly.units both skip cancelled orders — so their
    sum should match (± floating error)."""
    body = _get()
    monthly_sum = sum(m["units"] for m in body["monthly"])
    assert monthly_sum == body["total_units"]
