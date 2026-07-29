"""Tests for Layer 3 re-planning (services/orchestrator.py, append-and-
supersede): when a task exhausts its own self-repair — it STALLS (repeated
normalized error signature) or hits a "capability" failure — instead of
going straight to "failed" it asks the orchestrator for a repair plan.
RunTask.depends_on ordinals may only point backward, so a stuck task can
never be replaced "in place": the repair APPENDS new task(s) with higher
ordinals and marks the stuck task status="superseded",
superseded_by=<replacement ordinal>. Downstream tasks' existing depends_on
arrays are never rewritten; execute_run resolves dependency satisfaction
THROUGH superseded_by instead (see _resolve_supersession).

Both stream_chat (the agent's own turns) and get_llm_client (the repair-plan
call) are monkeypatched throughout — hermetic, no real LLM. Same Agent/Run/
RunTask-via-ORM + cleanup-in-finally pattern as test_orchestrator_self_heal.py.

Pure-logic tests (parse_repair_plan, _resolve_supersession) need no DB/LLM
at all and are grouped first.
"""

import uuid
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from app.config import get_settings
from app.db import SessionLocal, engine
from app.models import Agent, Run, RunTask
from app.services.chat import _sse
from app.services.orchestrator import (
    _effectively_done,
    _resolve_supersession,
    execute_run,
    parse_repair_plan,
)

SLUGS = {"agent-a", "agent-b"}


def _frame(event: dict) -> str:
    return _sse(event)


# === Pure-function tests: parse_repair_plan =================================
# No DB, no LLM — same style as test_orchestrator.py's parse_plan tests.


def test_parse_repair_plan_happy_path_helper_and_replacement() -> None:
    text = (
        '{"tasks": ['
        '{"title": "Look things up", "description": "research first", "agent": "agent-a", '
        '"depends_on": [], "replacement": false}, '
        '{"title": "Retry", "description": "redo the work", "agent": "agent-b", '
        '"replacement": true}'
        "]}"
    )
    plan = parse_repair_plan(text, SLUGS, next_ordinal=5)
    assert plan is not None
    assert len(plan) == 2
    assert plan[0]["agent_slug"] == "agent-a"
    assert plan[0]["replacement"] is False
    assert plan[1]["agent_slug"] == "agent-b"
    assert plan[1]["replacement"] is True


def test_parse_repair_plan_tolerates_markdown_fences() -> None:
    text = (
        '```json\n{"tasks": [{"title": "Retry", "agent": "agent-a", '
        '"replacement": true}]}\n```'
    )
    plan = parse_repair_plan(text, SLUGS, next_ordinal=0)
    assert plan is not None
    assert plan[0]["agent_slug"] == "agent-a"


def test_parse_repair_plan_no_useful_plan_returns_none() -> None:
    assert parse_repair_plan('{"tasks": []}', SLUGS, next_ordinal=3) is None


def test_parse_repair_plan_rejects_garbage() -> None:
    with pytest.raises(ValueError):
        parse_repair_plan("sorry, I cannot help with that", SLUGS, next_ordinal=0)


def test_parse_repair_plan_rejects_unknown_agent_slug() -> None:
    # Unlike parse_plan (which coerces an unknown agent to "orchestrator"
    # for freeform goals), a repair plan REJECTS outright — see
    # parse_repair_plan's docstring for why.
    text = '{"tasks": [{"title": "X", "agent": "nonexistent", "replacement": true}]}'
    with pytest.raises(ValueError):
        parse_repair_plan(text, SLUGS, next_ordinal=3)


def test_parse_repair_plan_rejects_forward_depends_on() -> None:
    # next_ordinal=3 -> this helper task's own real ordinal is 3;
    # depends_on=[3] points at itself (not backward).
    text = (
        '{"tasks": ['
        '{"title": "Helper", "agent": "agent-a", "depends_on": [3], "replacement": false}, '
        '{"title": "Retry", "agent": "agent-b", "replacement": true}'
        "]}"
    )
    with pytest.raises(ValueError):
        parse_repair_plan(text, SLUGS, next_ordinal=3)


def test_parse_repair_plan_rejects_unknown_ordinal_depends_on() -> None:
    # next_ordinal=2 -> only ordinals 0/1 exist; 99 references nothing real.
    text = (
        '{"tasks": ['
        '{"title": "Helper", "agent": "agent-a", "depends_on": [99], "replacement": false}, '
        '{"title": "Retry", "agent": "agent-b", "replacement": true}'
        "]}"
    )
    with pytest.raises(ValueError):
        parse_repair_plan(text, SLUGS, next_ordinal=2)


