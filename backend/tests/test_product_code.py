"""Unit tests for product code generation."""
import asyncio
import uuid
from datetime import datetime, timezone
import sys

import pytest

sys.path.insert(0, "/app/backend")
import server  # noqa: E402


def _run(coro):
    try:
        loop = asyncio.get_event_loop()
        if loop.is_closed():
            raise RuntimeError("closed")
    except Exception:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
    return loop.run_until_complete(coro)


class TestProductCodeFormat:
    def test_keyboard_friday_21_aug_2026(self):
        dt = datetime(2026, 8, 21, 12, 0, tzinfo=timezone.utc)  # Friday
        assert server._product_code_base("Keyboard", dt) == "KF21-PC0826"

    def test_first_non_alpha_stripped(self):
        dt = datetime(2026, 8, 21, tzinfo=timezone.utc)
        assert server._product_code_base("  ' Apple Watch ", dt).startswith("AF21-PC0826")

    def test_empty_title_uses_x(self):
        dt = datetime(2026, 8, 21, tzinfo=timezone.utc)
        assert server._product_code_base("", dt) == "XF21-PC0826"

    def test_first_letter_uppercased(self):
        dt = datetime(2026, 8, 21, tzinfo=timezone.utc)
        assert server._product_code_base("scanpan knives", dt) == "SF21-PC0826"

    def test_day_letter_matches_weekday(self):
        # Mon..Sun → M T W T F S S
        for wd, expected in enumerate(["M", "T", "W", "T", "F", "S", "S"]):
            dt = datetime(2026, 3, 2 + wd, tzinfo=timezone.utc)  # 2026-03-02 = Monday
            assert server._product_code_base("X", dt) == f"X{expected}{2 + wd:02d}-PC0326"

    def test_month_year_pattern(self):
        dt = datetime(2027, 1, 5, tzinfo=timezone.utc)  # Tuesday
        assert server._product_code_base("Widget", dt) == "WT05-PC0127"

    def test_two_digit_day_and_month(self):
        dt = datetime(2026, 12, 31, tzinfo=timezone.utc)  # Thursday
        assert server._product_code_base("Novelty", dt) == "NT31-PC1226"


class TestProductCodeUniqueness:
    def test_dedup_suffix(self):
        # Insert a product with a code that clashes, then generate another and confirm suffix -2
        dt = datetime(2026, 8, 21, tzinfo=timezone.utc)
        pid = str(uuid.uuid4())
        base = server._product_code_base("Zephyr", dt)
        _run(server.db.products.insert_one({
            "id": pid,
            "title": "Zephyr Speaker",
            "product_code": base,
            "created_at": dt.isoformat(),
        }))
        try:
            code = _run(server._generate_unique_product_code("Zephyr", dt))
            assert code == f"{base}-2"
            # Also insert the -2 to force -3
            pid2 = str(uuid.uuid4())
            _run(server.db.products.insert_one({
                "id": pid2, "title": "Z2", "product_code": code, "created_at": dt.isoformat(),
            }))
            code3 = _run(server._generate_unique_product_code("Zephyr", dt))
            assert code3 == f"{base}-3"
        finally:
            _run(server.db.products.delete_many({"product_code": {"$in": [base, f"{base}-2", f"{base}-3"]}, "title": {"$in": ["Zephyr Speaker", "Z2"]}}))

    def test_new_product_creation_receives_code(self):
        import requests, os
        from pathlib import Path
        base_url = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
        if not base_url:
            for line in Path("/app/frontend/.env").read_text().splitlines():
                if line.startswith("REACT_APP_BACKEND_URL="):
                    base_url = line.split("=", 1)[1].strip().rstrip("/")
        API = f"{base_url}/api"
        body = {"title": f"Test-{uuid.uuid4().hex[:6]}", "price": 20.0, "cost": 10.0, "stock": 5}
        r = requests.post(f"{API}/products", json=body, timeout=15)
        assert r.status_code == 200
        p = r.json()
        assert p.get("product_code")
        # Format check
        assert "-PC" in p["product_code"]
        requests.delete(f"{API}/products/{p['id']}", timeout=15)
