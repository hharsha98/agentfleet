"""Tests for stream_chat's `model_override` parameter (services/chat.py) —
Layer 2 of the self-healing feature: an escalation attempt must run on a
DIFFERENT (stronger) model than the one that just failed, and that model
must also be what gets metered, or the cost dashboard would silently
misattribute the spend to the agent's default model.

Hermetic: `get_llm_client` is monkeypatched to a fake OpenAI-shaped async
client returning canned streaming chunks — no network, no real model, same
promise as test_orchestrator_self_heal.py.
"""

import uuid
from types import SimpleNamespace

from sqlalchemy import select

from app.db import SessionLocal, engine
from app.models import Agent, Conversation, Message
from app.services import chat as chat_module
from app.services.chat import stream_chat


def _chunk(content: str | None = None, usage: object | None = None):
    """Mimic one OpenAI streaming chunk: a content delta, OR (on the final
    chunk) empty choices carrying usage — same shape services/chat.py
    already handles for the real provider."""
    delta = SimpleNamespace(content=content, tool_calls=None)
    choices = [SimpleNamespace(delta=delta)] if content is not None else []
    return SimpleNamespace(choices=choices, usage=usage)


class _FakeCompletions:
    def __init__(self, chunks: list, captured_kwargs: list[dict]) -> None:
        self._chunks = chunks
        self._captured = captured_kwargs

    async def create(self, **kwargs):
        # Record exactly what stream_chat asked the provider for, so tests
        # can assert which model the CALL used (not just what got stored).
        self._captured.append(kwargs)

        async def _gen():
            for c in self._chunks:
                yield c

        return _gen()


class _FakeClient:
    def __init__(self, chunks: list, captured_kwargs: list[dict]) -> None:
        self.chat = SimpleNamespace(completions=_FakeCompletions(chunks, captured_kwargs))


async def _make_agent(slug: str, model: str) -> uuid.UUID:
    async with SessionLocal() as session:
        agent = Agent(
            slug=slug,
            name="Chat Override Test Agent",
            description="Created by test_chat.py",
            system_prompt="You are a test agent.",
            model=model,
        )
        session.add(agent)
        await session.commit()
        await session.refresh(agent)
        return agent.id


async def _make_conversation(agent_id: uuid.UUID) -> uuid.UUID:
    async with SessionLocal() as session:
        conversation = Conversation(agent_id=agent_id, title="test conversation")
        session.add(conversation)
        await session.commit()
        await session.refresh(conversation)
        return conversation.id


async def _cleanup(agent_id: uuid.UUID) -> None:
    async with SessionLocal() as session:
        agent = await session.get(Agent, agent_id)
        if agent:
            await session.delete(agent)  # cascades to Conversations/Messages
        await session.commit()
    await engine.dispose()


async def _last_assistant_message(conversation_id: uuid.UUID) -> Message:
    async with SessionLocal() as session:
        return (
            await session.execute(
                select(Message)
                .where(Message.conversation_id == conversation_id, Message.role == "assistant")
                .order_by(Message.created_at.desc())
                .limit(1)
            )
        ).scalar_one()


# --- no override: today's behaviour is untouched ----------------------------


async def test_stream_chat_no_override_uses_agent_model(monkeypatch) -> None:
    await engine.dispose()
    agent_id = await _make_agent(f"chat-default-{uuid.uuid4().hex[:8]}", "test-model")
    try:
        conversation_id = await _make_conversation(agent_id)

        captured: list[dict] = []
        chunks = [
            _chunk("hello"),
            _chunk(usage=SimpleNamespace(prompt_tokens=3, completion_tokens=2)),
        ]
        monkeypatch.setattr(chat_module, "get_llm_client", lambda: _FakeClient(chunks, captured))

        frames = [f async for f in stream_chat(conversation_id, "hi")]

        # The provider call used the agent's OWN model — no override passed.
        assert captured[0]["model"] == "test-model"
        message = await _last_assistant_message(conversation_id)
        assert message.model == "test-model"
        assert any('"type": "done"' in f for f in frames)
    finally:
        await _cleanup(agent_id)


# --- override: used for the call AND for metering ---------------------------


async def test_stream_chat_override_used_for_call_and_metering(monkeypatch) -> None:
    await engine.dispose()
    agent_id = await _make_agent(f"chat-override-{uuid.uuid4().hex[:8]}", "test-model")
    try:
        conversation_id = await _make_conversation(agent_id)

        captured: list[dict] = []
        # Big round-number token counts make the cost assertion below
        # unambiguous regardless of PRICES' exact per-token rate.
        chunks = [
            _chunk("hello"),
            _chunk(usage=SimpleNamespace(prompt_tokens=1_000_000, completion_tokens=1_000_000)),
        ]
        monkeypatch.setattr(chat_module, "get_llm_client", lambda: _FakeClient(chunks, captured))

        frames = [
            f
            async for f in stream_chat(conversation_id, "hi", model_override="claude-sonnet-test")
        ]

        # The provider call used the OVERRIDE, not the agent's own model.
        assert captured[0]["model"] == "claude-sonnet-test"

        message = await _last_assistant_message(conversation_id)
        # Metering (the Message row) recorded the OVERRIDE too.
        assert message.model == "claude-sonnet-test"
        # cost_usd() prices by a "claude-sonnet" prefix match -> non-zero;
        # the agent's own "test-model" matches no PRICES prefix and would
        # have cost $0. A non-zero cost here proves metering followed the
        # override, not agent.model.
        assert float(message.cost_usd) > 0

        done_frames = [f for f in frames if '"type": "done"' in f]
        assert done_frames, "expected a done frame"
        assert '"cost_usd"' in done_frames[0]
    finally:
        await _cleanup(agent_id)
