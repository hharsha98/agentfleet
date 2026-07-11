"""Tests for P7b budgets: upsert/clear via the API, enforcement via
check_budget, and that the usage summary picks up the seeded message.

Same single-event-loop httpx.AsyncClient + ASGITransport pattern as
test_evals.py / test_publish.py (see those files' docstrings for why —
asyncpg connections are bound to the event loop that created them).
Deliberately does NOT call the chat/stream endpoint — that hits the real
LLM provider. Message rows are inserted directly instead.
"""

import uuid

from httpx import ASGITransport, AsyncClient

from app.db import SessionLocal, engine
from app.main import app
from app.models import Conversation, Message
from app.services.budget import check_budget


async def test_budget_upsert_enforcement_and_usage_summary() -> None:
    # Dispose first so every connection this test's pool hands out is
    # created fresh on THIS test's event loop — same reasoning as
    # test_evals.py's module docstring.
    await engine.dispose()
    created_ids: list[str] = []

    try:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            agent_res = await client.post(
                "/api/v1/agents",
                json={
                    "slug": "test-budgets-agent",
                    "name": "Test Budgets Agent",
                    "description": "Created by test_budgets.py",
                    "system_prompt": "You are a test agent.",
                    "tools": [],
                },
            )
            assert agent_res.status_code == 201, agent_res.text
            agent = agent_res.json()
            created_ids.append(agent["id"])
            agent_id = uuid.UUID(agent["id"])

            # --- PUT budget: token limit 10 ---
            put_res = await client.put(
                "/api/v1/budgets",
                json={"agent_id": agent["id"], "daily_token_limit": 10, "daily_usd_limit": None},
            )
            assert put_res.status_code == 200, put_res.text
            put_body = put_res.json()
            assert put_body["ok"] is True
            assert put_body["budget"]["daily_token_limit"] == 10
            assert put_body["budget"]["agent_slug"] == "test-budgets-agent"

            # --- list shows it ---
            list_res = await client.get("/api/v1/budgets")
            assert list_res.status_code == 200
            assert any(
                b["agent_id"] == agent["id"] and b["daily_token_limit"] == 10
                for b in list_res.json()
            )

            # --- seed a Conversation + assistant Message directly (16 tokens > limit 10) ---
            async with SessionLocal() as session:
                conversation = Conversation(agent_id=agent_id, title="test-budgets convo")
                session.add(conversation)
                await session.commit()
                await session.refresh(conversation)

                session.add(
                    Message(
                        conversation_id=conversation.id,
                        role="assistant",
                        content="hello",
                        tokens_in=8,
                        tokens_out=8,
                        cost_usd=0,
                    )
                )
                await session.commit()

            # --- check_budget: violation expected (16 >= 10) ---
            async with SessionLocal() as session:
                violation = await check_budget(session, agent_id)
            assert violation is not None
            assert "token" in violation.lower()

            # --- PUT budget: both limits null -> removes the row ---
            clear_res = await client.put(
                "/api/v1/budgets",
                json={"agent_id": agent["id"], "daily_token_limit": None, "daily_usd_limit": None},
            )
            assert clear_res.status_code == 200, clear_res.text
            assert clear_res.json() == {"ok": True, "budget": None}

            list_after_res = await client.get("/api/v1/budgets")
            assert list_after_res.status_code == 200
            assert all(b["agent_id"] != agent["id"] for b in list_after_res.json())

            # --- check_budget: no budget row left -> None ---
            async with SessionLocal() as session:
                violation_after = await check_budget(session, agent_id)
            assert violation_after is None

            # --- 404 when agent doesn't exist ---
            missing_res = await client.put(
                "/api/v1/budgets",
                json={
                    "agent_id": "00000000-0000-0000-0000-000000000000",
                    "daily_token_limit": 5,
                    "daily_usd_limit": None,
                },
            )
            assert missing_res.status_code == 404

            # --- usage summary includes the agent and today's tokens ---
            summary_res = await client.get("/api/v1/usage/summary")
            assert summary_res.status_code == 200
            summary_body = summary_res.json()
            assert "today" in summary_body and "per_agent" in summary_body
            assert summary_body["today"]["tokens"] >= 16
            assert any(a["agent_slug"] == "test-budgets-agent" for a in summary_body["per_agent"])

            # Cleanup.
            for agent_id_to_delete in list(created_ids):
                del_res = await client.delete(f"/api/v1/agents/{agent_id_to_delete}")
                assert del_res.status_code == 200
                created_ids.remove(agent_id_to_delete)
    finally:
        if created_ids:
            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test"
            ) as client:
                for agent_id_to_delete in created_ids:
                    await client.delete(f"/api/v1/agents/{agent_id_to_delete}")
        await engine.dispose()
