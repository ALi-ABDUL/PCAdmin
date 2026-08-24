"""Tests for `scraper._filter_product_images` — enforces the "clean
product photos only" rules: skip seller logos/banners/store icons,
size charts / measurement diagrams, near-duplicate sizes, hard-cap at 8.
"""
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from scraper import _filter_product_images, _image_signature, _looks_like_chrome


class TestChromeDetection:
    def test_logo_flagged(self):
        assert _looks_like_chrome("https://cdn.example.com/store-logo.png") is True
        assert _looks_like_chrome("https://cdn.example.com/logo/main.jpg") is True

    def test_banner_flagged(self):
        assert _looks_like_chrome("https://cdn.example.com/storefront-banner.jpg") is True

    def test_size_chart_flagged(self):
        assert _looks_like_chrome("https://cdn.example.com/mens-size-chart.jpg") is True
        assert _looks_like_chrome("https://cdn.example.com/sizechart.png") is True

    def test_measurement_diagram_flagged(self):
        assert _looks_like_chrome("https://cdn.example.com/measurement-diagram.jpg") is True

    def test_ebay_static_flagged(self):
        assert _looks_like_chrome("https://pics.ebaystatic.com/aw/pics/foo.gif") is True

    def test_clean_product_photo_ok(self):
        assert _looks_like_chrome("https://i.ebayimg.com/images/g/ABC123/s-l1600.webp") is False
        assert _looks_like_chrome("https://i.ebayimg.com/00/s/photo1.jpg") is False


class TestImageSignature:
    def test_collapses_resolution_variants(self):
        big = "https://i.ebayimg.com/images/g/ABC123/s-l1600.webp"
        small = "https://i.ebayimg.com/images/g/ABC123/s-l500.jpg"
        assert _image_signature(big) == _image_signature(small)

    def test_strips_query_string(self):
        a = "https://i.ebayimg.com/images/g/XYZ/s-l1600.webp?_=1"
        b = "https://i.ebayimg.com/images/g/XYZ/s-l1600.webp?foo=bar"
        assert _image_signature(a) == _image_signature(b)

    def test_case_insensitive(self):
        a = "https://i.ebayimg.com/IMAGES/g/ABC/s-L1600.JPG"
        b = "https://i.ebayimg.com/images/g/abc/s-l1600.jpg"
        assert _image_signature(a) == _image_signature(b)


class TestFilterProductImages:
    def test_hard_cap_at_eight(self):
        urls = [f"https://i.ebayimg.com/images/g/AAA{i:02d}/s-l1600.webp" for i in range(20)]
        assert len(_filter_product_images(urls)) == 8

    def test_dedupes_same_image_different_sizes(self):
        urls = [
            "https://i.ebayimg.com/images/g/ABC/s-l1600.webp",
            "https://i.ebayimg.com/images/g/ABC/s-l500.jpg",   # same image, smaller
            "https://i.ebayimg.com/images/g/DEF/s-l1600.webp",  # different image
        ]
        out = _filter_product_images(urls)
        assert len(out) == 2
        assert out[0] == "https://i.ebayimg.com/images/g/ABC/s-l1600.webp"  # bigger kept
        assert out[1] == "https://i.ebayimg.com/images/g/DEF/s-l1600.webp"

    def test_skips_chrome(self):
        urls = [
            "https://cdn.example.com/store-logo.png",
            "https://i.ebayimg.com/images/g/ABC/s-l1600.webp",  # keep
            "https://cdn.example.com/size-chart.jpg",
            "https://cdn.example.com/banner.jpg",
            "https://i.ebayimg.com/images/g/DEF/s-l1600.webp",  # keep
            "https://pics.ebaystatic.com/aw/pics/nav.gif",
        ]
        out = _filter_product_images(urls)
        assert len(out) == 2
        assert all("ebayimg.com" in u for u in out)

    def test_drops_non_http(self):
        urls = ["", None, "javascript:void(0)", "data:image/png;base64,foo"]
        assert _filter_product_images([u for u in urls if u]) == []

    def test_preserves_order(self):
        urls = [
            "https://i.ebayimg.com/images/g/AAA/s-l1600.webp",
            "https://cdn.example.com/logo.png",   # skipped
            "https://i.ebayimg.com/images/g/BBB/s-l1600.webp",
            "https://i.ebayimg.com/images/g/CCC/s-l1600.webp",
        ]
        out = _filter_product_images(urls)
        assert out == [
            "https://i.ebayimg.com/images/g/AAA/s-l1600.webp",
            "https://i.ebayimg.com/images/g/BBB/s-l1600.webp",
            "https://i.ebayimg.com/images/g/CCC/s-l1600.webp",
        ]
