"""Tests for `scraper.clean_description` — cuts eBay listings down to the
product overview and drops seller promo/payment/shipping/returns bloat.
"""
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from scraper import clean_description


def test_cuts_at_shipping_header():
    raw = (
        "Premium wireless headphones with 40-hour battery life.\n"
        "Includes carry case and USB-C cable.\n"
        "\n"
        "SHIPPING\n"
        "We ship worldwide via Australia Post.\n"
        "Standard delivery: 3-5 business days.\n"
        "\n"
        "RETURNS\n"
        "30-day money back guarantee."
    )
    out = clean_description(raw)
    assert "Premium wireless headphones" in out
    assert "carry case" in out
    assert "Australia Post" not in out
    assert "money back guarantee" not in out
    assert "SHIPPING" not in out


def test_cuts_at_payment_header():
    raw = "Great toaster.\n\nPayment\nWe accept PayPal."
    out = clean_description(raw)
    assert "Great toaster" in out
    assert "PayPal" not in out


def test_cuts_at_about_us_header():
    raw = "Amazing product overview.\n\nAbout Us\nWe're a family business since 1999."
    out = clean_description(raw)
    assert "Amazing product overview" in out
    assert "family business" not in out


def test_strips_promo_lines():
    raw = (
        "Real product description here.\n"
        "Free shipping worldwide!\n"
        "Buy it now.\n"
        "Another useful feature line.\n"
        "100% positive feedback rated.\n"
        "Top-rated seller with fast delivery!\n"
        "Happy bidding!"
    )
    out = clean_description(raw)
    assert "Real product description" in out
    assert "Another useful feature line" in out
    assert "Free shipping" not in out
    assert "Buy it now" not in out
    assert "100% positive" not in out
    assert "Top-rated seller" not in out
    assert "Happy bidding" not in out


def test_deduplicates_repeated_lines():
    raw = "Line A\nLine A\nLine A\nLine B\nLine B\nLine C"
    out = clean_description(raw)
    assert out.count("Line A") == 1
    assert out.count("Line B") == 1
    assert out.count("Line C") == 1


def test_truncates_verbose_descriptions():
    raw = ("This is a very useful sentence about the product. " * 60).strip()
    out = clean_description(raw)
    assert len(out) <= 1201  # +1 for a possible ellipsis


def test_empty_string_safe():
    assert clean_description("") == ""
    assert clean_description(None) == ""


def test_preserves_bullet_points():
    raw = (
        "Product overview:\n"
        "- Bullet one\n"
        "- Bullet two\n"
        "- Bullet three\n\n"
        "Shipping\n"
        "Fast delivery."
    )
    out = clean_description(raw)
    assert "Bullet one" in out
    assert "Bullet two" in out
    assert "Bullet three" in out
    assert "Fast delivery" not in out
