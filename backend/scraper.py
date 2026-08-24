"""eBay Australia scraper - manual (server-side, anti-bot) + auto (API provider fallback)."""
from __future__ import annotations

import asyncio
import json
import random
import re
from typing import Any, Optional
from urllib.parse import urlparse

import httpx
from bs4 import BeautifulSoup

try:
    from curl_cffi.requests import AsyncSession as CurlAsyncSession  # type: ignore
    HAS_CURL_CFFI = True
except Exception:  # pragma: no cover
    HAS_CURL_CFFI = False


# ---------------------------------------------------------------------------
# Title cleaner
# ---------------------------------------------------------------------------

# Words used to identify the product-type noun in a title. Once found, size
# tokens are inserted *before* the descriptor cluster leading to it, so we get
# "Samsung Odyssey Ark 2nd Gen 55\" Curved UHD Gaming Monitor" instead of
# "... UHD Gaming 55\" Monitor".
_TYPE_WORDS = {
    "monitor", "tv", "television", "fridge", "freezer", "washer", "dryer",
    "laptop", "notebook", "camera", "phone", "smartphone", "tablet", "printer",
    "microwave", "oven", "dishwasher", "vacuum", "cooker", "projector",
    "speaker", "headphones", "earbuds", "console", "display", "screen",
    "stove", "cooktop", "rangehood", "kettle", "toaster", "blender", "fan",
    "heater", "smartwatch", "watch", "router", "modem", "keyboard", "mouse",
    "webcam", "chair", "desk", "bike", "scooter", "treadmill", "drone",
}
# Adjectives / spec words that typically sit between the model and the type
# noun. Kept small on purpose — being too greedy would eat model tokens like
# "Pro" or "Max" that belong to the model name.
_DESCRIPTORS = {
    "curved", "flat", "uhd", "fhd", "hd", "4k", "8k", "2k", "hdr", "gaming",
    "smart", "wireless", "bluetooth", "portable", "cordless", "rechargeable",
    "led", "lcd", "oled", "qled", "mini", "stainless", "matte", "glossy",
    "waterproof", "touch", "touchscreen", "dolby", "atmos", "surround",
    "electric", "gas", "induction", "convection", "dual", "single", "triple",
    "quad", "full", "super", "premium", "professional", "noise", "cancelling",
    "cancellation", "active", "passive", "hybrid", "compact", "slim",
    "handheld", "upright", "robot", "front-load", "top-load",
}
_COLOURS = {
    "black", "white", "silver", "grey", "gray", "gold", "rose gold", "red",
    "blue", "green", "beige", "titanium", "graphite", "midnight", "starlight",
    "purple", "pink", "orange", "brown", "cream", "navy", "yellow", "charcoal",
    "bronze", "champagne", "space grey", "space gray", "matte black",
    "matte white", "pearl white", "pearl black", "chrome", "copper",
    "platinum", "sky blue", "royal blue", "olive", "khaki", "burgundy", "ivory",
}
_SIZE_RE = re.compile(
    r'(?<!\d)(\d+(?:\.\d+)?)\s*(?:"|″|”|inches?\b|inch\b|in\.?\b|cm\b|mm\b)',
    re.IGNORECASE,
)
_MULTISPACE = re.compile(r"\s{2,}")


def _norm_size(match: re.Match) -> str:
    """Normalise any detected size to inch-mark form (e.g. 55\")."""
    raw = match.group(0).lower()
    val = match.group(1)
    if "cm" in raw:
        return f'{val}cm'
    if "mm" in raw:
        return f'{val}mm'
    return f'{val}"'


def clean_ebay_title(raw: str) -> str:
    """Normalise a scraped eBay title.

    Rules (matches the requested spec):
      1. Deduplicate repeated tokens / specs.
      2. Move size / dimensions (e.g. 55\") to sit *after* the brand + model
         name, right before the descriptor cluster (Curved / UHD / Gaming …).
      3. Colour or finish from trailing brackets moves to the end with an
         em-dash separator ("Samsung … Monitor – Black").
      4. Empty brackets and stray double punctuation get stripped.
    """
    if not raw:
        return raw
    s = raw.strip()

    # 1. Peel trailing bracketed clauses so we can classify their contents.
    end_bracket_contents: list[str] = []
    while True:
        m = re.search(r"\s*\(([^()]*)\)\s*$", s)
        if not m:
            break
        contents = m.group(1).strip()
        if contents:
            end_bracket_contents.insert(0, contents)
        s = s[: m.start()].rstrip()

    # 2. Strip any inline empty ().
    s = re.sub(r"\(\s*\)", "", s)

    # 3. Tokenise bracket contents by comma / semicolon / slash.
    bracket_tokens: list[str] = []
    for group in end_bracket_contents:
        for t in re.split(r"[,;/]", group):
            t = t.strip()
            if t:
                bracket_tokens.append(t)

    # 4. Extract sizes from the title body — keep normalised form.
    body_sizes = [_norm_size(m) for m in _SIZE_RE.finditer(s)]
    body_no_size = _SIZE_RE.sub("", s)
    body_no_size = _MULTISPACE.sub(" ", body_no_size).strip()

    # 5. Classify bracket tokens as size / colour / other.
    bracket_sizes: list[str] = []
    bracket_colours: list[str] = []
    bracket_others: list[str] = []
    for t in bracket_tokens:
        t_clean = t.strip().rstrip(".")
        m = _SIZE_RE.search(t_clean)
        if m and _SIZE_RE.sub("", t_clean).strip() == "":
            bracket_sizes.append(_norm_size(m))
        elif t_clean.lower() in _COLOURS:
            bracket_colours.append(t_clean.title())
        else:
            bracket_others.append(t_clean)

    # 6. De-duplicate sizes, keeping first occurrence.
    all_sizes = list(dict.fromkeys(body_sizes + bracket_sizes))
    primary_size = all_sizes[0] if all_sizes else None

    # 7. Word-level dedupe on the body (case-insensitive, punctuation-stripped).
    words = body_no_size.split()
    seen_lc: set[str] = set()
    dedup: list[str] = []
    for w in words:
        key = re.sub(r"[^\w]", "", w).lower()
        if key and key in seen_lc:
            continue
        if key:
            seen_lc.add(key)
        dedup.append(w)
    body_no_size = " ".join(dedup)

    # 8. Work out where to re-insert the primary size.
    tokens = body_no_size.split()
    insert_idx: Optional[int] = None
    for i, w in enumerate(tokens):
        key = re.sub(r"[^\w-]", "", w).lower()
        if key in _TYPE_WORDS:
            # Walk backwards while previous token is a descriptor — the size
            # goes at the head of the descriptor cluster.
            j = i
            while j > 0:
                prev_key = re.sub(r"[^\w-]", "", tokens[j - 1]).lower()
                if prev_key in _DESCRIPTORS:
                    j -= 1
                else:
                    break
            insert_idx = j
            break
    if insert_idx is None:
        # Fallback: assume "Brand Model …" — insert after the 4th token, or
        # at end if the title is very short.
        insert_idx = min(4, len(tokens))

    if primary_size:
        tokens = tokens[:insert_idx] + [primary_size] + tokens[insert_idx:]

    body_final = " ".join(tokens)

    # 9. Append colours (unique) as " – Colour, Colour2".
    unique_colours = list(dict.fromkeys(bracket_colours))
    if unique_colours:
        body_final = f"{body_final} – {', '.join(unique_colours)}"

    # 10. Preserve any other bracket tokens (rare — not size, not colour).
    unique_others = list(dict.fromkeys(bracket_others))
    if unique_others:
        body_final = f"{body_final} ({', '.join(unique_others)})"

    # 11. Final tidy — collapse spaces, strip trailing punctuation.
    body_final = _MULTISPACE.sub(" ", body_final).strip()
    body_final = re.sub(r"[\s,;]+$", "", body_final)
    body_final = re.sub(r"–\s*(?:[,;]\s*)?$", "", body_final).strip()
    body_final = re.sub(r"–\s*–", "–", body_final)
    return body_final





