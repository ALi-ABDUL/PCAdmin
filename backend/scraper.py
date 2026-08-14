"""eBay Australia scraper - manual (server-side, anti-bot) + auto (API provider fallback)."""
from __future__ import annotations

import asyncio
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
    urls: list[str] = []
    seen: set[str] = set()

    # 1) OG image
    og = soup.find("meta", property="og:image")
    if og and og.get("content"):
        u = og["content"].strip()
        if u and u not in seen:
            seen.add(u)
            urls.append(u)

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
                u = img.get(attr)
                if u and u.startswith("http") and u not in seen:
                    seen.add(u)
                    urls.append(u)

    # 3) Regex-scan JSON blobs for hi-res image URLs on eBay CDN
    for m in re.finditer(r'https?://i\.ebayimg\.com/[^"\\\'\s]+\.(?:jpg|jpeg|webp|png)', html, re.IGNORECASE):
        u = m.group(0)
        # Upgrade thumbnails to larger versions when possible
        u = re.sub(r"/s-l\d+\.", "/s-l1600.", u)
        if u not in seen:
            seen.add(u)
            urls.append(u)

    return urls[:20]


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
    return text.strip()


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

    if shipping and not collection and re.search(r"(local pick[- ]?up|collection)", shipping, re.IGNORECASE):
        m = re.search(r"(Free local pickup[^.]*|[Ll]ocal pick[- ]?up[^.]*)", shipping)
        if m: collection = m.group(1).strip()

    if shipping and not location:
        m = re.search(r"Located in[:\s]+([^.]+?)(?:\.|$)", shipping)
        if m: location = m.group(1).strip()

    # --- Sold / ended detection ---------------------------------------------
    is_sold = False
    lower_html = html.lower()
    if ("this listing has ended" in lower_html
        or "this listing was ended by the seller" in lower_html
        or 'itemavailability">soldout' in lower_html.replace(" ", "")
        or 'itemavailability" content="https://schema.org/soldout' in lower_html
        or re.search(r"this\s+item\s+has\s+sold", lower_html)
    ):
        is_sold = True


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
        "images": images,
        "specifics": specifics,
    }
