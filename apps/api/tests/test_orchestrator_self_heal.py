"""Tests for self-healing task execution and run-level fault isolation
(services/orchestrator.py): a failed attempt is retried as a follow-up turn
in the SAME conversation instead of giving up, bounded only by stall
detection / a wall-clock deadline / budget exhaustion (no fixed attempt
cap) — and one task's failure no longer stops the whole run.

stream_chat is monkeypatched throughout — these tests must not call a real
LLM. Agent/Run/RunTask rows are built directly via the ORM, same pattern as
test_run_tasks.py / test_budgets.py, and every row created here is deleted
at the end of each test (deleting the Agent cascades to its
Conversations/Messages; deleting the Run cascades to its RunTasks) — belt
and braces on top of tests/conftest.py's `_isolated_test_db` fixture, which
now truncates every app table before each test anyway (see its docstring).
"""

import uuid

from sqlalchemy import select

from app.config import get_settings
from app.db import SessionLocal, engine
from app.models import Agent, Run, RunTask
from app.services.chat import _sse
from app.services.orchestrator import execute_run


def _frame(event: dict) -> str:
    return _sse(event)


async def _make_agent(slug: str) -> uuid.UUID:
    async with SessionLocal() as session:
        agent = Agent(
            slug=slug,
            name="Self Heal Test Agent",
            description="Created by test_orchestrator_self_heal.py",
            system_prompt="You are a test agent.",
            model="test-model",
        )
        session.add(agent)
        await session.commit()
        await session.refresh(agent)
        return agent.id


async def _make_run(agent_slug: str, task_specs: list[dict]) -> uuid.UUID:
    async with SessionLocal() as session:
        run = Run(goal="self-heal test", status="running")
        session.add(run)
        await session.flush()
        for spec in task_specs:
            session.add(
                RunTask(
                    run_id=run.id,
                    ordinal=spec["ordinal"],
                    title=spec["title"],
                    description=spec.get("description", ""),
                    agent_slug=agent_slug,
                    depends_on=spec.get("depends_on", []),
                    needs_approval=False,
                    status="todo",
                )
            )
        await session.commit()
        return run.id


async def _cleanup(run_id: uuid.UUID | None, agent_id: uuid.UUID) -> None:
    async with SessionLocal() as session:
        if run_id:
            run = await session.get(Run, run_id)
            if run:
                await session.delete(run)
        agent = await session.get(Agent, agent_id)
        if agent:
            await session.delete(agent)
        await session.commit()
    await engine.dispose()


async def _get_task(run_id: uuid.UUID, ordinal: int) -> RunTask:
    async with SessionLocal() as session:
        return (
            await session.execute(
                select(RunTask).where(RunTask.run_id == run_id, RunTask.ordinal == ordinal)
            )
        ).scalar_one()


async def _get_run(run_id: uuid.UUID) -> Run:
    async with SessionLocal() as session:
        run = await session.get(Run, run_id)
        assert run is not None
        return run


# --- fails once, then succeeds --------------------------------------------


async def test_task_fails_once_then_succeeds(monkeypatch) -> None:
    await engine.dispose()
    agent_slug = f"self-heal-ok-{uuid.uuid4().hex[:8]}"
    agent_id = await _make_agent(agent_slug)
    run_id: uuid.UUID | None = None
    try:
        run_id = await _make_run(
            agent_slug, [{"ordinal": 0, "title": "Do the thing", "description": "do it"}]
        )

        calls = {"n": 0}

        async def fake_stream_chat(conversation_id, prompt):
            calls["n"] += 1
            if calls["n"] == 1:
                yield _frame({"type": "error", "message": "boom: connection reset"})
            else:
                yield _frame({"type": "token", "content": "all good now"})
                yield _frame(
                    {
                        "type": "done",
                        "usage": {
                            "tokens_in": 5,
                            "tokens_out": 5,
                            "cost_usd": 0.0001,
                            "latency_ms": 10,
                        },
                    }
                )

        monkeypatch.setattr("app.services.orchestrator.stream_chat", fake_stream_chat)

        await execute_run(run_id)

        task = await _get_task(run_id, 0)
        assert task.status == "done"
        assert task.attempts == 2
        assert len(task.heal_log) == 1
        assert task.heal_log[0]["resolved"] is True
        assert "boom" in task.heal_log[0]["error"]

        run = await _get_run(run_id)
        assert run.status == "done"
    finally:
        await _cleanup(run_id, agent_id)


# --- same normalized error twice -> stall detection gives up --------------


async def test_repeated_same_error_signature_stalls_and_gives_up(monkeypatch) -> None:
    await engine.dispose()
    agent_slug = f"self-heal-stall-{uuid.uuid4().hex[:8]}"
    agent_id = await _make_agent(agent_slug)
    run_id: uuid.UUID | None = None
    try:
        run_id = await _make_run(
            agent_slug, [{"ordinal": 0, "title": "Always fails", "description": "fail forever"}]
        )

        async def fake_stream_chat(conversation_id, prompt):
            # Different raw text each call (embeds a fresh uuid, like a real
            # request id) but the SAME underlying issue — proves stall
            # detection compares NORMALIZED signatures, not raw strings.
            yield _frame(
                {"type": "error", "message": f"upstream 503 (request-id {uuid.uuid4()})"}
            )

        monkeypatch.setattr("app.services.orchestrator.stream_chat", fake_stream_chat)

        await execute_run(run_id)  # must not hang — this is the "not stuck" assertion

        task = await _get_task(run_id, 0)
        assert task.status == "failed"
        assert task.attempts == 2  # 1st failure retries; 2nd repeats the signature -> gives up
        assert len(task.heal_log) == 2
        assert "stalled" in task.heal_log[-1]["diagnosis"]

        run = await _get_run(run_id)
        assert run.status == "done_with_issues"
    finally:
        await _cleanup(run_id, agent_id)