# Curated pool of modern real-world desktop User-Agents.
USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
]

ACCEPT_LANGS = ["en-AU,en;q=0.9", "en-AU,en-US;q=0.9,en;q=0.8", "en-GB,en-AU;q=0.9,en;q=0.8"]

EBAY_AU_HOST_RE = re.compile(r"^(www\.)?ebay\.com\.au$", re.IGNORECASE)


class ScrapeError(Exception):
    pass


class NotEbayAUError(ScrapeError):
    pass


class BlockedError(ScrapeError):
    pass


def validate_ebay_au_url(url: str) -> str:
    """Ensures the URL is a valid eBay Australia URL. Returns normalised URL."""
    url = (url or "").strip()
    if not url:
        raise NotEbayAUError("URL is empty.")
    if not url.startswith(("http://", "https://")):
        url = "https://" + url
    parsed = urlparse(url)
    if not EBAY_AU_HOST_RE.match(parsed.netloc):
        raise NotEbayAUError(
            f"Only eBay Australia URLs are supported (ebay.com.au). Got: {parsed.netloc}"
        )
    return url


def _build_headers(referer: str = "https://www.ebay.com.au/") -> dict[str, str]:
    ua = random.choice(USER_AGENTS)
    is_chrome = "Chrome" in ua and "Edg" not in ua
    is_edge = "Edg/" in ua
    is_firefox = "Firefox" in ua
    is_safari = "Safari" in ua and "Chrome" not in ua

    headers = {
        "User-Agent": ua,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": random.choice(ACCEPT_LANGS),
        "Accept-Encoding": "gzip, deflate, br",
        "Cache-Control": "max-age=0",
        "Referer": referer,
        "Upgrade-Insecure-Requests": "1",
        "DNT": "1",
        "Connection": "keep-alive",
    }
    if is_chrome or is_edge:
        brand = '"Microsoft Edge"' if is_edge else '"Google Chrome"'
        headers.update({
            "sec-ch-ua": f'{brand};v="131", "Chromium";v="131", "Not_A Brand";v="24"',
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": '"Windows"' if "Windows" in ua else '"macOS"',
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "same-origin" if "ebay" in referer else "none",
            "Sec-Fetch-User": "?1",
        })
    elif is_firefox:
        headers["TE"] = "trailers"
    _ = is_safari
    return headers


async def _fetch_manual(url: str, attempts: int = 3) -> str:
    """Server-side fetch with anti-bot tactics: rotating UAs, jittered delays, realistic headers, session cookies.

    Uses curl_cffi (TLS fingerprint impersonation of real Chrome) when available -
    this is what tricks eBay's PerimeterX/Akamai bot detection into treating us as a real browser.
    """
    if HAS_CURL_CFFI:
        return await _fetch_manual_curl_cffi(url, attempts)
    return await _fetch_manual_httpx(url, attempts)


async def _fetch_manual_curl_cffi(url: str, attempts: int = 3) -> str:
    """Use curl_cffi to impersonate a real Chrome browser (TLS + JA3 + HTTP2 fingerprint)."""
    last_error: Optional[str] = None
    impersonations = ["chrome131", "chrome124", "chrome120", "safari17_0", "chrome110"]

    async with CurlAsyncSession() as session:
        # Warm-up on homepage to grab first-party cookies
        try:
            await session.get(
                "https://www.ebay.com.au/",
                impersonate=random.choice(impersonations),
                headers={"Accept-Language": random.choice(ACCEPT_LANGS), "Referer": "https://www.google.com/"},
                timeout=25,
            )
            await asyncio.sleep(random.uniform(0.6, 1.6))
        except Exception as e:
            last_error = f"warmup: {e}"

        for i in range(attempts):
            try:
                impersonate = random.choice(impersonations)
                headers = {
                    "Accept-Language": random.choice(ACCEPT_LANGS),
                    "Referer": "https://www.ebay.com.au/",
                    "Upgrade-Insecure-Requests": "1",
                    "DNT": "1",
                }
                resp = await session.get(url, impersonate=impersonate, headers=headers, timeout=25)
                text = resp.text
                if "Pardon Our Interruption" in text or "Pardon our interruption" in text or "px-captcha" in text:
                    last_error = "eBay anti-bot challenge (Pardon Our Interruption)"
                    await asyncio.sleep(random.uniform(1.5, 3.5) * (i + 1))
                    continue
                if resp.status_code == 200 and ("itemTitle" in text or "x-item-title" in text.lower() or "og:title" in text):
                    return text
                if resp.status_code == 200 and len(text) > 8000 and "ebay" in text.lower():
                    return text
                if resp.status_code in (403, 429, 503):
                    last_error = f"Blocked (HTTP {resp.status_code})"
                    await asyncio.sleep(random.uniform(1.5, 3.5) * (i + 1))
                    continue
                if resp.status_code == 200:
                    return text
                last_error = f"HTTP {resp.status_code}"
            except Exception as e:
                last_error = str(e)
            await asyncio.sleep(random.uniform(0.8, 2.0))
    raise BlockedError(last_error or "Manual scrape failed after retries.")


