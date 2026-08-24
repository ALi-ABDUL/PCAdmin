"""Tests for `scraper._normalize_postage` — converts eBay's varied postage
strings into the two canonical forms the store expects:

* "Free Postage" — whenever the seller offers free delivery (text
  contains "Free" or "$0.00", or numeric fee is 0).
* Exact dollar amount "$X.XX" — everything else with a real fee.
"""
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from scraper import _normalize_postage


class TestFreePostage:
    def test_free_word_in_display(self):
        assert _normalize_postage("Free postage", None) == ("Free Postage", 0.0)

    def test_free_case_insensitive(self):
        assert _normalize_postage("FREE SHIPPING", None) == ("Free Postage", 0.0)

    def test_zero_dollar_display(self):
        assert _normalize_postage("$0.00", None) == ("Free Postage", 0.0)

    def test_zero_dollar_no_cents(self):
        assert _normalize_postage("$0", None) == ("Free Postage", 0.0)

    def test_numeric_fee_zero(self):
        # No display, but explicit 0 fee → still free.
        assert _normalize_postage(None, 0.0) == ("Free Postage", 0.0)

    def test_display_and_fee_both_zero(self):
        assert _normalize_postage("Free postage", 0.0) == ("Free Postage", 0.0)


class TestPaidPostage:
    def test_dollar_amount(self):
        assert _normalize_postage("AU $15.00", 15.0) == ("$15.00", 15.0)

    def test_extracts_fee_from_display_only(self):
        # Only display is scraped, fee is None → extract from text.
        out = _normalize_postage("AU $9.95 postage", None)
        assert out == ("$9.95", 9.95)

    def test_formatting_two_decimals(self):
        assert _normalize_postage(None, 7)[0] == "$7.00"

    def test_larger_fee(self):
        assert _normalize_postage("$129", 129.0) == ("$129.00", 129.0)


class TestEdgeCases:
    def test_both_none(self):
        assert _normalize_postage(None, None) == (None, None)

    def test_empty_string_treated_as_missing(self):
        assert _normalize_postage("", None) == (None, None)

    def test_junk_text_no_dollar(self):
        # No amount → return the display verbatim, fee stays None.
        assert _normalize_postage("Check with seller", None) == ("Check with seller", None)
