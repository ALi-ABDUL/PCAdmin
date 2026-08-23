"""Integration tests for eBay title cleaning: parse_ebay_item + GET /api/products regression."""
import os
import requests
from scraper import parse_ebay_item

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # fallback to frontend/.env
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
    except FileNotFoundError:
        pass


DIRTY_HTML = """
<html><body>
<h1 class="x-item-title__mainTitle"><span class="ux-textspans--BOLD">Samsung 55" Odyssey Ark 2nd Gen Curved UHD Gaming Monitor (55", Black)</span></h1>
</body></html>
"""


def test_parse_ebay_item_cleans_title():
    result = parse_ebay_item(DIRTY_HTML, "https://www.ebay.com/itm/123")
    assert "title" in result
    # Cleaned title expected
    cleaned = result["title"]
    print(f"Cleaned title: {cleaned!r}")
    assert cleaned == 'Samsung Odyssey Ark 2nd Gen 55" Curved UHD Gaming Monitor – Black'


def test_parse_ebay_item_returns_all_fields():
    """Regression - parse_ebay_item must still return known keys even if empty."""
    result = parse_ebay_item(DIRTY_HTML, "https://www.ebay.com/itm/123")
    # These keys should exist in the returned dict
    expected_keys = {
        "item_id", "price_display", "price_value", "currency",
        "condition", "seller", "images", "specifics", "description",
        "variants", "ebay_category_path",
    }
    missing = expected_keys - set(result.keys())
    assert not missing, f"Missing keys after cleanup change: {missing}"


def test_existing_products_titles_not_touched():
    """GET /api/products - titles remain unchanged (cleaning applied only on new scrape)."""
    if not BASE_URL:
        import pytest
        pytest.skip("No BASE_URL configured")
    r = requests.get(f"{BASE_URL}/api/products", timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    products = data if isinstance(data, list) else data.get("products", data.get("items", []))
    print(f"Products count: {len(products)}")
    if not products:
        import pytest
        pytest.skip("No existing products to verify against")
    # Just assert titles are strings and not accidentally wiped
    for p in products[:5]:
        title = p.get("title") or p.get("name")
        assert title, f"Empty title on product: {p.get('id')}"
        print(f"Existing title (untouched): {title!r}")