async def _fetch_manual_httpx(url: str, attempts: int = 3) -> str:
    """Server-side fetch with anti-bot tactics: rotating UAs, jittered delays, realistic headers, session cookies."""
    last_error: Optional[str] = None
    async with httpx.AsyncClient(
        follow_redirects=True,
        timeout=25.0,
        http2=True,
    ) as client:
        # Warm-up: hit homepage first so we get session cookies.
        try:
            await client.get("https://www.ebay.com.au/", headers=_build_headers("https://www.google.com/"))
            await asyncio.sleep(random.uniform(0.6, 1.6))
        except Exception:
            pass

        for i in range(attempts):
            try:
                headers = _build_headers()
                resp = await client.get(url, headers=headers)
                text = resp.text
                # Detect anti-bot challenge page even on 200
                if "Pardon Our Interruption" in text or "Pardon our interruption" in text or "px-captcha" in text:
                    last_error = "eBay anti-bot challenge (Pardon Our Interruption)"
                    await asyncio.sleep(random.uniform(1.5, 3.5) * (i + 1))
                    continue
                if resp.status_code == 200 and ("itemTitle" in text or "product-title" in text or "x-item-title" in text.lower()):
                    return text
                if resp.status_code == 200 and len(text) > 8000 and "ebay" in text.lower() and "captcha" not in text.lower():
                    return text
                if resp.status_code in (403, 429, 503):
                    last_error = f"Blocked (HTTP {resp.status_code})"
                    await asyncio.sleep(random.uniform(1.5, 3.5) * (i + 1))
                    continue
                if resp.status_code == 200:
                    return text
                last_error = f"HTTP {resp.status_code}"
            except Exception as e:
                last_error = str(e)
            await asyncio.sleep(random.uniform(0.8, 2.0))
    raise BlockedError(last_error or "Manual scrape failed after retries.")


async def _fetch_scrapingbee(url: str, api_key: str) -> str:
    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.get(
            "https://app.scrapingbee.com/api/v1/",
            params={
                "api_key": api_key,
                "url": url,
                "render_js": "false",
                "premium_proxy": "true",
                "country_code": "au",
            },
        )
        if resp.status_code != 200:
            raise ScrapeError(f"ScrapingBee error {resp.status_code}: {resp.text[:200]}")
        return resp.text


async def _fetch_scraperapi(url: str, api_key: str) -> str:
    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.get(
            "https://api.scraperapi.com/",
            params={"api_key": api_key, "url": url, "country_code": "au"},
        )
        if resp.status_code != 200:
            raise ScrapeError(f"ScraperAPI error {resp.status_code}: {resp.text[:200]}")
        return resp.text


async def fetch_html(
    url: str,
    method: str = "auto",
    scrapingbee_key: Optional[str] = None,
    scraperapi_key: Optional[str] = None,
) -> tuple[str, str]:
    """Fetch HTML for a URL, returning (html, method_used).

    method: 'manual', 'scrapingbee', 'scraperapi', or 'auto' (manual -> scrapingbee -> scraperapi).
    """
    errors: list[str] = []

    if method == "manual":
        return await _fetch_manual(url), "manual"

    if method == "scrapingbee":
        if not scrapingbee_key:
            raise ScrapeError("ScrapingBee API key is required for this method.")
        return await _fetch_scrapingbee(url, scrapingbee_key), "scrapingbee"

    if method == "scraperapi":
        if not scraperapi_key:
            raise ScrapeError("ScraperAPI API key is required for this method.")
        return await _fetch_scraperapi(url, scraperapi_key), "scraperapi"

    # auto: manual -> scrapingbee -> scraperapi
    try:
        html = await _fetch_manual(url)
        return html, "manual"
    except Exception as e:
        errors.append(f"manual: {e}")

    if scrapingbee_key:
        try:
            html = await _fetch_scrapingbee(url, scrapingbee_key)
            return html, "scrapingbee"
        except Exception as e:
            errors.append(f"scrapingbee: {e}")

    if scraperapi_key:
        try:
            html = await _fetch_scraperapi(url, scraperapi_key)
            return html, "scraperapi"
        except Exception as e:
            errors.append(f"scraperapi: {e}")

    raise BlockedError(" | ".join(errors) if errors else "All scrape methods failed.")


# ---------------------------------------------------------------------------
# HTML parsing
# ---------------------------------------------------------------------------

_PRICE_RE = re.compile(r"(AU\s*\$|A\$|\$)\s*([0-9,]+\.?[0-9]*)", re.IGNORECASE)


def _text(node) -> str:
    return re.sub(r"\s+", " ", node.get_text(" ", strip=True)).strip() if node else ""


def _extract_images(soup: BeautifulSoup, html: str) -> list[str]:
    """Collect every candidate image URL, then hand off to
    ``_filter_product_images`` which enforces the "clean product photo"
    rules (drop chrome/logos/size charts, dedupe, require ``s-l1600``,
    never accept ``s-l64`` icon thumbnails, cap at 8).
    """
    urls: list[str] = []
    seen: set[str] = set()

    def _remember(u: str) -> None:
        # Skip 64px seller-logo/icon thumbnails eBay puts inside gallery
        # containers. These are never real product photos regardless of
        # any upsize we could do.
        if not u or not u.startswith("http"):
            return
        if "/s-l64." in u.lower():
            return
        # Upgrade every recognisable eBay size token to the biggest form
        # so downstream code sees a canonical URL.
        u = re.sub(r"/s-l\d+\.", "/s-l1600.", u)
        if u not in seen:
            seen.add(u)
            urls.append(u)

    # 1) OG image
    og = soup.find("meta", property="og:image")
    if og and og.get("content"):
        _remember(og["content"].strip())

    # 2) Common eBay galleries
    selectors = [
        "div.ux-image-carousel-item img",
        "button.ux-image-grid-item img",
        "img.ux-image-magnify__image--original",
        "img[itemprop='image']",
        "#PicturePanel img",
        ".vi-image-gallery__image img",
        ".ux-image-grid img",
    ]
    for sel in selectors:
        for img in soup.select(sel):
            for attr in ("src", "data-src", "data-zoom-src", "data-imgurl"):
                _remember(img.get(attr) or "")

    # 3) Regex-scan JSON blobs for hi-res image URLs on eBay CDN
    for m in re.finditer(r'https?://i\.ebayimg\.com/[^"\\\'\s]+\.(?:jpg|jpeg|webp|png)', html, re.IGNORECASE):
        _remember(m.group(0))

    return _filter_product_images(urls)