def test_parse_repair_plan_rejects_zero_replacement_tasks() -> None:
    text = '{"tasks": [{"title": "X", "agent": "agent-a", "replacement": false}]}'
    with pytest.raises(ValueError):
        parse_repair_plan(text, SLUGS, next_ordinal=0)


def test_parse_repair_plan_rejects_multiple_replacement_tasks() -> None:
    text = (
        '{"tasks": ['
        '{"title": "X", "agent": "agent-a", "replacement": true}, '
        '{"title": "Y", "agent": "agent-b", "replacement": true}'
        "]}"
    )
    with pytest.raises(ValueError):
        parse_repair_plan(text, SLUGS, next_ordinal=0)


# === Pure-function tests: _resolve_supersession / _effectively_done =========
# Synthetic RunTask-shaped objects (only .ordinal/.status/.superseded_by/
# .result are read) — no DB needed to exercise the resolution logic itself.


def _row(ordinal: int, status: str, superseded_by: int | None = None, result: str = "") -> object:
    return SimpleNamespace(ordinal=ordinal, status=status, superseded_by=superseded_by, result=result)


def test_resolve_supersession_depth_2_chain_resolves() -> None:
    # 7 superseded_by 9; 9 is done — matches the spec's own example.
    by_ordinal = {
        7: _row(7, "superseded", superseded_by=9),
        9: _row(9, "done", result="final answer"),
    }
    resolved = _resolve_supersession(7, by_ordinal)
    assert resolved is not None
    assert resolved.ordinal == 9
    assert resolved.status == "done"


def test_resolve_supersession_of_a_plain_task_is_itself() -> None:
    by_ordinal = {0: _row(0, "todo")}
    assert _resolve_supersession(0, by_ordinal) is by_ordinal[0]


def test_resolve_supersession_unknown_ordinal_is_none() -> None:
    assert _resolve_supersession(42, {}) is None


def test_resolve_supersession_cycle_is_safe_and_terminates() -> None:
    # Malformed data that should never occur in practice (superseded_by
    # only ever targets a strictly larger ordinal in real code) but must
    # not hang if it somehow did.
    by_ordinal = {
        5: _row(5, "superseded", superseded_by=6),
        6: _row(6, "superseded", superseded_by=5),
    }
    assert _resolve_supersession(5, by_ordinal) is None


def test_effectively_done_true_for_superseded_chain_ending_in_done() -> None:
    by_ordinal = {
        3: _row(3, "superseded", superseded_by=7),
        7: _row(7, "done", result="x"),
    }
    assert _effectively_done(by_ordinal[3], by_ordinal) is True


def test_effectively_done_false_while_replacement_still_pending() -> None:
    by_ordinal = {
        3: _row(3, "superseded", superseded_by=7),
        7: _row(7, "todo"),
    }
    assert _effectively_done(by_ordinal[3], by_ordinal) is False


# === Integration helpers (mirrors test_orchestrator_self_heal.py) ===========


async def _make_agent(slug: str) -> uuid.UUID:
    async with SessionLocal() as session:
        agent = Agent(
            slug=slug,
            name="Replan Test Agent",
            description=f"Created by test_orchestrator_replan.py ({slug})",
            system_prompt="You are a test agent.",
            model="test-model",
        )
        session.add(agent)
        await session.commit()
        await session.refresh(agent)
        return agent.id


async def _make_run(agent_slug: str, task_specs: list[dict]) -> uuid.UUID:
    async with SessionLocal() as session:
        run = Run(goal="replan test", status="running")
        session.add(run)
        await session.flush()
        for spec in task_specs:
            session.add(
                RunTask(
                    run_id=run.id,
                    ordinal=spec["ordinal"],
                    title=spec["title"],
                    description=spec.get("description", ""),
                    agent_slug=spec.get("agent_slug", agent_slug),
                    depends_on=spec.get("depends_on", []),
                    needs_approval=False,
                    status="todo",
                )
            )
        await session.commit()
        return run.id


async def _cleanup(run_id: uuid.UUID | None, agent_ids: list[uuid.UUID]) -> None:
    async with SessionLocal() as session:
        if run_id:
            run = await session.get(Run, run_id)
            if run:
                await session.delete(run)
        for agent_id in agent_ids:
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


async def _all_tasks(run_id: uuid.UUID) -> list[RunTask]:
    async with SessionLocal() as session:
        return (
            (
                await session.execute(
                    select(RunTask).where(RunTask.run_id == run_id).order_by(RunTask.ordinal)
                )
            )
            .scalars()
            .all()
        )


