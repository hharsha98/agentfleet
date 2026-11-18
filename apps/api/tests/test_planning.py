"""orchestrator.plan_and_execute: a mission that fails says why (Run.error,
shown on the board), and one unusable planner answer gets a corrective retry
instead of failing the whole mission. Before this, every one of these cases
ended as a bare "failed" with 0 tasks and the reason only in the server log.
"""

import json
import uuid
from types import SimpleNamespace

import httpx
import openai
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.config import get_settings
from app.db import SessionLocal, engine
from app.main import app
from app.models import Agent, Budget, Conversation, Message, Run, RunTask
from app.services import orchestrator
from app.services.llm_errors import NOT_CONFIGURED_MESSAGE

VALID_PLAN = json.dumps(
    {
        "tasks": [
            {
                "title": "Write it",
                "description": "Write a haiku about agents.",
                "agent": "creative-writer",
                "depends_on": [],
                # Parks the run in review, so execute_run needs no LLM call.
                "needs_approval": True,
            }
        ]
    }
)


class FakeClient:
    def __init__(self, *answers):
        self.answers = list(answers)
        self.calls: list[dict] = []
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))

    async def _create(self, **kwargs):
        self.calls.append(kwargs)
        answer = self.answers.pop(0)
        if isinstance(answer, BaseException):
            raise answer
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=answer))])


async def _new_run(goal: str = "Write a haiku about agents") -> uuid.UUID:
    await engine.dispose()
    async with SessionLocal() as session:
        run = Run(goal=goal)
        session.add(run)
        await session.commit()
        return run.id


async def _load(run_id: uuid.UUID):
    async with SessionLocal() as session:
        run = await session.get(Run, run_id)
        tasks = (
            (await session.execute(select(RunTask).where(RunTask.run_id == run_id)))
            .scalars()
            .all()
        )
        return run, tasks


async def test_one_bad_plan_gets_a_corrective_retry(monkeypatch):
    client = FakeClient("Sure! I'd split this into a few steps.", VALID_PLAN)
    monkeypatch.setattr(orchestrator, "get_llm_client", lambda: client)
    run_id = await _new_run()

    await orchestrator.plan_and_execute(run_id)

    run, tasks = await _load(run_id)
    assert run.status == "awaiting_approval"
    assert run.error is None
    assert [t.title for t in tasks] == ["Write it"]
    assert len(client.calls) == 2
    assert client.calls[1]["messages"][-1]["content"] == orchestrator.PLAN_RETRY_PROMPT
    await engine.dispose()


async def test_two_bad_plans_fail_with_a_reason(monkeypatch):
    client = FakeClient("no plan here", "still no plan")
    monkeypatch.setattr(orchestrator, "get_llm_client", lambda: client)
    run_id = await _new_run()

    await orchestrator.plan_and_execute(run_id)

    run, tasks = await _load(run_id)
    assert run.status == "failed"
    assert run.error.startswith("The Orchestrator couldn't turn this goal into a plan")
    assert tasks == []
    await engine.dispose()


async def test_unreachable_provider_fails_with_a_plain_reason(monkeypatch):
    request = httpx.Request("POST", "https://llm.test/v1/chat/completions")
    client = FakeClient(openai.APIConnectionError(request=request))
    monkeypatch.setattr(orchestrator, "get_llm_client", lambda: client)
    run_id = await _new_run()

    await orchestrator.plan_and_execute(run_id)

    run, _ = await _load(run_id)
    assert run.status == "failed"
    assert run.error.startswith("Couldn't reach the AI provider")
    await engine.dispose()


async def test_unconfigured_provider_fails_without_calling_it(monkeypatch):
    client = FakeClient()
    monkeypatch.setattr(orchestrator, "get_llm_client", lambda: client)
    monkeypatch.setattr(get_settings(), "free_llm_base_url", "")
    run_id = await _new_run()

    await orchestrator.plan_and_execute(run_id)

    run, _ = await _load(run_id)
    assert run.status == "failed"
    assert run.error == NOT_CONFIGURED_MESSAGE
    assert client.calls == []
    await engine.dispose()


async def test_exhausted_budget_fails_before_spending_planner_tokens(monkeypatch):
    client = FakeClient()
    monkeypatch.setattr(orchestrator, "get_llm_client", lambda: client)
    await engine.dispose()
    async with SessionLocal() as session:
        agent = (await session.execute(select(Agent).limit(1))).scalar_one()
        conversation = Conversation(agent_id=agent.id)
        session.add(conversation)
        await session.flush()
        session.add(Message(conversation_id=conversation.id, role="assistant", content="x", tokens_in=50, tokens_out=50))
        session.add(Budget(agent_id=None, daily_token_limit=10))
        await session.commit()
    run_id = await _new_run()

    await orchestrator.plan_and_execute(run_id)

    run, _ = await _load(run_id)
    assert run.status == "failed"
    assert "Daily token budget exceeded" in run.error
    assert client.calls == []
    await engine.dispose()


async def test_run_api_exposes_the_reason(monkeypatch):
    client = FakeClient("no plan", "no plan")
    monkeypatch.setattr(orchestrator, "get_llm_client", lambda: client)
    run_id = await _new_run()
    await orchestrator.plan_and_execute(run_id)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as http:
        one = (await http.get(f"/api/v1/runs/{run_id}")).json()
        listed = (await http.get("/api/v1/runs")).json()
    assert one["status"] == "failed"
    assert one["error"].startswith("The Orchestrator couldn't")
    assert any(r["id"] == str(run_id) and r["error"] for r in listed)
    await engine.dispose()