# --- one branch's failure doesn't stop an independent branch ---------------


async def test_independent_branch_keeps_going_after_other_branch_fails(monkeypatch) -> None:
    await engine.dispose()
    agent_slug = f"self-heal-branch-{uuid.uuid4().hex[:8]}"
    agent_id = await _make_agent(agent_slug)
    run_id: uuid.UUID | None = None
    try:
        run_id = await _make_run(
            agent_slug,
            [
                {"ordinal": 0, "title": "Fail branch", "description": "FAIL_MARKER always"},
                {"ordinal": 1, "title": "OK branch", "description": "OK_MARKER always"},
            ],
        )

        # Keyed by conversation_id (not prompt text): each task gets its own
        # conversation, reused across retries, but the retry follow-up
        # prompt no longer contains the original marker text.
        kind_by_conversation: dict = {}

        async def fake_stream_chat(conversation_id, prompt):
            kind = kind_by_conversation.get(conversation_id)
            if kind is None:
                kind = "fail" if "FAIL_MARKER" in prompt else "ok"
                kind_by_conversation[conversation_id] = kind
            if kind == "fail":
                yield _frame({"type": "error", "message": f"boom {uuid.uuid4()}"})
            else:
                yield _frame({"type": "token", "content": "done"})
                yield _frame(
                    {
                        "type": "done",
                        "usage": {
                            "tokens_in": 1,
                            "tokens_out": 1,
                            "cost_usd": 0,
                            "latency_ms": 1,
                        },
                    }
                )

        monkeypatch.setattr("app.services.orchestrator.stream_chat", fake_stream_chat)

        await execute_run(run_id)

        failing = await _get_task(run_id, 0)
        succeeding = await _get_task(run_id, 1)
        assert failing.status == "failed"
        assert succeeding.status == "done"  # independent branch unaffected

        run = await _get_run(run_id)
        assert run.status == "done_with_issues"
    finally:
        await _cleanup(run_id, agent_id)


# --- dependents of a failed task become skipped ----------------------------


async def test_dependent_of_failed_task_is_skipped(monkeypatch) -> None:
    await engine.dispose()
    agent_slug = f"self-heal-skip-{uuid.uuid4().hex[:8]}"
    agent_id = await _make_agent(agent_slug)
    run_id: uuid.UUID | None = None
    try:
        run_id = await _make_run(
            agent_slug,
            [
                {"ordinal": 0, "title": "Fails", "description": "FAIL_MARKER always"},
                {
                    "ordinal": 1,
                    "title": "Depends on the failure",
                    "description": "never actually runs",
                    "depends_on": [0],
                },
            ],
        )

        seen_prompts: list[str] = []

        async def fake_stream_chat(conversation_id, prompt):
            seen_prompts.append(prompt)
            yield _frame({"type": "error", "message": f"boom {uuid.uuid4()}"})

        monkeypatch.setattr("app.services.orchestrator.stream_chat", fake_stream_chat)

        await execute_run(run_id)

        upstream = await _get_task(run_id, 0)
        dependent = await _get_task(run_id, 1)
        assert upstream.status == "failed"
        assert dependent.status == "skipped"
        # The dependent task never actually ran through stream_chat at all.
        assert not any("never actually runs" in p for p in seen_prompts)

        run = await _get_run(run_id)
        assert run.status == "done_with_issues"
    finally:
        await _cleanup(run_id, agent_id)


# --- no fixed attempt cap: keeps retrying past a small number --------------


async def test_no_fixed_attempt_cap_retries_until_deadline(monkeypatch) -> None:
    await engine.dispose()
    agent_slug = f"self-heal-nocap-{uuid.uuid4().hex[:8]}"
    agent_id = await _make_agent(agent_slug)
    run_id: uuid.UUID | None = None
    try:
        # Tiny wall-clock deadline so the test stays fast — the point is
        # this bound is TIME-based, not a hardcoded attempt count.
        settings = get_settings()
        monkeypatch.setattr(settings, "self_heal_deadline_seconds", 0.5)

        run_id = await _make_run(
            agent_slug,
            [{"ordinal": 0, "title": "Never the same error twice", "description": "flaky"}],
        )

        # A rotating set of genuinely DIFFERENT errors (no digits — those get
        # normalized away) so stall detection never fires; only the deadline
        # should end the loop. This is the regression guard for "no MAX_
        # ATTEMPTS constant anywhere": if a fixed cap of e.g. 3 or 4 were
        # ever reintroduced, this task would stop with attempts < 6.
        errors = [
            "ConnectionError: connection refused",
            "ValueError: malformed response body",
            "KeyError: missing required field",
            "TimeoutError: upstream did not respond",
            "AuthError: credential rejected",
            "ParseError: unexpected token in output",
            "RateLimitError: too many requests",
            "SchemaError: response shape invalid",
        ]
        calls = {"n": 0}

        async def fake_stream_chat(conversation_id, prompt):
            i = calls["n"]
            calls["n"] += 1
            yield _frame({"type": "error", "message": errors[i % len(errors)]})

        monkeypatch.setattr("app.services.orchestrator.stream_chat", fake_stream_chat)

        await execute_run(run_id)

        task = await _get_task(run_id, 0)
        assert task.status == "failed"
        assert task.attempts >= 6, f"expected retries well past a small fixed cap, got {task.attempts}"
        assert "deadline" in task.heal_log[-1]["diagnosis"]

        run = await _get_run(run_id)
        assert run.status == "done_with_issues"
    finally:
        await _cleanup(run_id, agent_id)