# ---------------------------------------------------------------------------
# Image quality filters
# ---------------------------------------------------------------------------

# URL fragments that almost always mark chrome (seller banners, store logos,
# eBay UI icons, promotional badges, size charts, sizing guides, etc). Case-
# insensitive substring match on the URL path/filename.
_IMG_SKIP_TOKENS = (
    "logo", "banner", "storelogo", "store-logo", "storeheader",
    "badge", "sprite", "icon", "avatar",
    "promo", "promotion", "header", "footer",
    "sizechart", "size-chart", "size_chart",
    "sizeguide", "size-guide", "size_guide",
    "sizing", "measurement", "measurements", "measure", "diagram",
    "chart", "howto", "guide",
    "watermark", "shipping", "delivery", "return-policy", "warranty",
    "feedback", "aboutus", "about-us",
)
# eBay static CDN paths only ever serve UI chrome, never product photos.
_IMG_HARD_SKIP_HOSTS = ("pics.ebaystatic.com", "ir.ebaystatic.com")


def _image_signature(url: str) -> str:
    """Normalize an eBay image URL down to its identity so different
    resolutions (`/s-l500.jpg` vs `/s-l1600.webp`) collapse to one row.

    Examples:
      https://i.ebayimg.com/images/g/ABC123/s-l500.jpg  → i.ebayimg.com/images/g/ABC123
      https://i.ebayimg.com/00/s/foo.webp?_=1            → i.ebayimg.com/00/s/foo
    """
    u = (url or "").split("?", 1)[0].split("#", 1)[0]
    # Drop `s-l<digits>` size token and file extension.
    u = re.sub(r"/s-l\d+", "", u, flags=re.IGNORECASE)
    u = re.sub(r"\.(?:jpg|jpeg|webp|png|gif|bmp)$", "", u, flags=re.IGNORECASE)
    # Strip scheme + trailing slash for canonical form.
    u = re.sub(r"^https?://", "", u).rstrip("/")
    return u.lower()


def _looks_like_chrome(url: str) -> bool:
    """True when the URL smells like a seller logo, store banner, UI icon,
    size chart, or other non-product decoration."""
    u = (url or "").lower()
    if not u:
        return True
    if any(h in u for h in _IMG_HARD_SKIP_HOSTS):
        return True
    # Only inspect the path/filename portion — sellers sometimes have benign
    # tokens like "chart" inside the domain of an unrelated CDN we do want.
    path = u.split("://", 1)[-1].split("?", 1)[0]
    filename = path.rsplit("/", 1)[-1]
    for tok in _IMG_SKIP_TOKENS:
        if tok in filename or f"/{tok}" in path or f"{tok}/" in path:
            return True
    return False


def _filter_product_images(urls: list[str], limit: int = 8) -> list[str]:
    """Reduce a raw scraped image list to at most `limit` clean product photos.

    Steps:
    1. Drop empty / non-http URLs.
    2. Drop anything that looks like seller chrome (logos, banners, size
       charts, measurement diagrams — see `_looks_like_chrome`).
    3. Drop any URL that still contains ``s-l64`` (seller logos / icons).
    4. For eBay CDN URLs (``i.ebayimg.com``) require ``s-l1600`` in the
       path — anything else is an untrusted format / non-photo asset.
    5. Collapse near-identical URLs (same eBay image at different sizes)
       via ``_image_signature``. Keeps the first occurrence.
    6. Truncate to ``limit`` (default 8).
    """
    out: list[str] = []
    sigs: set[str] = set()
    for u in urls:
        if not u or not u.startswith("http"):
            continue
        low = u.lower()
        if "/s-l64." in low:
            continue
        if _looks_like_chrome(u):
            continue
        # eBay CDN URLs must be the full-size 1600px variant. Non-eBay URLs
        # (seller-hosted images on external CDNs) are left alone.
        if "i.ebayimg.com" in low and "/s-l1600." not in low:
            continue
        sig = _image_signature(u)
        if not sig or sig in sigs:
            continue
        sigs.add(sig)
        out.append(u)
        if len(out) >= limit:
            break
    return out


def _normalize_postage(display: Optional[str], fee: Optional[float]) -> tuple[Optional[str], Optional[float]]:
    """Normalise the scraped postage into a canonical display + numeric fee.

    Rules the store cares about:
    - If the seller offers free postage (text contains "Free" or "$0.00", or
      the numeric fee is 0), return ("Free Postage", 0.0).
    - Otherwise if we have a numeric fee, format it as "$X.XX" and keep the
      fee.
    - If we only have a display string with a dollar amount, extract the
      amount, format cleanly, and use that.
    - If nothing was scraped, leave both as None so the UI can render a
      neutral "not specified" state instead of fabricating a value.
    """
    if not display and fee is None:
        return None, None
    text = (display or "").strip()
    lower = text.lower()
    # "Free" / "$0.00" / numeric 0 → the seller offers free postage.
    if "free" in lower or "$0.00" in text or text.strip("$ ") in ("0", "0.00") or fee == 0.0:
        return "Free Postage", 0.0
    # Extract a fee from the display text if we don't already have one.
    if fee is None:
        m = re.search(r"(?:AU\s*\$|A\$|\$)\s*([0-9]+(?:[.,][0-9]{1,2})?)", text)
        if m:
            try:
                fee = float(m.group(1).replace(",", "."))
            except ValueError:
                fee = None
    if fee is not None and fee > 0:
        return f"${fee:.2f}", fee
    # Nothing usable — return what we scraped verbatim if it looks like text.
    return (text or None), fee