async def _get_run(run_id: uuid.UUID) -> Run:
    async with SessionLocal() as session:
        run = await session.get(Run, run_id)
        assert run is not None
        return run


def _fake_llm_client(response_texts: list[str]):
    """Fake get_llm_client() for the repair-plan call: each successive
    .chat.completions.create() returns the next canned text (the last one
    repeats once the list is exhausted). Same canned-completion shape as
    tests/test_playground.py's _FakeClient."""
    calls = {"n": 0}

    class _FakeCompletions:
        async def create(self, **kwargs):
            i = min(calls["n"], len(response_texts) - 1)
            calls["n"] += 1
            return SimpleNamespace(
                choices=[SimpleNamespace(message=SimpleNamespace(content=response_texts[i]))]
            )

    class _FakeChat:
        completions = _FakeCompletions()

    class _FakeClient:
        chat = _FakeChat()

    return _FakeClient()


def _stalling_fake_stream_chat(conv_order: list):
    """A fake stream_chat where the FIRST distinct conversation it sees
    always fails with the SAME "approach"-classified error (triggering
    stall after 2 attempts — attempt 1 sets prior_signature, attempt 2
    repeats it), and every LATER distinct conversation (i.e. a replacement
    task) succeeds on its first attempt. `conv_order` records each newly
    seen conversation_id in first-seen order, so a test can tell which
    generation is which without depending on prompt text.
    """

    async def fake_stream_chat(conversation_id, prompt, model_override=None):
        if conversation_id not in conv_order:
            conv_order.append(conversation_id)
        idx = conv_order.index(conversation_id)
        if idx == 0:
            yield _frame({"type": "error", "message": "BadRequestError: malformed tool arguments"})
        else:
            yield _frame({"type": "token", "content": "fixed by the replacement"})
            yield _frame(
                {
                    "type": "done",
                    "usage": {"tokens_in": 1, "tokens_out": 1, "cost_usd": 0, "latency_ms": 1},
                }
            )

    return fake_stream_chat


# === Integration: stuck task gets superseded, replacement succeeds =========


async def test_stuck_task_superseded_replacement_succeeds_run_done(monkeypatch) -> None:
    await engine.dispose()
    agent_slug = f"replan-ok-{uuid.uuid4().hex[:8]}"
    agent_id = await _make_agent(agent_slug)
    run_id: uuid.UUID | None = None
    try:
        run_id = await _make_run(
            agent_slug, [{"ordinal": 0, "title": "Flaky task", "description": "do the flaky thing"}]
        )

        conv_order: list = []
        monkeypatch.setattr(
            "app.services.orchestrator.stream_chat", _stalling_fake_stream_chat(conv_order)
        )
        monkeypatch.setattr(
            "app.services.orchestrator.get_llm_client",
            lambda: _fake_llm_client(
                ['{"tasks": [{"title": "Retry", "agent": "%s", "replacement": true}]}' % agent_slug]
            ),
        )

        await execute_run(run_id)

        original = await _get_task(run_id, 0)
        assert original.status == "superseded"
        assert original.superseded_by is not None

        replacement = await _get_task(run_id, original.superseded_by)
        assert replacement.status == "done"
        assert replacement.agent_slug == agent_slug

        # heal_log records WHAT was proposed and WHY, per spec.
        assert any("re-planned" in e["diagnosis"].lower() for e in original.heal_log)

        run = await _get_run(run_id)
        assert run.status == "done"  # superseded-but-resolved counts as done
    finally:
        await _cleanup(run_id, [agent_id])


# === Integration: dependent of a superseded node waits, isn't skipped ======


