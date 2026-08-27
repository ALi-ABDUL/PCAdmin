"""Tests for the /api/analytics/aov-detail endpoint (AOV modal)."""
from __future__ import annotations

import os
import pathlib

import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    for line in pathlib.Path("/app/frontend/.env").read_text().splitlines():
        if line.startswith("REACT_APP_BACKEND_URL="):
            BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
API = f"{BASE_URL}/api"


def _get():
    r = requests.get(f"{API}/analytics/aov-detail", timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


def test_aov_detail_returns_expected_shape():
    body = _get()
    for key in (
        "year", "as_of", "total_revenue", "total_orders",
        "avg_order_value", "monthly", "distribution",
        "top_orders", "by_category", "best_month", "worst_month",
    ):
        assert key in body, f"missing '{key}' in response"


def test_avg_order_value_matches_totals():
    body = _get()
    if body["total_orders"] > 0:
        expected = round(body["total_revenue"] / body["total_orders"], 2)
        assert abs(body["avg_order_value"] - expected) < 0.01
    else:
        assert body["avg_order_value"] == 0.0


def test_monthly_series_zero_filled_and_aov_correct():
    body = _get()
    from datetime import datetime, timezone
    cur_month = datetime.now(timezone.utc).month
    assert len(body["monthly"]) == cur_month
    for m in body["monthly"]:
        for key in ("month", "month_key", "revenue", "orders", "aov"):
            assert key in m
        if m["orders"] > 0:
            expected = round(m["revenue"] / m["orders"], 2)
            assert abs(m["aov"] - expected) < 0.05
        else:
            assert m["aov"] == 0.0


def test_best_and_worst_month_pick_from_months_with_orders():
    body = _get()
    with_sales = [m for m in body["monthly"] if m["orders"] > 0]
    if not with_sales:
        assert body["best_month"] is None
        assert body["worst_month"] is None
    else:
        best_expected = max(with_sales, key=lambda m: m["aov"])
        worst_expected = min(with_sales, key=lambda m: m["aov"])
        assert body["best_month"]["month_key"] == best_expected["month_key"]
        assert body["worst_month"]["month_key"] == worst_expected["month_key"]
        assert body["best_month"]["aov"] >= body["worst_month"]["aov"]


def test_distribution_has_all_five_buckets_in_order():
    body = _get()
    labels = [row["label"] for row in body["distribution"]]
    assert labels == ["$0 – $50", "$50 – $100", "$100 – $250", "$250 – $500", "$500+"]
    for row in body["distribution"]:
        assert "min" in row and "max" in row and "count" in row and "revenue" in row
        assert row["count"] >= 0


def test_distribution_counts_sum_to_total_orders():
    """Every non-cancelled order falls in exactly one bucket (open-ended
    $500+ absorbs the right tail), so the sum should equal total_orders."""
    body = _get()
    dist_sum = sum(row["count"] for row in body["distribution"])
    assert dist_sum == body["total_orders"]


def test_top_orders_capped_at_five_and_sorted_desc():
    body = _get()
    orders = body["top_orders"]
    assert len(orders) <= 5
    totals = [o["total"] for o in orders]
    assert totals == sorted(totals, reverse=True)
    for o in orders:
        for key in ("id", "product_title", "customer_name", "total", "created_at"):
            assert key in o


def test_by_category_has_positive_orders_and_correct_aov():
    body = _get()
    for r in body["by_category"]:
        assert r["orders"] > 0
        expected = round(r["revenue"] / r["orders"], 2)
        assert abs(r["aov"] - expected) < 0.05
    aovs = [r["aov"] for r in body["by_category"]]
    assert aovs == sorted(aovs, reverse=True)