def _extract_price(soup: BeautifulSoup) -> tuple[Optional[str], Optional[float], Optional[str]]:
    # itemprop=price meta
    meta_price = soup.find("meta", itemprop="price")
    meta_currency = soup.find("meta", itemprop="priceCurrency")
    if meta_price and meta_price.get("content"):
        try:
            val = float(meta_price["content"])
            currency = meta_currency.get("content") if meta_currency else "AUD"
            display = f"{currency} ${val:,.2f}"
            return display, val, currency
        except ValueError:
            pass

    # visible selectors
    for sel in [
        "div.x-price-primary span.ux-textspans",
        ".x-price-primary",
        "span[itemprop='price']",
        "#prcIsum",
        "#mm-saleDscPrc",
        ".display-price",
    ]:
        node = soup.select_one(sel)
        if node:
            display = _text(node)
            m = _PRICE_RE.search(display)
            if m:
                try:
                    val = float(m.group(2).replace(",", ""))
                    return display, val, "AUD"
                except ValueError:
                    return display, None, "AUD"
            if display:
                return display, None, "AUD"
    return None, None, None


def _extract_specifics(soup: BeautifulSoup) -> dict[str, str]:
    specs: dict[str, str] = {}
    # Modern eBay item specifics
    for row in soup.select("dl.ux-labels-values"):
        label = row.select_one(".ux-labels-values__labels")
        value = row.select_one(".ux-labels-values__values")
        if label and value:
            k = _text(label).rstrip(":")
            v = _text(value)
            if k and v:
                specs[k] = v
    # Fallback older layout
    if not specs:
        for row in soup.select("div.itemAttr tr"):
            cells = row.find_all(["th", "td"])
            for i in range(0, len(cells) - 1, 2):
                k = _text(cells[i]).rstrip(":")
                v = _text(cells[i + 1])
                if k and v:
                    specs[k] = v
    return specs


def _extract_variants(soup: BeautifulSoup, html: str) -> list[dict]:
    """Extract eBay listing variants (Size, Colour, Memory, etc.) with per-option price + stock.

    Priority:
      1) JSON-LD ProductGroup.hasVariant (structured, most reliable when eBay ships it)
      2) DOM variation select widgets (.x-msku__select-box / .x-flyover-variations select)
    Returns list of {type, option, price, currency, stock_status, sku?}.
    """
    out: list[dict] = []

    # 1) JSON-LD
    for script in soup.select('script[type="application/ld+json"]'):
        try:
            payload = json.loads(script.string or "")
        except Exception:
            continue
        candidates = payload if isinstance(payload, list) else [payload]
        for node in candidates:
            if not isinstance(node, dict):
                continue
            variants = node.get("hasVariant") or []
            if not isinstance(variants, list) or not variants:
                continue
            for v in variants:
                if not isinstance(v, dict):
                    continue
                offers = v.get("offers") or {}
                if isinstance(offers, list):
                    offers = offers[0] if offers else {}
                price = None
                try:
                    price = float(offers.get("price")) if offers.get("price") is not None else None
                except Exception:
                    price = None
                currency = offers.get("priceCurrency") or "AUD"
                availability = (offers.get("availability") or "").lower()
                if "outofstock" in availability or "soldout" in availability:
                    stock_status = "out_of_stock"
                elif "instock" in availability or "limitedavail" in availability:
                    stock_status = "live"
                else:
                    stock_status = "live"
                # Turn the variant's property map (e.g. {"color":"Red","size":"M"}) into rows.
                # Prefer top-level fields, then additionalProperty list.
                props: dict[str, str] = {}
                for key in ("color", "size", "material", "pattern"):
                    if v.get(key):
                        props[key.capitalize()] = str(v.get(key)).strip()
                for ap in (v.get("additionalProperty") or []):
                    if isinstance(ap, dict):
                        n = (ap.get("name") or "").strip()
                        val = (ap.get("value") or "").strip()
                        if n and val:
                            props[n] = val
                if not props and v.get("name"):
                    props["Option"] = str(v["name"]).strip()
                for vtype, vopt in props.items():
                    out.append({
                        "type": vtype,
                        "option": vopt,
                        "price": price,
                        "currency": currency,
                        "stock_status": stock_status,
                        "sku": (v.get("sku") or v.get("mpn") or None),
                    })
        if out:
            return _dedupe_variants(out)

    # 2) DOM fallback — variation select widgets
    for sel in soup.select("select.msku-sel__select-box, .x-msku__select-box, select[name^='msku-sel-']"):
        vtype = None
        # Aria-label often holds the type ("Choose Colour")
        aria = (sel.get("aria-label") or "").strip()
        if aria:
            m = re.search(r"choose\s+(.+)", aria, re.I)
            vtype = m.group(1).strip() if m else aria
        if not vtype:
            # Fallback: preceding label text
            lbl = sel.find_previous(["label", "span"])
            if lbl:
                vtype = _text(lbl).strip(": ").strip()
        vtype = (vtype or "Option").title()
        for opt in sel.find_all("option"):
            v = (opt.get_text() or "").strip()
            if not v or v.lower().startswith("select"):
                continue
            disabled = opt.has_attr("disabled") or "disabled" in (opt.get("class") or [])
            stock_status = "out_of_stock" if disabled else "live"
            # Price hint may be baked into the label like "Red — AU $12.00"
            m = re.search(r"AU\s*\$?\s*([\d,]+\.?\d*)", v)
            price = None
            if m:
                try:
                    price = float(m.group(1).replace(",", ""))
                except Exception:
                    price = None
                v = re.sub(r"\s*[-–]\s*AU\s*\$?[\d,]+\.?\d*\s*$", "", v).strip()
            out.append({
                "type": vtype,
                "option": v,
                "price": price,
                "currency": "AUD",
                "stock_status": stock_status,
                "sku": None,
            })

    return _dedupe_variants(out)


def _dedupe_variants(rows: list[dict]) -> list[dict]:
    seen: set[tuple] = set()
    result: list[dict] = []
    for r in rows:
        key = (r.get("type"), r.get("option"))
        if key in seen or not r.get("option"):
            continue
        seen.add(key)
        result.append(r)
    return result


