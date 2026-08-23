"""Backend: PATCH /api/products/:id accepts large images list w/ base64 data URLs."""
import os
import base64
import requests
import pytest

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://ebay-au-harvester.preview.emergentagent.com').rstrip('/')


@pytest.fixture(scope="module")
def product_id():
    r = requests.get(f"{BASE_URL}/api/products", params={"limit": 1})
    assert r.status_code == 200, r.text
    data = r.json()
    products = data.get("products") or data.get("items") or []
    assert products, f"No products available: {data}"
    return products[0]["id"]


def _fake_data_url(kb: int) -> str:
    # ~kb kilobytes of base64 payload
    raw = b"\xff" * (kb * 1024)
    return "data:image/jpeg;base64," + base64.b64encode(raw).decode()


def test_patch_with_small_data_url(product_id):
    payload = {"images": [_fake_data_url(10)]}
    r = requests.patch(f"{BASE_URL}/api/products/{product_id}", json=payload)
    assert r.status_code == 200, r.text
    body = r.json()
    assert isinstance(body.get("images"), list) and len(body["images"]) == 1
    assert body["images"][0].startswith("data:image/jpeg;base64,")


def test_patch_with_url_string(product_id):
    payload = {"images": ["https://picsum.photos/seed/test/400"]}
    r = requests.patch(f"{BASE_URL}/api/products/{product_id}", json=payload)
    assert r.status_code == 200, r.text
    assert r.json()["images"] == payload["images"]


def test_patch_with_large_data_url_list(product_id):
    # ~500KB * 3 images = 1.5MB payload
    imgs = [_fake_data_url(500) for _ in range(3)]
    r = requests.patch(f"{BASE_URL}/api/products/{product_id}", json={"images": imgs})
    assert r.status_code == 200, r.text
    got = r.json()["images"]
    assert len(got) == 3


def test_image_proxy_only_used_for_http(product_id):
    # Sanity: image-proxy endpoint should still exist for http URLs
    r = requests.get(f"{BASE_URL}/api/image-proxy", params={"url": "https://picsum.photos/seed/x/100"}, allow_redirects=False)
    assert r.status_code in (200, 302, 307), r.status_code


def test_get_after_patch_persists(product_id):
    marker = _fake_data_url(20)
    r = requests.patch(f"{BASE_URL}/api/products/{product_id}", json={"images": [marker]})
    assert r.status_code == 200
    r2 = requests.get(f"{BASE_URL}/api/products/{product_id}")
    assert r2.status_code == 200
    assert r2.json()["images"][0] == marker
