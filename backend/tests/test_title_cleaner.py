"""Unit tests for the eBay title cleaner (scraper.clean_ebay_title)."""
from scraper import clean_ebay_title


def test_spec_example_from_user():
    # Verbatim example from the product spec.
    raw = 'Samsung 55" Odyssey Ark 2nd Gen Curved UHD Gaming Monitor (55", Black)'
    assert clean_ebay_title(raw) == (
        'Samsung Odyssey Ark 2nd Gen 55" Curved UHD Gaming Monitor – Black'
    )


def test_removes_duplicate_words():
    raw = "Sony WH-1000XM5 Bluetooth Bluetooth Wireless Wireless Headphones"
    out = clean_ebay_title(raw)
    # Both duplicates collapse, headphones is a type-noun so size (none here)
    # doesn't matter — dedupe is what we assert.
    assert out.lower().count("bluetooth") == 1
    assert out.lower().count("wireless") == 1


def test_moves_size_after_model_no_brackets():
    raw = 'LG C3 65" OLED 4K Smart TV'  # already correct — must stay stable
    assert clean_ebay_title(raw) == 'LG C3 65" OLED 4K Smart TV'


def test_moves_size_from_front_to_after_model():
    raw = 'LG 65" C3 4K Smart TV'
    out = clean_ebay_title(raw)
    # Size is moved out of the front, placed right before the descriptor
    # cluster ("4K Smart" leading to "TV").
    assert out == 'LG C3 65" 4K Smart TV'


def test_colour_moved_to_dash_suffix():
    raw = "Apple iPhone 15 Pro Max (Titanium)"
    out = clean_ebay_title(raw)
    assert out.endswith(" – Titanium")
    assert "(Titanium)" not in out


def test_multiple_colours_kept():
    raw = "Bose QuietComfort 45 Wireless Headphones (Black, White)"
    out = clean_ebay_title(raw)
    assert out.endswith(" – Black, White")


def test_empty_brackets_removed():
    raw = "Samsung Galaxy S24 Ultra ()"
    out = clean_ebay_title(raw)
    assert "()" not in out
    assert out == "Samsung Galaxy S24 Ultra"


def test_trailing_punctuation_trimmed():
    raw = 'Dyson V15 Detect Cordless Vacuum,,;;'
    out = clean_ebay_title(raw)
    assert not out.endswith(",")
    assert not out.endswith(";")


def test_cm_size_normalises():
    raw = "Weber Family Q 300 60cm Gas BBQ (Titanium)"
    out = clean_ebay_title(raw)
    assert "60cm" in out
    assert out.endswith(" – Titanium")


def test_duplicate_size_in_brackets_removed():
    raw = 'Samsung 55" QLED TV (55")'
    out = clean_ebay_title(raw)
    # Should keep only ONE 55".
    assert out.count('55"') == 1


def test_non_matching_bracket_preserved():
    # Random spec that isn't size/colour should be preserved in ().
    raw = "Nintendo Switch OLED Console (2023 Model)"
    out = clean_ebay_title(raw)
    assert "(2023 Model)" in out


def test_no_type_word_fallback():
    raw = 'Awesome 12" Widget XYZ (Red)'
    out = clean_ebay_title(raw)
    # No known type-word → fallback places size after 4th token, and colour
    # still moves to a dash suffix.
    assert out.endswith(" – Red")
    assert "(Red)" not in out


def test_empty_input():
    assert clean_ebay_title("") == ""
    assert clean_ebay_title(None) is None
