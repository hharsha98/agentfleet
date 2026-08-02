"""Hermetic tests for the Pydantic AI runtime (Phase 10 M):
services/pydantic_runtime.py and its dispatch point in routes/chat.py.

No live LLM proxy is used anywhere here — CI has none, and the happy-path
test doesn't need one: pydantic_ai ships its own offline TestModel (no
network, deterministic output), and the provider-error / dispatch tests
monkeypatch build_pydantic_agent / the runtime functions themselves, the
same monkeypatch-the-client-getter pattern test_playground.py uses.
"""

import json
import uuid

from httpx import ASGITransport, AsyncClient
from pydantic_ai import Agent as PydanticAgent
from pydantic_ai.exceptions import ModelHTTPError
from pydantic_ai.models.test import TestModel

import app.routes.chat as chat_routes
import app.services.pydantic_runtime as pydantic_runtime
from app.db import SessionLocal, engine
from app.main import app
from app.models import Agent, Conversation


def _parse_sse(text: str) -> list[dict]:
    events = []
    for block in text.strip().split("\n\n"):
        block = block.strip()
        if not block:
            continue
        assert block.startswith("data: ")
        events.append(json.loads(block[len("data: ") :]))
    return events


async def _make_agent_and_conversation(*, runtime: str) -> tuple[uuid.UUID, uuid.UUID]:
    """Insert a throwaway agent + conversation directly (bypassing the API,
    like test_playground.py's experiment fixtures) and return plain (id, id)
    values — not ORM instances — so callers don't touch an expired/closed
    session's attributes after this function returns."""
    async with SessionLocal() as session:
        agent = Agent(
            slug=f"test-pydantic-{uuid.uuid4().hex[:8]}",
            name="Test Pydantic Agent",
            description="",
            system_prompt="You are terse.",
            model="test-model",
            tools=[],
            runtime=runtime,
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


async def test_pydantic_runtime_happy_path_streams_tokens_and_done(monkeypatch) -> None:
    """A turn through stream_chat_pydantic emits token events plus a final
    done event carrying the usage dict — the same SSE shape graph_runtime
    emits. build_pydantic_agent is swapped for one wired to pydantic_ai's
    offline TestModel so this never touches a network or the LLM proxy."""

    def _fake_build(agent_row, base_url, api_key, user_id=None):
        return PydanticAgent(
            TestModel(custom_output_text="Paris is the capital of France."),
            system_prompt=agent_row.system_prompt,
        )

    monkeypatch.setattr(pydantic_runtime, "build_pydantic_agent", _fake_build)

    agent_id, conversation_id = await _make_agent_and_conversation(runtime="pydantic-ai")
    await engine.dispose()

    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            res = await client.post(
                f"/api/v1/conversations/{conversation_id}/messages",
                json={"content": "What is the capital of France?"},
            )
        assert res.status_code == 200, res.text
        events = _parse_sse(res.text)
        types = [e["type"] for e in events]

        assert "token" in types
        assert types[-1] == "done"
        usage = events[-1]["usage"]
        assert usage["tokens_in"] >= 0
        assert usage["tokens_out"] >= 0
        assert usage["cost_usd"] >= 0
        assert usage["latency_ms"] >= 0
    finally:
        await _cleanup([agent_id])


async def test_pydantic_runtime_provider_error_yields_error_event_not_exception(monkeypatch) -> None:
    """If the model provider fails (auth, rate-limit, malformed response —
    all surface as pydantic_ai.exceptions.AgentRunError subclasses), the
    turn must end with a sanitized `error` SSE frame, never an unhandled
    exception reaching the ASGI layer."""

    def _raise_build(agent_row, base_url, api_key, user_id=None):
        raise ModelHTTPError(status_code=500, model_name=agent_row.model, body={"error": "boom"})

    monkeypatch.setattr(pydantic_runtime, "build_pydantic_agent", _raise_build)

    agent_id, conversation_id = await _make_agent_and_conversation(runtime="pydantic-ai")
    await engine.dispose()

    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            res = await client.post(
                f"/api/v1/conversations/{conversation_id}/messages",
                json={"content": "hello"},
            )
        assert res.status_code == 200, res.text  # SSE endpoint always 200; failure is in-stream
        events = _parse_sse(res.text)
        assert events[-1]["type"] == "error"
        assert "ModelHTTPError" in events[-1]["message"]
        assert not any(e["type"] == "done" for e in events)
    finally:
        await _cleanup([agent_id])


async def test_chat_route_dispatches_by_agent_runtime(monkeypatch) -> None:
    """routes/chat.py's send_message picks stream_chat_pydantic when
    agent.runtime == "pydantic-ai" and stream_chat_graph otherwise (default
    Settings.agent_runtime == "langgraph") — the one dispatch point the
    spec calls for. Both runtimes are replaced with marker fakes so this
    test is about routing only, not either runtime's internals."""

    async def _fake_pydantic(conversation_id, user_text):
        yield 'data: {"type": "token", "content": "FROM_PYDANTIC_AI"}\n\n'
        yield (
            'data: {"type": "done", "usage": '
            '{"tokens_in": 0, "tokens_out": 0, "cost_usd": 0, "latency_ms": 0}}\n\n'
        )

    async def _fake_graph(conversation_id, user_text):
        yield 'data: {"type": "token", "content": "FROM_LANGGRAPH"}\n\n'
        yield (
            'data: {"type": "done", "usage": '
            '{"tokens_in": 0, "tokens_out": 0, "cost_usd": 0, "latency_ms": 0}}\n\n'
        )

    monkeypatch.setattr(chat_routes, "stream_chat_pydantic", _fake_pydantic)
    monkeypatch.setattr(chat_routes, "stream_chat_graph", _fake_graph)

    pai_agent_id, pai_conversation_id = await _make_agent_and_conversation(runtime="pydantic-ai")
    lg_agent_id, lg_conversation_id = await _make_agent_and_conversation(runtime="langgraph")
    await engine.dispose()

    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            pai_res = await client.post(
                f"/api/v1/conversations/{pai_conversation_id}/messages",
                json={"content": "hi"},
            )
            lg_res = await client.post(
                f"/api/v1/conversations/{lg_conversation_id}/messages",
                json={"content": "hi"},
            )
        assert "FROM_PYDANTIC_AI" in pai_res.text
        assert "FROM_LANGGRAPH" in lg_res.text
        assert "FROM_LANGGRAPH" not in pai_res.text
        assert "FROM_PYDANTIC_AI" not in lg_res.text
    finally:
        await _cleanup([pai_agent_id, lg_agent_id])
