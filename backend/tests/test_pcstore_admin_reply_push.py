"""Mock-only coverage for PCAdmin's post-save PCStore reply push."""
import os
import sys

import pytest


sys.path.insert(0, "/app/backend")
import server as server_mod
from models import SupportTicketReplyBody


class _FakeResponse:
    def __init__(self, status_code): self.status_code = status_code


class _FakeClient:
    def __init__(self, captured, status_code): self.captured, self.status_code = captured, status_code
    async def __aenter__(self): return self
    async def __aexit__(self, *_args): return False
    async def post(self, url, headers, json):
        self.captured.update({"url": url, "headers": headers, "json": json})
        return _FakeResponse(self.status_code)


@pytest.mark.anyio
async def test_admin_reply_push_uses_pcstore_url_secret_and_exact_payload(monkeypatch):
    captured = {}
    monkeypatch.setattr(server_mod.httpx, "AsyncClient", lambda **_kwargs: _FakeClient(captured, 200))
    assert await server_mod._push_admin_reply_to_pcstore("ticket / 42", "Saved reply", "2026-10-11T10:30:00+00:00") is True
    assert captured["url"].endswith("/api/support/my-tickets/ticket%20%2F%2042/admin-reply")
    assert captured["headers"]["X-PCStore-Secret"] == os.environ["PCADMIN_INTERNAL_SECRET"]
    assert captured["json"] == {"message": "Saved reply", "author": "Support Team", "timestamp": "2026-10-11T10:30:00Z"}


@pytest.mark.anyio
async def test_admin_reply_push_non_200_is_non_blocking(monkeypatch):
    monkeypatch.setattr(server_mod.httpx, "AsyncClient", lambda **_kwargs: _FakeClient({}, 502))
    assert await server_mod._push_admin_reply_to_pcstore("ticket-42", "Saved reply", "2026-10-11T10:30:00+00:00") is False


class _RaisingClient:
    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return False

    async def post(self, *_args, **_kwargs):
        raise server_mod.httpx.ConnectError("boom")


@pytest.mark.anyio
async def test_admin_reply_push_network_error_is_non_blocking_and_secret_not_logged(monkeypatch, caplog):
    monkeypatch.setattr(server_mod.httpx, "AsyncClient", lambda **_kwargs: _RaisingClient())
    result = await server_mod._push_admin_reply_to_pcstore("ticket-42", "Saved reply", "2026-10-11T10:30:00+00:00")
    assert result is False
    # Ensure we never leak the shared secret into log output.
    shared_secret = os.environ.get("PCADMIN_INTERNAL_SECRET", "")
    if shared_secret:
        assert shared_secret not in caplog.text


class _FakeSupportMessages:
    def __init__(self, calls):
        self.calls = calls

    async def update_one(self, *_args, **_kwargs):
        self.calls.append("mongo_update")
        return None


@pytest.mark.anyio
async def test_admin_reply_route_saves_then_pushes_even_when_push_fails(monkeypatch):
    calls = []

    async def fake_get_ticket(ticket_id, mark_read=True):
        assert ticket_id == "ticket-42"
        assert mark_read is True
        return {
            "id": "ticket-42",
            "subject": "Need help",
            "customer_email": "buyer@example.com",
        }

    async def fake_send_managed_email(*, to, subject, html):
        assert to == "buyer@example.com"
        assert subject.startswith("Re: ")
        assert "Reply to your support request" in html
        calls.append("email")
        return "mock-delivery-id"

    async def fake_push(ticket_id, message, timestamp):
        assert ticket_id == "ticket-42"
        assert message == "Saved reply"
        assert isinstance(timestamp, str)
        calls.append("pcstore_push")
        return False

    monkeypatch.setattr(server_mod, "_get_support_ticket", fake_get_ticket)
    monkeypatch.setattr(server_mod, "send_managed_email", fake_send_managed_email)
    monkeypatch.setattr(server_mod, "_push_admin_reply_to_pcstore", fake_push)
    monkeypatch.setattr(server_mod.db, "support_messages", _FakeSupportMessages(calls))

    response = await server_mod.reply_to_support_ticket(
        "ticket-42",
        SupportTicketReplyBody(body="Saved reply", attachments=[]),
        {"id": "admin-1", "name": "Agent", "email": "agent@example.com", "role": "admin"},
    )

    assert response["ok"] is True
    assert response["delivery_id"] == "mock-delivery-id"
    assert response["message"]["body"] == "Saved reply"
    # Critical order: email + Mongo save happen before best-effort PCStore push.
    assert calls == ["email", "mongo_update", "pcstore_push"]


@pytest.mark.anyio
async def test_sync_reply_endpoint_keeps_email_sent_false(monkeypatch):
    calls = []

    async def fake_get_ticket(ticket_id, mark_read=True):
        assert ticket_id == "legacy-ticket"
        calls.append("get_ticket")
        return {"id": "legacy-ticket", "subject": "Legacy", "customer_email": "buyer@example.com"}

    monkeypatch.setattr(server_mod, "_get_support_ticket", fake_get_ticket)
    monkeypatch.setattr(server_mod.db, "support_messages", _FakeSupportMessages(calls))

    response = await server_mod.sync_support_ticket_reply(
        "legacy-ticket",
        SupportTicketReplyBody(body="Mirror-only", attachments=[]),
        {"via": "pcstore", "admin": None},
    )

    assert response["ok"] is True
    assert response["email_sent"] is False
    assert calls == ["get_ticket", "mongo_update"]