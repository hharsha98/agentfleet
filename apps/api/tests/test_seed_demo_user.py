"""Tests for scripts/seed_demo_user.py — the public-demo identity's seed +
its budget enforcement (see that module's docstring for the "why" and the
"BUDGET SHAPE" reasoning: the demo identity's cap is the GLOBAL budget row,
since app.models.Budget has no user_id column to scope a cap per-user).

Two things this file proves:
  1. `_seed()` is idempotent and converges the GLOBAL budget row to the
     module's declared caps, without touching an unrelated agent-scoped
     budget.
  2. A request that exceeds those caps is rejected through the SAME path
     every other budget violation uses (services.chat.stream_chat's SSE
     "error" event / services.budget.check_budget), and the message it
     gets is the legible one — states the cap, says it resets, and says
     this is a real limit rather than a broken demo — not a generic
     failure.

Same single-event-loop pattern as test_budgets.py / test_chat.py: this
suite's asyncpg connections are bound to whichever event loop created them,
so every test disposes app.db.engine before (and, for stream_chat, relies
on tests/conftest.py's autouse per-test truncate to keep the databases
clean rather than doing it here).
"""

import json
import uuid

from sqlalchemy import select

from app.db import SessionLocal, engine
from app.models import Agent, Budget, Conversation, Message, User
from app.services.budget import check_budget
from app.services.chat import stream_chat
from scripts.seed_demo_user import (
    DEMO_DAILY_TOKEN_LIMIT,
    DEMO_DAILY_USD_LIMIT,
    DEMO_EMAIL,
    DEMO_USER_ID,
    _seed,
)


async def _make_agent(slug: str) -> uuid.UUID:
    async with SessionLocal() as session:
        agent = Agent(
            slug=slug,
            name="Seed Demo User Test Agent",
            description="Created by test_seed_demo_user.py",
            system_prompt="You are a test agent.",
            model="test-model",
        )
        session.add(agent)
        await session.commit()
        await session.refresh(agent)
        return agent.id


async def _make_conversation(agent_id: uuid.UUID) -> uuid.UUID:
    async with SessionLocal() as session:
        conversation = Conversation(agent_id=agent_id, title="demo budget test conversation")
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


async def test_seed_is_idempotent_and_sets_global_budget() -> None:
    await engine.dispose()
    async with SessionLocal() as session:
        first = await _seed(session)
    assert first == {"user": True, "budget": True}

    # Re-running must not create a second row of either kind, and must
    # converge the budget back to the declared caps even if something else
    # had since changed it (the "creates/updates" contract).
    async with SessionLocal() as session:
        budget = (
            await session.execute(select(Budget).where(Budget.agent_id.is_(None)))
        ).scalar_one()
        budget.daily_token_limit = 999
        budget.daily_usd_limit = 999
        await session.commit()

    async with SessionLocal() as session:
        second = await _seed(session)
    assert second == {"user": False, "budget": False}

    async with SessionLocal() as session:
        user = (await session.execute(select(User).where(User.email == DEMO_EMAIL))).scalar_one()
        assert user.id == DEMO_USER_ID
        assert user.email == DEMO_EMAIL

        budgets = (
            (await session.execute(select(Budget).where(Budget.agent_id.is_(None)))).scalars().all()
        )
        assert len(budgets) == 1  # never duplicated
        assert budgets[0].daily_token_limit == DEMO_DAILY_TOKEN_LIMIT
        assert float(budgets[0].daily_usd_limit) == DEMO_DAILY_USD_LIMIT
    await engine.dispose()


async def test_seed_keeps_existing_id_if_user_already_auto_created() -> None:
    """If app.auth._get_or_create_user already created demo@agentfleet.local
    (random uuid4 id) before this script ever ran — e.g. a visitor hit the
    API before an operator ran the seed — `_seed()` must adopt that row
    rather than fail on the unique-email constraint."""
    await engine.dispose()
    pre_existing_id = uuid.uuid4()
    async with SessionLocal() as session:
        session.add(User(id=pre_existing_id, email=DEMO_EMAIL, name="Whatever auth.py set"))
        await session.commit()

    async with SessionLocal() as session:
        result = await _seed(session)
    assert result["user"] is False  # adopted, not inserted

    async with SessionLocal() as session:
        user = (await session.execute(select(User).where(User.email == DEMO_EMAIL))).scalar_one()
        assert user.id == pre_existing_id
    await engine.dispose()


async def test_capped_demo_traffic_is_rejected_with_legible_message() -> None:
    """End-to-end through the real enforcement path: seed the demo caps,
    blow past the GLOBAL token budget with a single oversized assistant
    message (any agent — the demo identity has no per-agent budget, only
    the global one), then confirm BOTH the low-level check_budget() call
    AND a real stream_chat() turn reject it with the same legible message
    (cap number, "resets", "not a broken demo") rather than a generic
    failure.
    """
    await engine.dispose()
    async with SessionLocal() as session:
        await _seed(session)

    agent_id = await _make_agent(f"demo-budget-test-{uuid.uuid4().hex[:8]}")
    try:
        conversation_id = await _make_conversation(agent_id)

        async with SessionLocal() as session:
            session.add(
                Message(
                    conversation_id=conversation_id,
                    role="assistant",
                    content="blows the global demo budget",
                    tokens_in=DEMO_DAILY_TOKEN_LIMIT,
                    tokens_out=1,
                    cost_usd=0,
                )
            )
            await session.commit()

        # --- low-level enforcement primitive ---
        async with SessionLocal() as session:
            violation = await check_budget(session, agent_id)
        assert violation is not None
        assert "token" in violation.lower()
        assert f"{DEMO_DAILY_TOKEN_LIMIT:,}" in violation
        assert "resets at 00:00 UTC" in violation
        assert "not a broken demo" in violation

        # --- the real user-facing path: a chat turn against this agent,
        # rejected BEFORE any provider call (no LLM mock needed — see
        # services/chat.py::stream_chat, check_budget runs first) ---
        frames = [frame async for frame in stream_chat(conversation_id, "hello")]
        assert len(frames) == 1
        payload = json.loads(frames[0].removeprefix("data: ").strip())
        assert payload["type"] == "error"
        assert "resets at 00:00 UTC" in payload["message"]
        assert "not a broken demo" in payload["message"]
    finally:
        await _cleanup(agent_id)