async def test_dependent_of_superseded_task_waits_and_then_runs(monkeypatch) -> None:
    await engine.dispose()
    agent_slug = f"replan-dep-{uuid.uuid4().hex[:8]}"
    agent_id = await _make_agent(agent_slug)
    run_id: uuid.UUID | None = None
    try:
        run_id = await _make_run(
            agent_slug,
            [
                {"ordinal": 0, "title": "Flaky root", "description": "flaky root work"},
                {
                    "ordinal": 1,
                    "title": "Downstream",
                    "description": "use the root's result",
                    "depends_on": [0],
                },
            ],
        )

        conv_order: list = []
        downstream_prompts: list[str] = []

        async def fake_stream_chat(conversation_id, prompt, model_override=None):
            if conversation_id not in conv_order:
                conv_order.append(conversation_id)
            idx = conv_order.index(conversation_id)
            if idx == 0:
                # original ordinal-0 task: stalls every time
                yield _frame(
                    {"type": "error", "message": "BadRequestError: malformed tool arguments"}
                )
            elif idx == 1:
                # replacement for ordinal 0: succeeds with a marked result
                yield _frame({"type": "token", "content": "REPLACEMENT_RESULT_MARKER"})
                yield _frame(
                    {
                        "type": "done",
                        "usage": {"tokens_in": 1, "tokens_out": 1, "cost_usd": 0, "latency_ms": 1},
                    }
                )
            else:
                # ordinal 1, the downstream dependent — must only run AFTER
                # the replacement above, and must see its result.
                downstream_prompts.append(prompt)
                yield _frame({"type": "token", "content": "downstream done"})
                yield _frame(
                    {
                        "type": "done",
                        "usage": {"tokens_in": 1, "tokens_out": 1, "cost_usd": 0, "latency_ms": 1},
                    }
                )

        monkeypatch.setattr("app.services.orchestrator.stream_chat", fake_stream_chat)
        monkeypatch.setattr(
            "app.services.orchestrator.get_llm_client",
            lambda: _fake_llm_client(
                ['{"tasks": [{"title": "Retry", "agent": "%s", "replacement": true}]}' % agent_slug]
            ),
        )

        await execute_run(run_id)

        root = await _get_task(run_id, 0)
        downstream = await _get_task(run_id, 1)
        assert root.status == "superseded"
        assert downstream.status == "done"  # NOT skipped
        assert len(downstream_prompts) == 1
        # Proves context resolved THROUGH the supersede pointer, not just
        # that the dependent happened to run at all.
        assert "REPLACEMENT_RESULT_MARKER" in downstream_prompts[0]

        run = await _get_run(run_id)
        assert run.status == "done"
    finally:
        await _cleanup(run_id, [agent_id])


# === Integration: repair plan proposing a different agent is honoured =====


async def test_repair_plan_different_agent_slug_is_honoured(monkeypatch) -> None:
    await engine.dispose()
    orig_slug = f"replan-orig-{uuid.uuid4().hex[:8]}"
    other_slug = f"replan-other-{uuid.uuid4().hex[:8]}"
    orig_id = await _make_agent(orig_slug)
    other_id = await _make_agent(other_slug)
    run_id: uuid.UUID | None = None
    try:
        run_id = await _make_run(
            orig_slug, [{"ordinal": 0, "title": "Needs a different agent", "description": "do it"}]
        )

        conv_order: list = []
        monkeypatch.setattr(
            "app.services.orchestrator.stream_chat", _stalling_fake_stream_chat(conv_order)
        )
        monkeypatch.setattr(
            "app.services.orchestrator.get_llm_client",
            lambda: _fake_llm_client(
                [
                    '{"tasks": [{"title": "Retry with a better-suited agent", "agent": "%s", '
                    '"replacement": true}]}' % other_slug
                ]
            ),
        )

        await execute_run(run_id)

        original = await _get_task(run_id, 0)
        assert original.status == "superseded"
        replacement = await _get_task(run_id, original.superseded_by)
        assert replacement.agent_slug == other_slug
        assert replacement.agent_slug != orig_slug
        assert replacement.status == "done"

        run = await _get_run(run_id)
        assert run.status == "done"
    finally:
        await _cleanup(run_id, [orig_id, other_id])


# === Integration: malformed repair plan is rejected -> task fails, run ends


async def test_malformed_repair_plan_rejected_task_fails_run_terminates(monkeypatch) -> None:
    await engine.dispose()
    agent_slug = f"replan-malformed-{uuid.uuid4().hex[:8]}"
    agent_id = await _make_agent(agent_slug)
    run_id: uuid.UUID | None = None
    try:
        run_id = await _make_run(
            agent_slug, [{"ordinal": 0, "title": "Stuck task", "description": "do it"}]
        )

        conv_order: list = []
        monkeypatch.setattr(
            "app.services.orchestrator.stream_chat", _stalling_fake_stream_chat(conv_order)
        )
        # Unknown agent slug -> parse_repair_plan raises ValueError -> the
        # plan is rejected, not silently coerced.
        monkeypatch.setattr(
            "app.services.orchestrator.get_llm_client",
            lambda: _fake_llm_client(
                ['{"tasks": [{"title": "Retry", "agent": "no-such-agent", "replacement": true}]}']
            ),
        )

        await execute_run(run_id)  # must not hang — the run still terminates

        task = await _get_task(run_id, 0)
        assert task.status == "failed"
        assert task.superseded_by is None
        assert "rejected" in task.heal_log[-1]["diagnosis"].lower()

        run = await _get_run(run_id)
        assert run.status == "done_with_issues"
    finally:
        await _cleanup(run_id, [agent_id])


