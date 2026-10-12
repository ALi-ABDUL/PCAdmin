"""Security-focused tests for the PCStore support attachment proxy (mocked upstream)."""
from __future__ import annotations

import os
import sys
import uuid

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient


sys.path.insert(0, "/app/backend")
import server as server_mod


class _FakeResponse:
    def __init__(self, status_code=200, content=b"png-bytes", content_type="image/png", headers=None):
        self.status_code = status_code
        self.content = content
        default_headers = {"content-type": content_type, "content-length": str(len(content))}
        self.headers = {**default_headers, **(headers or {})}


class _FakeClient:
    def __init__(self, captured, response):
        self.captured = captured
        self.response = response

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return False

    async def get(self, url, headers):
        self.captured.update({"url": url, "headers": headers})
        return self.response


class _FakeSupportMessagesCollection:
    def __init__(self, ticket_doc: dict | None):
        self._ticket_doc = ticket_doc

    async def find_one(self, *_args, **_kwargs):
        return self._ticket_doc


class _FakeDb:
    def __init__(self, ticket_doc: dict | None):
        self.support_messages = _FakeSupportMessagesCollection(ticket_doc)


@pytest.mark.parametrize(
    "raw_url",
    [
        "https://evil.example/image.png",
        "//evil.example/image.png",
        "/uploads/../private.png",
        "javascript:alert(1)",
        "https://vkx-api-integration.preview.emergentagent.com/uploads/x.png#frag",
        "http://vkx-api-integration.preview.emergentagent.com/uploads/x.png",
        "uploads/missing-leading-slash.png",
    ],
)
def test_attachment_proxy_rejects_unsafe_origins_and_paths(monkeypatch, raw_url):
    """Normalisation hardening for off-origin/malformed/traversal input."""
    monkeypatch.setenv("PCSTORE_URL", "https://vkx-api-integration.preview.emergentagent.com")
    with pytest.raises(HTTPException):
        server_mod._normalise_pcstore_attachment_url(raw_url)


def test_attachment_proxy_allows_only_relative_or_exact_origin(monkeypatch):
    """Normalisation permits only trusted relative or exact-origin HTTPS paths."""
    monkeypatch.setenv("PCSTORE_URL", "https://vkx-api-integration.preview.emergentagent.com")
    assert (
        server_mod._normalise_pcstore_attachment_url("/uploads/ticket.png?sig=abc")
        == "https://vkx-api-integration.preview.emergentagent.com/uploads/ticket.png?sig=abc"
    )
    assert (
        server_mod._normalise_pcstore_attachment_url("https://vkx-api-integration.preview.emergentagent.com/uploads/ticket.png")
        == "https://vkx-api-integration.preview.emergentagent.com/uploads/ticket.png"
    )


def test_attachment_proxy_malformed_url_is_rejected_as_http_exception(monkeypatch):
    """Malformed URL should be safely rejected instead of bubbling parser errors."""
    monkeypatch.setenv("PCSTORE_URL", "https://vkx-api-integration.preview.emergentagent.com")
    try:
        server_mod._normalise_pcstore_attachment_url("https://[::1")
    except HTTPException:
        return
    except Exception as exc:
        pytest.fail(f"Malformed URL raised unexpected exception type: {type(exc).__name__}")
    pytest.fail("Malformed URL should not pass normalization")


@pytest.mark.anyio
async def test_attachment_proxy_fetch_uses_server_secret_accept_header_and_no_redirects(monkeypatch):
    """Upstream fetch must send server-side secret and disable redirects."""
    captured = {}

    def _fake_client_factory(**kwargs):
        captured["client_kwargs"] = kwargs
        return _FakeClient(captured, _FakeResponse())

    monkeypatch.setattr(server_mod.httpx, "AsyncClient", _fake_client_factory)
    content, content_type = await server_mod._fetch_pcstore_attachment(
        "https://vkx-api-integration.preview.emergentagent.com/uploads/ticket.png"
    )
    assert content == b"png-bytes"
    assert content_type == "image/png"
    assert captured["url"].endswith("/uploads/ticket.png")
    assert captured["headers"]["X-PCStore-Secret"] == os.environ["PCADMIN_INTERNAL_SECRET"]
    assert captured["headers"]["Accept"]
    assert captured["client_kwargs"]["follow_redirects"] is False


