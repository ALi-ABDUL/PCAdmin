"""eBay descriptions become de-duplicated, readable paragraph HTML."""
from __future__ import annotations

import pathlib
import sys

from bs4 import BeautifulSoup

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from scraper import format_scraped_description_html


def test_scraped_text_is_grouped_into_two_or_three_sentence_paragraphs():
    raw = (
        "The camera captures crisp photos. It records smooth 4K video. The compact body fits easily in a bag. "
        "The camera captures crisp photos. Battery life supports a full day of shooting. Controls are easy to learn."
    )
    html = format_scraped_description_html(raw)
    soup = BeautifulSoup(html, "html.parser")
    paragraphs = soup.find_all("p")
    assert len(paragraphs) == 2
    assert html.count("The camera captures crisp photos.") == 1
    assert paragraphs[0].get_text(" ") == "The camera captures crisp photos. It records smooth 4K video. The compact body fits easily in a bag."
    assert paragraphs[1].get_text(" ") == "Battery life supports a full day of shooting. Controls are easy to learn."


def test_formatting_escapes_source_markup_and_honours_natural_breaks():
    raw = "First line is clear. Second line is useful.\n\nThird block has <unsafe> markup. Fourth sentence follows."
    html = format_scraped_description_html(raw)
    assert html.count("<p>") == 2
    assert "&lt;unsafe&gt;" in html
    assert "<unsafe>" not in html