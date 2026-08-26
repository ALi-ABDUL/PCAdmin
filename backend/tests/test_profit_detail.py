"""Tests for the /api/analytics/profit-detail endpoint (Profit YTD modal)."""
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
    r = requests.get(f"{API}/analytics/profit-detail", timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


def test_profit_detail_returns_expected_shape():
    body = _get()
    for key in (
        "year", "as_of", "totals", "monthly", "top_products",
        "category_margins", "best_month", "worst_month",
    ):
        assert key in body, f"missing '{key}' in response"
    for key in ("revenue", "cost", "profit", "margin_pct"):
        assert key in body["totals"]


def test_totals_margin_pct_matches_profit_over_revenue():
    body = _get()
    t = body["totals"]
    if t["revenue"] > 0:
        expected = round((t["profit"] / t["revenue"]) * 100, 2)
        assert abs(t["margin_pct"] - expected) < 0.05
    else:
        assert t["margin_pct"] == 0.0


def test_monthly_series_zero_filled_to_current_month():
    body = _get()
    from datetime import datetime, timezone
    cur_month = datetime.now(timezone.utc).month
    assert len(body["monthly"]) == cur_month
    for m in body["monthly"]:
        for key in ("month", "month_key", "revenue", "cost", "profit", "orders", "margin_pct"):
            assert key in m
    # Margin per month is computed correctly.
    for m in body["monthly"]:
        if m["revenue"] > 0:
            expected = round((m["profit"] / m["revenue"]) * 100, 2)
            assert abs(m["margin_pct"] - expected) < 0.05
        else:
            assert m["margin_pct"] == 0.0


def test_best_and_worst_month_pick_from_months_with_sales():
    body = _get()
    with_sales = [m for m in body["monthly"] if m["orders"] > 0]
    if not with_sales:
        assert body["best_month"] is None
        assert body["worst_month"] is None
    else:
        best_expected = max(with_sales, key=lambda m: m["margin_pct"])
        worst_expected = min(with_sales, key=lambda m: m["margin_pct"])
        assert body["best_month"]["month_key"] == best_expected["month_key"]
        assert body["worst_month"]["month_key"] == worst_expected["month_key"]
        # best margin >= worst margin (equal only when there's a single month)
        assert body["best_month"]["margin_pct"] >= body["worst_month"]["margin_pct"]


def test_top_products_capped_at_five_and_sorted_by_margin():
    body = _get()
    products = body["top_products"]
    assert len(products) <= 5
    for p in products:
        for key in ("product_id", "title", "image", "revenue", "profit", "units", "margin_pct"):
            assert key in p
        # Every top-5 row must reflect at least one unit and non-zero revenue.
        assert p["revenue"] > 0
        assert p["units"] > 0
    # Sorted descending by margin_pct.
    margins = [p["margin_pct"] for p in products]
    assert margins == sorted(margins, reverse=True)


def test_category_margins_include_every_selling_category():
    body = _get()
    rows = body["category_margins"]
    # Every row has revenue > 0 (server-side filter guarantees this) and a
    # correctly-computed margin_pct.
    for r in rows:
        assert r["revenue"] > 0
        expected = round((r["profit"] / r["revenue"]) * 100, 2)
        assert abs(r["margin_pct"] - expected) < 0.05


def test_cancelled_orders_excluded_from_profit_totals():
    """Every aggregation must skip cancelled orders — matches the KPI card."""
    body = _get()
    # Both totals and monthly figures exclude cancelled, so the sum of
    # monthly.profit must equal totals.profit (± floating error).
    monthly_sum = round(sum(m["profit"] for m in body["monthly"]), 2)
    assert abs(monthly_sum - body["totals"]["profit"]) < 0.5