@pytest.mark.anyio
@pytest.mark.parametrize(
    "response, expected_status",
    [
        (_FakeResponse(content_type="text/html"), 415),
        (_FakeResponse(headers={"content-length": "not-a-number"}), 502),
        (_FakeResponse(headers={"content-length": str((8 * 1024 * 1024) + 1)}), 413),
        (_FakeResponse(content=b"x" * ((8 * 1024 * 1024) + 1)), 413),
        (_FakeResponse(status_code=500), 502),
        (_FakeResponse(status_code=404), 404),
    ],
)
async def test_attachment_proxy_fetch_rejects_invalid_upstream_responses(monkeypatch, response, expected_status):
    """Upstream response validation: status/content-type/size bounds."""
    monkeypatch.setattr(server_mod.httpx, "AsyncClient", lambda **_kwargs: _FakeClient({}, response))
    with pytest.raises(HTTPException) as error:
        await server_mod._fetch_pcstore_attachment(
            "https://vkx-api-integration.preview.emergentagent.com/uploads/invalid.png"
        )
    assert error.value.status_code == expected_status


@pytest.mark.anyio
async def test_attachment_proxy_route_returns_inline_or_attachment_disposition(monkeypatch):
    """Route should set inline vs forced download content-disposition correctly."""
    ticket_id = f"ticket-{uuid.uuid4().hex[:10]}"
    message_id = f"msg-{uuid.uuid4().hex[:8]}"
    ticket_doc = {
        "id": ticket_id,
        "customer_name": "Customer",
        "customer_email": "customer@example.com",
        "subject": "Attachment",
        "status": "open",
        "unread": False,
        "created_at": "2026-02-01T00:00:00+00:00",
        "updated_at": "2026-02-01T00:00:00+00:00",
        "last_message_at": "2026-02-01T00:00:00+00:00",
        "messages": [
            {
                "id": message_id,
                "direction": "inbound",
                "body": "Please see attachment",
                "attachments": ["/uploads/ticket-image.png"],
                "created_at": "2026-02-01T00:00:00+00:00",
                "author_name": "Customer",
                "author_email": "customer@example.com",
            }
        ],
    }

    monkeypatch.setattr(server_mod, "db", _FakeDb(ticket_doc))
    monkeypatch.setattr(
        server_mod,
        "_fetch_pcstore_attachment",
        lambda _url: __import__("asyncio").sleep(0, result=(b"mock-image", "image/png")),
    )

    inline_response = await server_mod.proxy_support_ticket_attachment(
        ticket_id,
        message_id,
        0,
        download=False,
        current_admin={"id": "admin", "role": "admin"},
    )
    assert inline_response.headers["Content-Disposition"] == "inline"

    download_response = await server_mod.proxy_support_ticket_attachment(
        ticket_id,
        message_id,
        0,
        download=True,
        current_admin={"id": "admin", "role": "admin"},
    )
    assert download_response.headers["Content-Disposition"].startswith("attachment;")


def test_attachment_proxy_route_requires_admin_session_even_with_shared_secret_header():
    """Browser calls without admin session must not be authorized by shared secret header."""
    ticket_id = "ticket-does-not-matter"
    message_id = "message-does-not-matter"
    url = f"/api/support/tickets/{ticket_id}/messages/{message_id}/attachments/0/image"
    client = TestClient(server_mod.app)

    no_auth = client.get(url)
    assert no_auth.status_code in {401, 403}

    with_secret_header = client.get(
        url,
        headers={"X-PCStore-Secret": os.environ.get("PCADMIN_INTERNAL_SECRET", "placeholder")},
    )
    assert with_secret_header.status_code in {401, 403}