def _extract_breadcrumbs(soup: BeautifulSoup, html: str) -> list[str]:
    """Extract the eBay category breadcrumb path.

    eBay renders breadcrumbs in a few ways; we try structured data first (JSON-LD
    BreadcrumbList), then the visible breadcrumb widget, then a legacy fallback.
    UI-only rows like "See more", "See all", "…" are stripped so downstream
    category naming isn't polluted.
    """
    # UI-only breadcrumb rows to drop
    NOISE_EXACT = {"ebay", "home", "back", "back to home page", "back to previous page",
                   "see more", "see all", "show more", "view all", "browse all",
                   "shop by category", "categories", "all categories", "…", "..."}

    def _keep(name: str) -> bool:
        if not name:
            return False
        n = name.strip().lower()
        if not n or n in NOISE_EXACT:
            return False
        if re.match(r"^(see|view|shop|show)\s+(more|all)\b", n):
            return False
        # Site-header store prefixes ("eBay", "eBay Motors", "eBay Stores", ...)
        if re.match(r"^ebay(\s+.*)?$", n):
            return False
        return True

    # 1. JSON-LD BreadcrumbList
    for script in soup.select('script[type="application/ld+json"]'):
        try:
            payload = json.loads(script.string or "")
        except Exception:
            continue
        candidates = payload if isinstance(payload, list) else [payload]
        for node in candidates:
            if isinstance(node, dict) and node.get("@type") == "BreadcrumbList":
                items = node.get("itemListElement") or []
                names: list[str] = []
                for it in items:
                    if not isinstance(it, dict):
                        continue
                    item = it.get("item") or {}
                    name = it.get("name") or (item.get("name") if isinstance(item, dict) else None)
                    if _keep(name):
                        names.append(str(name).strip())
                if names:
                    return names

    # 2. Modern visible breadcrumb widget
    for sel in [
        "nav.breadcrumbs a span",
        "nav.breadcrumbs a",
        "#vi-VR-brumb-lnkLst a",
        ".breadcrumbs a",
        ".seo-breadcrumb-text",
    ]:
        nodes = soup.select(sel)
        if nodes:
            names = [_text(n) for n in nodes if _keep(_text(n))]
            if names:
                return names

    return []


async def fetch_description_iframe(iframe_url: str) -> str:
    """Fetch the seller's HTML description from the eBay description iframe (vi.raptor.ebaydesc.com)."""
    try:
        if HAS_CURL_CFFI:
            async with CurlAsyncSession() as s:
                r = await s.get(
                    iframe_url,
                    impersonate="chrome131",
                    headers={
                        "Accept-Language": random.choice(ACCEPT_LANGS),
                        "Referer": "https://www.ebay.com.au/",
                    },
                    timeout=25,
                )
                html = r.text
        else:
            async with httpx.AsyncClient(timeout=25.0, follow_redirects=True) as c:
                r = await c.get(iframe_url, headers=_build_headers("https://www.ebay.com.au/"))
                html = r.text
    except Exception:
        return ""
    soup = BeautifulSoup(html, "lxml")
    # Prefer body content, strip scripts/styles
    for tag in soup(["script", "style", "noscript"]):
        tag.decompose()
    body = soup.body or soup
    text = re.sub(r"\n{3,}", "\n\n", body.get_text("\n", strip=True))
    return clean_description(text.strip())


# Section headers that indicate the seller's product overview is done and
# store-boilerplate begins. We cut the description at the first hit.
_DESC_CUT_HEADERS = [
    r"payment\s*(?:info|information|details|terms|methods?)?",
    r"shipping\s*(?:info|information|details|policy|terms)?",
    r"postage\s*(?:info|information|details|policy|terms)?",
    r"delivery\s*(?:info|information|details|policy|terms|times?)?",
    r"returns?\s*(?:info|information|details|policy|terms)?",
    r"warranty(?:\s*(?:info|information|details|policy|terms))?",
    r"feedback",
    r"about\s+us",
    r"about\s+(?:the\s+)?seller",
    r"contact\s+us",
    r"terms\s*(?:and|&)\s*conditions",
    r"customer\s+service",
    r"store\s+policies",
    r"visit\s+(?:our|my)\s+store",
    r"add\s+(?:me\s+)?to\s+(?:your\s+)?favou?rites?",
    r"check\s+(?:out\s+)?(?:our|my)\s+other\s+(?:listings|items|products)",
]
_DESC_CUT_RE = re.compile(
    r"(?im)^\s*(?:[\W_]{0,4})?(?:" + "|".join(_DESC_CUT_HEADERS) + r")\s*[:\-–—]?\s*$"
)

# One-off promo/boilerplate lines that appear anywhere and should be stripped.
_DESC_PROMO_LINES = re.compile(
    r"(?im)^\s*(?:"
    r"(?:please\s+)?(?:read|see|check)\s+(?:our\s+)?(?:full\s+)?(?:store\s+)?(?:policy|policies|description|listing)\.?|"
    r"buy\s+it\s+now\.?|"
    r"free\s+shipping.*|"
    r"fast\s+(?:and\s+)?free\s+shipping.*|"
    r"we\s+offer\s+.*?(?:shipping|delivery|returns).*|"
    r"100%\s+(?:positive\s+)?feedback.*|"
    r"5\s+star\s+seller.*|"
    r"top(?:\-|\s)rated\s+seller.*|"
    r"powered\s+by\s+ink[\w\s]*|"
    r"listing\s+(?:powered|created)\s+by.*|"
    r"thank\s+you\s+for\s+(?:your\s+)?(?:business|shopping|purchase)\.?|"
    r"happy\s+bidding[\.!]?|"
    r"good\s+luck[\.!]?"
    r")\s*$"
)


def clean_description(raw: str) -> str:
    """Reduce an eBay seller description down to the product overview only.

    - Cuts everything from the first "Payment / Shipping / Returns / About
      us / …" header downwards (case-insensitive, whole-line match).
    - Strips one-off promo lines (buy-it-now, free shipping shout-outs,
      feedback bragging, "powered by inkFrog" footers, etc).
    - Deduplicates consecutive identical lines and collapses runs of blank
      lines.
    - Trims to a sensible ~1200-char cap so the description stays a short
      overview even for verbose sellers.
    """
    if not raw:
        return ""
    text = raw.replace("\r\n", "\n").replace("\r", "\n")
    # Cut at first promo/policy section header.
    m = _DESC_CUT_RE.search(text)
    if m:
        text = text[: m.start()]
    # Drop promo lines.
    lines = [ln for ln in text.split("\n") if not _DESC_PROMO_LINES.match(ln)]
    # Deduplicate consecutive identical lines (common in listing templates).
    dedup: list[str] = []
    for ln in lines:
        stripped = ln.strip()
        if dedup and stripped == dedup[-1].strip():
            continue
        dedup.append(ln)
    text = "\n".join(dedup)
    # Collapse blank runs, trim.
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    if len(text) > 1200:
        # Truncate at last sentence boundary within budget so we don't
        # cut mid-word.
        head = text[:1200]
        cut = max(head.rfind(". "), head.rfind("\n"), head.rfind("! "), head.rfind("? "))
        text = head[: cut + 1].rstrip() if cut > 400 else head.rstrip() + "…"
    return text


