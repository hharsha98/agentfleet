"""Tests for Phase 12 C: per-user (else per-IP) rate limiting (app/ratelimit.py
+ its wiring in main.py / routes/chat.py). Hermetic — always runs against a
fresh in-memory `limits` storage, never the real Redis this process may
have picked up at import time (see `_use_memory_storage` below), and never
a live LLM (the chat route's runner is monkeypatched to a fake SSE
generator, same pattern as tests/test_pydantic_runtime.py).

tests/conftest.py sets RATE_LIMIT_DISABLED=1 for the whole session so the
~30 other test files (many of which reuse the same DEFAULT_TEST_EMAIL
across dozens of calls) never trip a real limit. Every test here re-enables
the limiter explicitly via monkeypatch — nothing here relies on, or
permanently changes, that session-wide default.
"""

import uuid

from httpx import ASGITransport, AsyncClient
from limits.storage import MemoryStorage

import app.ratelimit as ratelimit
import app.routes.chat as chat_routes
from app.config import get_settings
from app.db import SessionLocal, engine
from app.main import app
from app.models import Agent, Conversation
from tests.conftest import mint_token


def _use_memory_storage(monkeypatch) -> None:
    """Swap the module-level limiter singleton onto a fresh MemoryStorage
    and turn it on, regardless of RATE_LIMIT_DISABLED / whatever storage it
    picked at process startup (real Redis, if reachable locally). Reverted
    automatically by monkeypatch at test teardown."""
    storage = MemoryStorage()
    monkeypatch.setattr(ratelimit.limiter, "_storage", storage)
    monkeypatch.setattr(ratelimit.limiter, "_limiter", type(ratelimit.limiter._limiter)(storage))
    monkeypatch.setattr(ratelimit.limiter, "enabled", True)


async def _fake_stream(conversation_id, user_text):
    """Stand-in for stream_chat_graph: no LLM call, just a valid SSE
    token+done pair — the rate limit check happens in the decorator before
    this ever runs, so its content doesn't matter for these tests."""
    yield 'data: {"type": "token", "content": "ok"}\n\n'
    yield (
        'data: {"type": "done", "usage": '
        '{"tokens_in": 0, "tokens_out": 0, "cost_usd": 0, "latency_ms": 0}}\n\n'
    )


async def _make_agent_and_conversation() -> tuple[uuid.UUID, uuid.UUID]:
    async with SessionLocal() as session:
        agent = Agent(
            slug=f"test-ratelimit-{uuid.uuid4().hex[:8]}",
            name="Rate Limit Test Agent",
            description="",
            system_prompt="You are terse.",
            model="test-model",
            tools=[],
        )
        session.add(agent)
        await session.flush()
        conversation = Conversation(agent_id=agent.id)
        session.add(conversation)
        await session.commit()
        return agent.id, conversation.id


async def _cleanup(agent_ids: list[uuid.UUID]) -> None:
    async with SessionLocal() as session:
        for aid in agent_ids:
            row = await session.get(Agent, aid)
            if row:
                await session.delete(row)  # cascades to conversations/messages
        await session.commit()
    await engine.dispose()


async def test_third_chat_send_hits_429_with_retry_after(monkeypatch) -> None:
    monkeypatch.setattr(chat_routes, "stream_chat_graph", _fake_stream)
    _use_memory_storage(monkeypatch)
    monkeypatch.setattr(get_settings(), "rate_limit_chat", "2/minute")

    agent_id, conversation_id = await _make_agent_and_conversation()
    await engine.dispose()

    token = mint_token(email=f"ratelimit-solo-{uuid.uuid4().hex[:8]}@agentfleet.test")
    headers = {"Authorization": f"Bearer {token}"}

    try:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test", headers=headers
        ) as client:
            res1 = await client.post(
                f"/api/v1/conversations/{conversation_id}/messages", json={"content": "hi 1"}
            )
            res2 = await client.post(
                f"/api/v1/conversations/{conversation_id}/messages", json={"content": "hi 2"}
            )
            res3 = await client.post(
                f"/api/v1/conversations/{conversation_id}/messages", json={"content": "hi 3"}
            )

        assert res1.status_code == 200, res1.text
        assert res2.status_code == 200, res2.text
        assert res3.status_code == 429, res3.text
        assert "Retry-After" in res3.headers
        assert int(res3.headers["Retry-After"]) > 0
        assert "rate limit" in res3.json()["detail"].lower()
    finally:
        await _cleanup([agent_id])


