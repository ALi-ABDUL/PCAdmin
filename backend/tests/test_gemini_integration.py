"""Gemini integration tests with fake storage and a fake LLM stream only."""
import asyncio
import sys

import pytest
from fastapi import HTTPException

sys.path.insert(0, "/app/backend")
import server  # noqa: E402
from models import GeminiSettingsUpdate, ProductDescriptionRewriteBody  # noqa: E402


def _run(coro):
    return asyncio.run(coro)


class _Collection:
    def __init__(self, document=None):
        self.document = document
        self.inserted = []

    async def find_one(self, _query, _projection=None):
        return dict(self.document) if self.document else None

    async def insert_one(self, document):
        self.document = dict(document)
        self.inserted.append(dict(document))

    async def update_one(self, _query, update, upsert=False):
        if self.document is None:
            self.document = {"id": "singleton"}
        self.document.update(update.get("$setOnInsert", {}))
        self.document.update(update.get("$set", {}))


class _Db:
    def __init__(self, gemini=None):
        self.gemini_settings = _Collection(gemini)
        self.ai_rewrite_history = _Collection()


def test_gemini_settings_mask_key_and_persist_selected_model(monkeypatch):
    fake_db = _Db()
    monkeypatch.setattr(server, "db", fake_db)

    saved = _run(server.update_gemini_integration(
        GeminiSettingsUpdate(api_key="AIza-private-value", model="gemini-2.0-flash"),
        current_admin={"id": "admin-1"},
    ))

    assert saved["model"] == "gemini-2.0-flash"
    assert saved["api_key_set"] is True
    assert "private-value" not in str(saved)
    assert fake_db.gemini_settings.document["api_key"] == "AIza-private-value"
    public = _run(server.get_gemini_integration(current_admin={"id": "admin-1"}))
    assert "api_key" not in public
    assert public["status"] == "connected"


def test_rewrite_returns_requested_no_key_message(monkeypatch):
    monkeypatch.setattr(server, "db", _Db({"id": "singleton", "api_key": "", "model": "gemini-2.5-flash"}))

    with pytest.raises(HTTPException) as error:
        _run(server.rewrite_product_description(
            ProductDescriptionRewriteBody(description="<p>Existing copy</p>", product_title="Lamp"),
            current_admin={"id": "admin-1"},
        ))

    assert error.value.status_code == 400
    assert error.value.detail == "Configure Gemini API in Integrations to use AI Rewrite."


def test_rewrite_stream_uses_saved_model_without_external_call(monkeypatch):
    fake_db = _Db({"id": "singleton", "api_key": "AIza-test-key", "model": "gemini-2.0-flash"})
    captured = {}

    class FakeDelta:
        def __init__(self, content): self.content = content

    class FakeDone: pass

    class FakeChat:
        def __init__(self, **kwargs): captured.update(kwargs)
        def with_model(self, provider, model): captured["provider"] = provider; captured["model"] = model; return self
        async def stream_message(self, _message):
            yield FakeDelta("<p>Professional copy</p>")
            yield FakeDone()

    async def consume(response):
        chunks = [chunk async for chunk in response.body_iterator]
        return "".join(chunk.decode() if isinstance(chunk, bytes) else chunk for chunk in chunks)

    monkeypatch.setattr(server, "db", fake_db)
    monkeypatch.setattr(server, "LlmChat", FakeChat)
    monkeypatch.setattr(server, "TextDelta", FakeDelta)
    monkeypatch.setattr(server, "StreamDone", FakeDone)
    response = _run(server.rewrite_product_description(
        ProductDescriptionRewriteBody(description="<p>Old copy</p>", product_title="Lamp"),
        current_admin={"id": "admin-1"},
    ))
    stream = _run(consume(response))

    assert captured["provider"] == "gemini"
    assert captured["model"] == "gemini-2.0-flash"
    assert "Professional copy" in stream
    assert fake_db.ai_rewrite_history.document["status"] == "completed"
    assert fake_db.ai_rewrite_history.document["output"] == "<p>Professional copy</p>"