async def parse_and_enrich(html: str, url: str, fetch_desc: bool = True) -> dict[str, Any]:
    data = parse_ebay_item(html, url)
    if fetch_desc and data.get("description_iframe_url"):
        desc = await fetch_description_iframe(data["description_iframe_url"])
        if desc:
            data["description"] = desc
    return data


def parse_ebay_item(html: str, url: str) -> dict[str, Any]:
    soup = BeautifulSoup(html, "lxml")

    # Detect challenge/block pages
    if "Pardon Our Interruption" in html or "Access to this page has been denied" in html:
        raise BlockedError("eBay served an anti-bot challenge page.")

    # Title
    title = None
    for sel in [
        "h1.x-item-title__mainTitle span.ux-textspans--BOLD",
        "h1.x-item-title__mainTitle",
        "h1#itemTitle",
        "meta[property='og:title']",
    ]:
        node = soup.select_one(sel)
        if node:
            title = node.get("content") if node.name == "meta" else _text(node)
            if title:
                title = re.sub(r"^Details about\s+", "", title).strip()
                break
    if title:
        title = clean_ebay_title(title)

    # Price
    price_display, price_value, currency = _extract_price(soup)

    # Condition
    condition = None
    for sel in [".x-item-condition-text", ".u-flL.condText", "[data-testid='ux-item-condition']"]:
        node = soup.select_one(sel)
        if node:
            condition = _text(node)
            break

    # Seller
    seller = None
    for sel in [".x-sellercard-atf__info__about-seller", ".ux-seller-section__item--seller", ".mbg-nw"]:
        node = soup.select_one(sel)
        if node:
            seller = _text(node)
            break

    # Location
    location = None
    for sel in [
        ".ux-labels-values--itemLocation .ux-labels-values__values",
        "div.d-item-location .ux-textspans",
        "span[itemprop='availableAtOrFrom']",
    ]:
        node = soup.select_one(sel)
        if node:
            location = _text(node)
            break

    # Shipping (broad line)
    shipping = None
    for sel in [
        ".ux-labels-values--shipping .ux-labels-values__values",
        ".d-shipping-minview .ux-textspans",
        "#fshippingCost",
    ]:
        node = soup.select_one(sel)
        if node:
            shipping = _text(node)
            break

    # --- Postage / Delivery / Collection / Returns / Payments ---------------
    postage_display: Optional[str] = None
    postage_fee: Optional[float] = None
    delivery_estimate: Optional[str] = None
    collection: Optional[str] = None
    returns_policy: Optional[str] = None
    payment_methods: Optional[str] = None

    # Scan every ux-labels-values dl by label text
    for dl in soup.select("dl.ux-labels-values"):
        label_node = dl.select_one(".ux-labels-values__labels")
        value_node = dl.select_one(".ux-labels-values__values")
        if not label_node or not value_node:
            continue
        label = _text(label_node).rstrip(":").lower()
        value = _text(value_node)
        if not value:
            continue
        if "postage" in label or "shipping" in label:
            if not postage_display:
                postage_display = value
            m = re.search(r"(AU\s*\$|A\$|\$)\s*([0-9,]+\.?[0-9]*)", value)
            if m:
                try: postage_fee = float(m.group(2).replace(",", ""))
                except ValueError: pass
        elif "delivery" in label or "estimated" in label:
            delivery_estimate = value
        elif "collection" in label or "pickup" in label or "pick up" in label:
            collection = value
        elif "return" in label:
            returns_policy = value
        elif "payment" in label:
            payment_methods = value

    # Regex fallback for delivery estimate text anywhere on the page
    if not delivery_estimate:
        patterns = [
            r"Estimated between\s+([A-Za-z]{3},\s*\d{1,2}\s+[A-Za-z]{3})\s+and\s+([A-Za-z]{3},\s*\d{1,2}\s+[A-Za-z]{3})(?:\s+to\s+(\d{3,4}))?",
            r"Estimated delivery[^A-Za-z]{0,4}([A-Za-z]{3},\s*\d{1,2}\s+[A-Za-z]{3}(?:\s*-\s*[A-Za-z]{3},\s*\d{1,2}\s+[A-Za-z]{3})?)",
            r'"deliveryDate"[^"]{0,10}"([^"]{5,80})"',
            r"Estimated\s+(?:between|on|by)\s+([^<\"\n]{6,90}?)(?:\s+to\s+(\d{3,4}))?[<\"\n]",
        ]
        for pat in patterns:
            m = re.search(pat, html)
            if m:
                if len(m.groups()) >= 2 and m.group(2) and re.match(r"^[A-Za-z]{3}", m.group(2)):
                    delivery_estimate = f"Estimated between {m.group(1)} and {m.group(2)}" + (f" to {m.group(3)}" if len(m.groups()) >= 3 and m.group(3) else "")
                else:
                    delivery_estimate = f"Estimated {m.group(1).strip()}" + (f" to {m.group(2)}" if len(m.groups()) >= 2 and m.group(2) and m.group(2).isdigit() else "")
                break

    # Regex fallback for postage fee anywhere in the page
    if postage_fee is None:
        for pat in [
            r"(?:Postage|Shipping)[^$]{0,120}?(?:AU\s*\$|A\$|\$)\s*([0-9]+(?:[.,][0-9]{1,2})?)",
            r'"shippingServiceCost"[^0-9]{0,20}([0-9]+\.[0-9]{1,2})',
            r'"shippingCost"[^0-9]{0,20}([0-9]+\.[0-9]{1,2})',
        ]:
            m = re.search(pat, html)
            if m:
                try:
                    postage_fee = float(m.group(1).replace(",", "."))
                    if not postage_display:
                        postage_display = f"AU ${postage_fee:.2f}"
                    break
                except ValueError: pass

    # Parse the shipping blob if we have it but no split fields
    if shipping and not postage_display:
        m = re.search(r"(AU\s*\$|A\$|\$)\s*([0-9]+(?:\.[0-9]{1,2})?)", shipping)
        if m:
            postage_display = shipping.split("See details")[0].strip()
            try: postage_fee = float(m.group(2))
            except ValueError: pass
        elif "free" in shipping.lower() and "post" in shipping.lower():
            postage_display = "Free postage"
            postage_fee = 0.0

    # Normalise whatever we found into the two canonical forms the store
    # expects: "Free Postage" when the seller offers free shipping (either
    # via a "Free" / "$0.00" string or an explicit fee of 0), or the exact
    # dollar amount otherwise (e.g. "$15.00"). If nothing was scraped we
    # leave both fields None so the UI can show a "not specified" state
    # rather than fabricating a number.
    postage_display, postage_fee = _normalize_postage(postage_display, postage_fee)

    if shipping and not collection and re.search(r"(local pick[- ]?up|collection)", shipping, re.IGNORECASE):
        m = re.search(r"(Free local pickup[^.]*|[Ll]ocal pick[- ]?up[^.]*)", shipping)
        if m: collection = m.group(1).strip()

    if shipping and not location:
        m = re.search(r"Located in[:\s]+([^.]+?)(?:\.|$)", shipping)
        if m: location = m.group(1).strip()

    # --- Sold / ended / out-of-stock detection ------------------------------
    # Only mark non-live when eBay explicitly signals it via structured data
    # or its own status banner. We NEVER string-match against the raw HTML
    # (which contains scripts, JSON blobs, recommendations, footer help copy,
    # and other noise that would poison a live listing into a sold state).
    is_sold = False
    stock_status = "live"   # live | sold | ended | out_of_stock

    # 1) VISIBLE text banner — we compute the visible text after excluding
    #    <script>/<style>/<noscript> content, so JSON blobs and inline JS
    #    strings cannot false-positive our banner check. eBay renders "This
    #    listing has ended" / "This item has been sold" as a user-visible
    #    message when a listing is dead — the exact phrase seen on ebay.com.au.
    visible_parts: list[str] = []
    for txt in soup.find_all(string=True):
        parent_name = getattr(txt.parent, "name", None) if txt.parent else None
        if parent_name in ("script", "style", "noscript"):
            continue
        s = str(txt).strip()
        if s:
            visible_parts.append(s)
    visible_text = " ".join(visible_parts).lower()
    ended_signals = (
        "this listing has ended",
        "this listing was ended by the seller",
        "the listing you're looking for has ended",
        "the listing you are looking for has ended",
    )
    sold_signals = (
        "this item has been sold",
    )
    if any(s in visible_text for s in ended_signals):
        is_sold = True
        stock_status = "ended"
    elif any(s in visible_text for s in sold_signals):
        is_sold = True
        stock_status = "sold"

    # 2) Structured itemAvailability — microdata (`<meta itemprop="itemAvailability" content="…">`)
    #    or plain-text `<span itemprop="itemAvailability">SoldOut</span>`. This
    #    is the eBay-blessed structured signal for the listing's own availability.
    if stock_status == "live":
        avail_nodes = soup.select('[itemprop="itemAvailability" i]')  # case-insensitive attr match
        for node in avail_nodes:
            val = (node.get("content") or _text(node) or "").lower().replace(" ", "")
            if not val:
                continue
            if "soldout" in val:
                is_sold = True; stock_status = "sold"; break
            if "outofstock" in val:
                is_sold = True; stock_status = "out_of_stock"; break
            if "discontinued" in val:
                is_sold = True; stock_status = "ended"; break

    # 3) Main product's JSON-LD offer.availability (schema.org). We look at the
    #    top-level Product node only (not variant `hasVariant` offers) so a
    #    single out-of-stock variant on a live listing does not flip the whole
    #    product to sold.
    if stock_status == "live":
        for ld_json in re.findall(r'<script[^>]+type="application/ld\+json"[^>]*>(.*?)</script>', html, flags=re.DOTALL | re.IGNORECASE):
            try:
                payload = json.loads(ld_json.strip())
            except Exception:
                continue
            candidates = payload if isinstance(payload, list) else [payload]
            main_avail = None
            for node in candidates:
                if not isinstance(node, dict):
                    continue
                types = node.get("@type")
                types = [types] if isinstance(types, str) else (types or [])
                if not any((t or "").lower() == "product" for t in types):
                    continue
                offers = node.get("offers") or {}
                if isinstance(offers, list):
                    offers = offers[0] if offers else {}
                if isinstance(offers, dict):
                    a = (offers.get("availability") or "").lower()
                    if a:
                        main_avail = a
                        break
            if not main_avail:
                continue
            if "soldout" in main_avail:
                is_sold = True; stock_status = "sold"; break
            if "outofstock" in main_avail:
                is_sold = True; stock_status = "out_of_stock"; break
            if "discontinued" in main_avail:
                is_sold = True; stock_status = "ended"; break
            # instock / limitedavailability / preorder / backorder -> live (no change)
            break


    # Description will be fetched separately from the iframe.
    description = None
    description_iframe_url: Optional[str] = None
    iframe = soup.select_one("iframe#desc_ifr") or soup.select_one("iframe[id*='desc_ifr']")
    if iframe and iframe.get("src"):
        description_iframe_url = iframe["src"]
    if not description_iframe_url:
        m = re.search(r'(https?://vi\.raptor\.ebaydesc\.com/ws/eBayISAPI\.dll\?ViewItemDescV4[^"\'<>\s]+)', html)
        if m:
            description_iframe_url = m.group(1)

    # Availability / quantity
    availability = None
    for sel in [".ux-labels-values--quantityAvailable .ux-textspans", "#qtySubTxt"]:
        node = soup.select_one(sel)
        if node:
            availability = _text(node)
            break

    # Item ID from URL
    item_id_match = re.search(r"/itm/(?:[^/]+/)?(\d{10,})", url) or re.search(r"item=(\d{10,})", url)
    item_id = item_id_match.group(1) if item_id_match else None

    images = _extract_images(soup, html)
    specifics = _extract_specifics(soup)
    ebay_category_path = _extract_breadcrumbs(soup, html)
    variants = _extract_variants(soup, html)

    return {
        "url": url,
        "item_id": item_id,
        "title": title,
        "price_display": price_display,
        "price_value": price_value,
        "currency": currency or "AUD",
        "condition": condition,
        "seller": seller,
        "location": location,
        "shipping": shipping,
        "availability": availability,
        "description": description,
        "description_iframe_url": description_iframe_url,
        "postage_display": postage_display,
        "postage_fee": postage_fee,
        "delivery_estimate": delivery_estimate,
        "collection": collection,
        "returns_policy": returns_policy,
        "payment_methods": payment_methods,
        "is_sold": is_sold,
        "stock_status": stock_status,
        "images": images,
        "specifics": specifics,
        "ebay_category_path": ebay_category_path,
        "variants": variants,
    }