async def test_different_users_do_not_share_a_bucket(monkeypatch) -> None:
    monkeypatch.setattr(chat_routes, "stream_chat_graph", _fake_stream)
    _use_memory_storage(monkeypatch)
    monkeypatch.setattr(get_settings(), "rate_limit_chat", "2/minute")

    agent_id, conversation_id = await _make_agent_and_conversation()
    await engine.dispose()

    token_a = mint_token(email=f"ratelimit-a-{uuid.uuid4().hex[:8]}@agentfleet.test")
    token_b = mint_token(email=f"ratelimit-b-{uuid.uuid4().hex[:8]}@agentfleet.test")

    try:
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://test",
            headers={"Authorization": f"Bearer {token_a}"},
        ) as client_a, AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://test",
            headers={"Authorization": f"Bearer {token_b}"},
        ) as client_b:
            # User A uses up their 2/minute bucket.
            a1 = await client_a.post(
                f"/api/v1/conversations/{conversation_id}/messages", json={"content": "a1"}
            )
            a2 = await client_a.post(
                f"/api/v1/conversations/{conversation_id}/messages", json={"content": "a2"}
            )
            a3 = await client_a.post(
                f"/api/v1/conversations/{conversation_id}/messages", json={"content": "a3"}
            )
            assert a1.status_code == 200, a1.text
            assert a2.status_code == 200, a2.text
            assert a3.status_code == 429, a3.text

            # User B, same conversation/endpoint, fresh bucket -> unaffected.
            b1 = await client_b.post(
                f"/api/v1/conversations/{conversation_id}/messages", json={"content": "b1"}
            )
            assert b1.status_code == 200, b1.text
    finally:
        await _cleanup([agent_id])


async def test_rate_limit_disabled_switch_bypasses_limiting(monkeypatch) -> None:
    monkeypatch.setattr(chat_routes, "stream_chat_graph", _fake_stream)
    _use_memory_storage(monkeypatch)
    monkeypatch.setattr(get_settings(), "rate_limit_chat", "2/minute")
    # Flip back OFF after _use_memory_storage turned it on above — this is
    # the actual thing under test.
    monkeypatch.setattr(ratelimit.limiter, "enabled", False)

    agent_id, conversation_id = await _make_agent_and_conversation()
    await engine.dispose()

    token = mint_token(email=f"ratelimit-disabled-{uuid.uuid4().hex[:8]}@agentfleet.test")
    headers = {"Authorization": f"Bearer {token}"}

    try:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test", headers=headers
        ) as client:
            responses = [
                await client.post(
                    f"/api/v1/conversations/{conversation_id}/messages",
                    json={"content": f"msg {i}"},
                )
                for i in range(5)  # well past the 2/minute limit that's "on the books"
            ]
        assert all(r.status_code == 200 for r in responses), [r.status_code for r in responses]
    finally:
        await _cleanup([agent_id])


def test_limit_getters_read_from_live_settings(monkeypatch) -> None:
    """chat_limit/upload_limit/public_limit must be re-evaluated per call
    (not baked in at import time) — this is what lets the tests above use a
    tiny limit via monkeypatched Settings in the first place."""
    monkeypatch.setattr(get_settings(), "rate_limit_chat", "7/second")
    monkeypatch.setattr(get_settings(), "rate_limit_upload", "8/second")
    monkeypatch.setattr(get_settings(), "rate_limit_public", "9/second")
    assert ratelimit.chat_limit() == "7/second"
    assert ratelimit.upload_limit() == "8/second"
    assert ratelimit.public_limit() == "9/second"
