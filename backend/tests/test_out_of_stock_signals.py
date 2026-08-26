"""Regression tests for the three explicit "out of stock" DOM signals we
detect on eBay AU listings.

The scraper marks a product `out_of_stock` on any of these:
  a) `<div class="x-quantity__availability">` containing a bold+emphasis
     span with text "Out of stock".
  b) A yellow status banner (`.ux-message-container`, `.x-status-message-view`,
     or any element whose class contains `status-message`) with text
     "This item is out of stock".
  c) `<span data-testid="ux-textual-display">` wrapping a child
     `<span class="ux-textspans">This item is out of stock.</span>`.

Any hit forces `stock_status` to `out_of_stock`. The server-side pipeline
then sets `stock: 0` + `archived: True` on the linked product.
"""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scraper import parse_and_enrich  # noqa: E402


URL = "https://www.ebay.com.au/itm/1234567890"


def _base_html(inner_availability_html: str = "") -> str:
    """Skeleton HTML that produces a valid live listing except for
    whichever `inner_availability_html` we splice in. Uses a minimal but
    plausible price/title so `parse_and_enrich` doesn't raise."""
    return f"""
    <html><head><title>Test Item</title></head><body>
      <h1 class="x-item-title__mainTitle"><span>Test Item</span></h1>
      <div class="x-price-primary"><span itemprop="price">AU $29.95</span></div>
      <div class="x-buybox">
        {inner_availability_html}
      </div>
    </body></html>
    """


def _run(html: str) -> dict:
    return asyncio.get_event_loop().run_until_complete(parse_and_enrich(html, URL))


class TestQuantityAvailabilitySignal:
    def test_bold_emphasis_out_of_stock_span_marks_oos(self):
        html = _base_html("""
          <div class="x-quantity__availability">
            <span class="ux-textspans ux-textspans--BOLD ux-textspans--EMPHASIS">Out of stock</span>
          </div>
        """)
        data = _run(html)
        assert data["stock_status"] == "out_of_stock"
        assert data["is_sold"] is True

    def test_availability_without_oos_text_stays_live(self):
        html = _base_html("""
          <div class="x-quantity__availability">
            <span class="ux-textspans ux-textspans--BOLD ux-textspans--EMPHASIS">More than 10 available</span>
          </div>
        """)
        data = _run(html)
        assert data["stock_status"] == "live"


class TestYellowBannerSignal:
    def test_ux_message_container_marks_oos(self):
        html = _base_html("""
          <div class="ux-message-container ux-message-container--attention">
            <span class="ux-textspans">This item is out of stock</span>
          </div>
        """)
        data = _run(html)
        assert data["stock_status"] == "out_of_stock"

    def test_status_message_view_marks_oos(self):
        html = _base_html("""
          <div class="x-status-message-view">
            <p>Notice: This item is out of stock. Please check back soon.</p>
          </div>
        """)
        data = _run(html)
        assert data["stock_status"] == "out_of_stock"

    def test_generic_status_message_class_marks_oos(self):
        html = _base_html("""
          <section class="banner-status-message-yellow">
            This item is out of stock
          </section>
        """)
        data = _run(html)
        assert data["stock_status"] == "out_of_stock"


class TestTextualDisplaySignal:
    def test_ux_textual_display_marks_oos(self):
        html = _base_html("""
          <span data-testid="ux-textual-display">
            <span class="ux-textspans">This item is out of stock.</span>
          </span>
        """)
        data = _run(html)
        assert data["stock_status"] == "out_of_stock"

    def test_ux_textual_display_without_oos_text_stays_live(self):
        html = _base_html("""
          <span data-testid="ux-textual-display">
            <span class="ux-textspans">Free postage</span>
          </span>
        """)
        data = _run(html)
        assert data["stock_status"] == "live"


class TestNoFalsePositives:
    def test_footer_help_copy_ignored(self):
        # eBay's global footer occasionally mentions the phrase in a help link
        # ("Contact us if this item is out of stock at checkout"). We only
        # look inside status containers / textual-display spans, so this
        # noise must not flip the state.
        html = _base_html("""
          <footer>
            <a href="/help">Learn what to do if this item is out of stock</a>
          </footer>
        """)
        data = _run(html)
        assert data["stock_status"] == "live"
