"""Tests that a product is auto-moved to Archived the moment its stock
drops to (or below) zero — regardless of whether it happened via an order,
a manual PATCH, or a stock adjustment.
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


def _create(stock: int) -> str:
    r = requests.post(f"{API}/products", json={
        "title": f"AutoArch-{uuid.uuid4().hex[:6]}",
        "price": 50.0, "cost": 25.0, "stock": stock,
        "category": "other", "active": True,
    }, timeout=15)
    r.raise_for_status()
    return r.json()["id"]


def _fetch(pid: str) -> dict:
    # /products list doesn't return archived by default; use raw fetch.
    r = requests.get(f"{API}/products/{pid}", timeout=15)
    r.raise_for_status()
    return r.json()


def _cleanup(pid: str):
    requests.delete(f"{API}/products/{pid}", timeout=15)


class TestAutoArchiveOnZeroStock:
    def test_order_pushing_stock_to_zero_archives(self):
        pid = _create(stock=2)
        try:
            r = requests.post(f"{API}/orders", json={
                "product_id": pid, "quantity": 2,
                "customer_name": "AA", "customer_email": "aa@t.com", "status": "new",
            }, timeout=15)
            r.raise_for_status()
            p = _fetch(pid)
            assert p["stock"] == 0
            assert p["archived"] is True
            assert p["active"] is False
        finally:
            _cleanup(pid)

    def test_patch_setting_stock_zero_archives(self):
        pid = _create(stock=5)
        try:
            r = requests.patch(f"{API}/products/{pid}", json={"stock": 0}, timeout=15)
            r.raise_for_status()
            p = _fetch(pid)
            assert p["stock"] == 0
            assert p["archived"] is True
            assert p["active"] is False
        finally:
            _cleanup(pid)

    def test_stock_adjust_pushing_to_zero_archives(self):
        pid = _create(stock=3)
        try:
            r = requests.post(f"{API}/stock/moves", json={
                "product_id": pid, "delta": -3, "reason": "test",
            }, timeout=15)
            r.raise_for_status()
            p = _fetch(pid)
            assert p["stock"] == 0
            assert p["archived"] is True
        finally:
            _cleanup(pid)

    def test_partial_stock_decrement_does_not_archive(self):
        pid = _create(stock=10)
        try:
            requests.post(f"{API}/orders", json={
                "product_id": pid, "quantity": 3,
                "customer_name": "AA", "customer_email": "aa@t.com", "status": "new",
            }, timeout=15).raise_for_status()
            p = _fetch(pid)
            assert p["stock"] == 7
            assert p.get("archived") is not True
        finally:
            _cleanup(pid)

    def test_products_list_excludes_auto_archived(self):
        pid = _create(stock=1)
        title = _fetch(pid)["title"]
        try:
            requests.post(f"{API}/orders", json={
                "product_id": pid, "quantity": 1,
                "customer_name": "AA", "customer_email": "aa@t.com", "status": "new",
            }, timeout=15).raise_for_status()
            # Active list should NOT show it.
            r = requests.get(f"{API}/products", params={"q": title, "limit": 5}, timeout=15).json()
            assert r["total"] == 0
            # Archived list SHOULD show it.
            r = requests.get(f"{API}/products", params={"q": title, "archived": "true", "limit": 5}, timeout=15).json()
            assert r["total"] == 1
        finally:
            _cleanup(pid)
