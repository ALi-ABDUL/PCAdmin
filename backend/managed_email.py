"""Guarded managed-email delivery for server-rendered transactional messages."""
from __future__ import annotations

import ipaddress
import logging
import os
import re
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlparse

import httpx
from fastapi import HTTPException
from dotenv import load_dotenv


load_dotenv(Path(__file__).with_name(".env"))
logger = logging.getLogger(__name__)
EMAIL_BASE_URL = "https://integrations.emergentagent.com"
EMAIL_KEY = os.environ["EMERGENT_EMAIL_KEY"]
EMAIL_FROM_NAME = os.environ["EMAIL_FROM_NAME"]
EMAIL_REPLY_TO = os.environ.get("EMAIL_REPLY_TO")
_SHORTENERS = ("bit.ly", "tinyurl.com", "t.co", "is.gd", "cutt.ly", "goo.gl", "rebrand.ly")
_CRED_ASK = ("reply with your password", "reply with the code", "send your password", "cvv", "send us your password", "enter your password below", "confirm your card number", "your full card number", "seed phrase", "recovery phrase", "verify your card", "social security number", "confirm your bank details")
_HOSTISH = re.compile(r"\b(?:https?://)?((?:[a-z0-9-]+\.)+[a-z]{2,})", re.I)


def _host_ok(host: str) -> bool:
    if not host or "xn--" in host:
        return False
    try:
        ipaddress.ip_address(host)
        return False
    except ValueError:
        return not any(host == item or host.endswith("." + item) for item in _SHORTENERS)


def _same_site(shown: str, real: str) -> bool:
    return shown == real or real.endswith("." + shown) or shown.endswith("." + real)


class _EmailScan(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tags, self.urls, self.anchors = set(), [], []
        self._href, self._text = None, []

    def handle_starttag(self, tag, attrs):
        self.tags.add(tag.lower())
        self.urls += [value for key, value in attrs if key.lower() in ("href", "src") and value]
        if tag.lower() == "a":
            self._href = dict((key.lower(), value) for key, value in attrs).get("href")
            self._text = []

    def handle_data(self, data):
        if self._href is not None:
            self._text.append(data)

    def handle_endtag(self, tag):
        if tag.lower() == "a" and self._href is not None:
            self.anchors.append((self._href, "".join(self._text)))
            self._href, self._text = None, []


def assert_safe_email(subject: str, html: str) -> None:
    scan = _EmailScan(); scan.feed(html)
    if scan.tags & {"form", "input", "textarea", "select"}:
        raise ValueError("No forms or input fields are allowed in email")
    body = f"{subject}\n{html}".lower()
    if any(phrase in body for phrase in _CRED_ASK):
        raise ValueError("Email asks the recipient for credentials")
    for url in scan.urls:
        low = url.strip().lower()
        if low.startswith(("mailto:", "tel:", "cid:", "#")):
            continue
        parsed = urlparse(low)
        if not low.startswith("https://") or not _host_ok(parsed.hostname or "") or parsed.username is not None:
            raise ValueError("Email links and assets must use safe absolute https URLs")
    for href, text in scan.anchors:
        real = urlparse(href.strip().lower()).hostname or ""
        if real:
            for match in _HOSTISH.finditer(text):
                if not _same_site(match.group(1).lower(), real):
                    raise ValueError("Email link text does not match its destination")


async def send_managed_email(*, to: str, subject: str, html: str) -> str:
    assert_safe_email(subject, html)
    payload = {"to": [to], "subject": subject, "html": html, "from_name": EMAIL_FROM_NAME}
    if EMAIL_REPLY_TO:
        payload["contact_email"] = EMAIL_REPLY_TO
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(f"{EMAIL_BASE_URL}/api/v1/email/send", headers={"X-Email-Key": EMAIL_KEY}, json=payload)
        response.raise_for_status()
        return response.json().get("id") or "accepted"
    except httpx.HTTPStatusError as exc:
        logger.error("Managed test email failed: %s %s", exc.response.status_code, exc.response.text)
        raise HTTPException(status_code=502, detail="Test email delivery failed")
    except Exception:
        logger.exception("Managed test email failed")
        raise HTTPException(status_code=500, detail="Test email delivery failed")