# === Integration: "no useful plan" ends the task failed, no hang ===========


async def test_no_useful_repair_plan_ends_task_failed(monkeypatch) -> None:
    await engine.dispose()
    agent_slug = f"replan-noplan-{uuid.uuid4().hex[:8]}"
    agent_id = await _make_agent(agent_slug)
    run_id: uuid.UUID | None = None
    try:
        run_id = await _make_run(
            agent_slug, [{"ordinal": 0, "title": "Stuck task", "description": "do it"}]
        )

        conv_order: list = []
        monkeypatch.setattr(
            "app.services.orchestrator.stream_chat", _stalling_fake_stream_chat(conv_order)
        )
        monkeypatch.setattr(
            "app.services.orchestrator.get_llm_client",
            lambda: _fake_llm_client(['{"tasks": []}']),
        )

        await execute_run(run_id)  # must not hang

        task = await _get_task(run_id, 0)
        assert task.status == "failed"
        assert task.superseded_by is None
        assert "no useful" in task.heal_log[-1]["diagnosis"].lower()

        run = await _get_run(run_id)
        assert run.status == "done_with_issues"
    finally:
        await _cleanup(run_id, [agent_id])


# === Integration: the run always terminates even if re-planning keeps ======
# === producing plans (bounded by the inherited deadline, not a counter) ====


async def test_run_terminates_despite_endless_replanning(monkeypatch) -> None:
    """Every generation stalls the same way and the mocked orchestrator
    ALWAYS proposes a new (valid) replacement — nothing here ever succeeds
    and nothing ever runs out of "useful" plans to propose. The only thing
    that can end this run is the wall-clock deadline: a replacement task
    inherits its predecessor's OWN deadline (see execute_run's `deadlines`
    dict) rather than getting a fresh settings.self_heal_deadline_seconds
    window, so the entire re-planning lineage shares ONE bounded cutoff —
    this is the regression guard that append-and-supersede can't turn into
    an unbounded loop of ever-growing tasks."""
    await engine.dispose()
    agent_slug = f"replan-loop-{uuid.uuid4().hex[:8]}"
    agent_id = await _make_agent(agent_slug)
    run_id: uuid.UUID | None = None
    try:
        settings = get_settings()
        monkeypatch.setattr(settings, "self_heal_deadline_seconds", 0.3)
        monkeypatch.setattr(settings, "self_heal_transient_backoff_seconds", 0)

        run_id = await _make_run(
            agent_slug, [{"ordinal": 0, "title": "Never actually fixed", "description": "do it"}]
        )

        async def always_fails(conversation_id, prompt, model_override=None):
            # EVERY attempt, on EVERY generation, fails the SAME way -> each
            # generation stalls after its 2nd attempt and re-plans again.
            yield _frame({"type": "error", "message": "BadRequestError: malformed tool arguments"})

        monkeypatch.setattr("app.services.orchestrator.stream_chat", always_fails)

        # Every repair-plan call proposes a fresh, valid, same-agent
        # replacement — this orchestrator NEVER says "no useful plan" and
        # NEVER proposes anything malformed, so only the shared deadline
        # (not stall detection failing to fire, not a malformed-plan
        # rejection) can be what ends this run.
        monkeypatch.setattr(
            "app.services.orchestrator.get_llm_client",
            lambda: _fake_llm_client(
                ['{"tasks": [{"title": "Retry again", "agent": "%s", "replacement": true}]}'
                 % agent_slug]
            ),
        )

        await execute_run(run_id)  # must not hang — the whole point of this test

        tasks = await _all_tasks(run_id)
        # Re-planning must have actually happened at least once (otherwise
        # this test wouldn't be exercising the thing it claims to).
        assert len(tasks) > 1
        # Every task but the very last is superseded; the last one is what
        # finally hit the shared deadline and stopped for good.
        superseded = [t for t in tasks if t.status == "superseded"]
        assert len(superseded) == len(tasks) - 1
        last = tasks[-1]
        assert last.status == "failed"
        assert "deadline" in last.heal_log[-1]["diagnosis"].lower()

        run = await _get_run(run_id)
        assert run.status == "done_with_issues"
    finally:
        await _cleanup(run_id, [agent_id])
