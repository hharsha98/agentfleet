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

Layer 3 (append-and-supersede, see test_orchestrator_replan.py): a task that
STALLS (repeated normalized error signature) or hits a "capability" failure
now asks the orchestrator for a repair plan before giving up — an LLM call
via get_llm_client() that didn't exist on those two code paths before. Any
test here whose mocked failures deliberately stall or are capability-class
must therefore ALSO monkeypatch get_llm_client (via _no_plan_llm_client
below) so it stays hermetic and keeps its original "ends failed, not
superseded" outcome — Layer 3's own tests cover the repair-plan-succeeds
path. Tests that never stall (fixed by attempt 2, or use rotating distinct
errors specifically so they don't repeat) are unaffected and unchanged.
"""

import uuid
from types import SimpleNamespace

from sqlalchemy import select

from app.config import get_settings
from app.db import SessionLocal, engine
from app.models import Agent, Run, RunTask
from app.services.chat import _sse
from app.services.orchestrator import classify_failure, execute_run


def _frame(event: dict) -> str:
    return _sse(event)


def _no_plan_llm_client():
    """Fake get_llm_client() whose repair-plan call always returns
    {"tasks": []} (Layer 3's "no useful plan" outcome — see
    parse_repair_plan). For tests below whose task stalls or hits a
    capability failure but wants the PRE-Layer-3 terminal behaviour (ends
    "failed", not "superseded") without a real network call — same
    canned-completion shape as tests/test_playground.py's _FakeClient."""

    class _FakeCompletions:
        async def create(self, **kwargs):
            return SimpleNamespace(
                choices=[SimpleNamespace(message=SimpleNamespace(content='{"tasks": []}'))]
            )

    class _FakeChat:
        completions = _FakeCompletions()

    class _FakeClient:
        chat = _FakeChat()

    return _FakeClient()


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
        # "boom: connection reset" is now classify_failure()'d as "transient"
        # (see test_failure_classification below), so the retry takes the
        # short-backoff path — zero it out so this test stays fast.
        monkeypatch.setattr(get_settings(), "self_heal_transient_backoff_seconds", 0)

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
        # "upstream 503" is classify_failure()'d as "transient" — zero the
        # backoff so this test stays fast (still expected to stall on the
        # 2nd attempt, same as before; see test_failure_classification).
        monkeypatch.setattr(get_settings(), "self_heal_transient_backoff_seconds", 0)

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
        # Layer 3: stalling now also asks for a repair plan before giving up
        # (see module docstring) — keep this "gives up" test hermetic and on
        # its original outcome by having that ask return "no useful plan".
        monkeypatch.setattr("app.services.orchestrator.get_llm_client", _no_plan_llm_client)

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
        # "boom {uuid}" normalizes to the SAME signature every attempt (see
        # _error_signature), so this branch stalls too — Layer 3 asks for a
        # repair plan before giving up; keep this test hermetic/on its
        # original outcome with a "no useful plan" response.
        monkeypatch.setattr("app.services.orchestrator.get_llm_client", _no_plan_llm_client)

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
        # Same "boom {uuid}" stall as the branch-isolation test above —
        # Layer 3 asks for a repair plan before giving up; keep this test
        # hermetic/on its original outcome with a "no useful plan" response.
        monkeypatch.setattr("app.services.orchestrator.get_llm_client", _no_plan_llm_client)

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
        # A couple of these errors classify as "transient" (see
        # test_failure_classification) and take the short-backoff retry
        # path — zero it out so the deadline budget above is spent on
        # actual attempts, not sleeping.
        monkeypatch.setattr(settings, "self_heal_transient_backoff_seconds", 0)

        run_id = await _make_run(
            agent_slug,
            [{"ordinal": 0, "title": "Never the same error twice", "description": "flaky"}],
        )

        # A rotating set of genuinely DIFFERENT errors (no digits — those get
        # normalized away) so stall detection never fires; only the deadline
        # should end the loop. This is the regression guard for "no MAX_
        # ATTEMPTS constant anywhere": if a fixed cap of e.g. 3 or 4 were
        # ever reintroduced, this task would stop with attempts < 6.
        #
        # NOTE: none of these are "capability"-classified (no TypeError/
        # AttributeError/KeyError, no credential/permission/unknown-tool
        # wording) — capability failures are DELIBERATELY meant to stop on
        # the first occurrence (see test_capability_failure_stops_without_
        # llm_repair_turn), so mixing one in here would defeat the point of
        # this regression guard rather than testing it. A prior version of
        # this list included "KeyError: missing required field", which the
        # new classifier correctly treats as capability (a bug in our own
        # code) and stops on immediately — replaced with a non-capability
        # error to keep testing the no-fixed-cap invariant for the
        # transient/approach classes it actually governs.
        errors = [
            "ConnectionError: connection refused",
            "ValueError: malformed response body",
            "FormatError: response missing required section",
            "TimeoutError: upstream did not respond",
            # Deliberately NOT credential/permission wording, per the note
            # above: "credential rejected" reads like a capability failure
            # even though it misses today's exact keywords, so it would break
            # this guard confusingly the day "credential" joins the list.
            "EncodingError: unexpected byte sequence",
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


# --- failure classification (pure function, no DB/LLM at all) --------------


def test_classify_failure_transient_cases() -> None:
    assert classify_failure("RateLimitError: 429 Too Many Requests") == "transient"
    assert classify_failure("APITimeoutError: Request timed out.") == "transient"
    assert classify_failure("InternalServerError: 500 Internal Server Error") == "transient"
    assert classify_failure("boom: connection reset") == "transient"
    assert (
        classify_failure("The model provider returned an error (RateLimitError). Please try again.")
        == "transient"
    )
    # Evidence-driven: a raw provider status code is enough on its own.
    assert classify_failure("some odd message", {"status_code": 429}) == "transient"
    assert classify_failure("some odd message", {"status_code": 503}) == "transient"


def test_classify_failure_capability_cases() -> None:
    # Bugs in OUR OWN code — structurally unfixable by retrying.
    assert classify_failure("TypeError: can only concatenate str (not 'list') to str") == "capability"
    assert (
        classify_failure("AttributeError: 'NoneType' object has no attribute 'content'")
        == "capability"
    )
    assert classify_failure("KeyError: 'type'") == "capability"
    # Missing/invalid capability this agent doesn't have.
    assert classify_failure("AuthenticationError: invalid api key provided") == "capability"
    assert classify_failure("PermissionDeniedError: access forbidden") == "capability"
    assert classify_failure("Unknown tool requested: search_web_v2") == "capability"
    assert classify_failure("some odd message", {"status_code": 401}) == "capability"
    assert classify_failure("some odd message", {"error_type": "KeyError"}) == "capability"


def test_classify_failure_approach_cases() -> None:
    assert classify_failure("BadRequestError: malformed tool arguments") == "approach"
    assert classify_failure("Tool returned: not found") == "approach"
    assert (
        classify_failure("Guardrail tripped mid-turn", {"guardrail": ["pii"]}) == "approach"
    )
    assert classify_failure("provider rejected the call", {"status_code": 400}) == "approach"
    # Unrecognized shape defaults to approach (still gets a repair turn).
    assert classify_failure("something entirely novel happened") == "approach"
    assert classify_failure(None) == "approach"


# --- capability failure: stop immediately, no LLM repair turn --------------


async def test_capability_failure_stops_without_llm_repair_turn(monkeypatch) -> None:
    await engine.dispose()
    agent_slug = f"self-heal-capability-{uuid.uuid4().hex[:8]}"
    agent_id = await _make_agent(agent_slug)
    run_id: uuid.UUID | None = None
    try:
        run_id = await _make_run(
            agent_slug,
            [{"ordinal": 0, "title": "Needs a credential", "description": "call the api"}],
        )

        calls = {"n": 0}

        async def fake_stream_chat(conversation_id, prompt):
            calls["n"] += 1
            yield _frame({"type": "error", "message": "AuthenticationError: invalid api key provided"})

        monkeypatch.setattr("app.services.orchestrator.stream_chat", fake_stream_chat)
        # Layer 3: a capability failure now also asks for a repair plan
        # before giving up (see module docstring) — that's a SEPARATE LLM
        # call from the agent's own turn (`calls["n"]` below only counts
        # stream_chat calls, so it's unaffected), but must still be mocked
        # for hermeticity and to keep this test on its original "ends
        # failed" outcome.
        monkeypatch.setattr("app.services.orchestrator.get_llm_client", _no_plan_llm_client)

        await execute_run(run_id)

        task = await _get_task(run_id, 0)
        assert task.status == "failed"
        assert task.attempts == 1
        assert calls["n"] == 1, "capability failure must not spend an LLM repair turn"
        assert len(task.heal_log) == 1
        assert task.heal_log[0]["classification"] == "capability"
        assert "capability" in task.heal_log[0]["diagnosis"].lower()

        run = await _get_run(run_id)
        assert run.status == "done_with_issues"
    finally:
        await _cleanup(run_id, agent_id)


# --- transient failure: retry the SAME prompt, no reasoning turn -----------


async def test_transient_failure_retries_same_prompt_then_succeeds(monkeypatch) -> None:
    await engine.dispose()
    agent_slug = f"self-heal-transient-{uuid.uuid4().hex[:8]}"
    agent_id = await _make_agent(agent_slug)
    run_id: uuid.UUID | None = None
    try:
        monkeypatch.setattr(get_settings(), "self_heal_transient_backoff_seconds", 0)

        run_id = await _make_run(
            agent_slug, [{"ordinal": 0, "title": "Flaky call", "description": "call the flaky api"}]
        )

        prompts_seen: list[str] = []
        calls = {"n": 0}

        async def fake_stream_chat(conversation_id, prompt):
            prompts_seen.append(prompt)
            calls["n"] += 1
            if calls["n"] == 1:
                yield _frame({"type": "error", "message": "RateLimitError: 429 too many requests"})
            else:
                yield _frame({"type": "token", "content": "done"})
                yield _frame(
                    {
                        "type": "done",
                        "usage": {"tokens_in": 1, "tokens_out": 1, "cost_usd": 0, "latency_ms": 1},
                    }
                )

        monkeypatch.setattr("app.services.orchestrator.stream_chat", fake_stream_chat)

        await execute_run(run_id)

        task = await _get_task(run_id, 0)
        assert task.status == "done"
        assert task.attempts == 2
        assert len(prompts_seen) == 2
        # SAME prompt reused — no LLM reasoning/repair narrative injected.
        assert prompts_seen[0] == prompts_seen[1]
        assert "That attempt failed" not in prompts_seen[1]
        assert task.heal_log[0]["classification"] == "transient"

        run = await _get_run(run_id)
        assert run.status == "done"
    finally:
        await _cleanup(run_id, agent_id)


# --- approach failure: still goes through the LLM repair turn --------------


async def test_approach_failure_goes_through_repair_turn_then_succeeds(monkeypatch) -> None:
    await engine.dispose()
    agent_slug = f"self-heal-approach-{uuid.uuid4().hex[:8]}"
    agent_id = await _make_agent(agent_slug)
    run_id: uuid.UUID | None = None
    try:
        run_id = await _make_run(
            agent_slug, [{"ordinal": 0, "title": "Bad args once", "description": "call the tool"}]
        )

        prompts_seen: list[str] = []
        calls = {"n": 0}

        async def fake_stream_chat(conversation_id, prompt):
            prompts_seen.append(prompt)
            calls["n"] += 1
            if calls["n"] == 1:
                yield _frame({"type": "error", "message": "BadRequestError: malformed tool arguments"})
            else:
                yield _frame({"type": "token", "content": "done"})
                yield _frame(
                    {
                        "type": "done",
                        "usage": {"tokens_in": 1, "tokens_out": 1, "cost_usd": 0, "latency_ms": 1},
                    }
                )

        monkeypatch.setattr("app.services.orchestrator.stream_chat", fake_stream_chat)

        await execute_run(run_id)

        task = await _get_task(run_id, 0)
        assert task.status == "done"
        assert task.attempts == 2
        # A real repair turn WAS requested — original brief re-stated,
        # diagnosis requested, per the deliberate "answer ONLY the final
        # result" contract.
        assert "That attempt failed" in prompts_seen[1]
        assert "call the tool" in prompts_seen[1]
        assert task.heal_log[0]["classification"] == "approach"

        run = await _get_run(run_id)
        assert run.status == "done"
    finally:
        await _cleanup(run_id, agent_id)


# --- escalation ladder (Layer 2): approach failures climb it rung by rung --


async def test_approach_failure_escalates_ladder_rung_by_rung(monkeypatch) -> None:
    """Two consecutive "approach"-classified failures must escalate the
    NEXT attempt to rung 1, then rung 2 — never retrying an approach
    failure on the same model that just failed it."""
    await engine.dispose()
    agent_slug = f"self-heal-ladder-{uuid.uuid4().hex[:8]}"
    agent_id = await _make_agent(agent_slug)  # agent.model == "test-model"
    run_id: uuid.UUID | None = None
    try:
        settings = get_settings()
        monkeypatch.setattr(
            settings, "self_heal_escalation_models", "model-rung-1,model-rung-2"
        )

        run_id = await _make_run(
            agent_slug, [{"ordinal": 0, "title": "Needs escalation", "description": "do it"}]
        )

        seen_models: list[str | None] = []
        calls = {"n": 0}

        async def fake_stream_chat(conversation_id, prompt, model_override=None):
            calls["n"] += 1
            seen_models.append(model_override)
            if calls["n"] == 1:
                yield _frame({"type": "error", "message": "BadRequestError: malformed tool arguments"})
            elif calls["n"] == 2:
                # DIFFERENT text from attempt 1's error (not just a different
                # digit run) — proves this is escalation, not the ordinary
                # stall detector; a repeated signature would stop the task
                # instead of reaching rung 2 at all.
                yield _frame({"type": "error", "message": "BadRequestError: invalid argument shape"})
            else:
                yield _frame({"type": "token", "content": "fixed by a stronger model"})
                yield _frame(
                    {
                        "type": "done",
                        "usage": {"tokens_in": 1, "tokens_out": 1, "cost_usd": 0, "latency_ms": 1},
                    }
                )

        monkeypatch.setattr("app.services.orchestrator.stream_chat", fake_stream_chat)

        await execute_run(run_id)

        task = await _get_task(run_id, 0)
        assert task.status == "done"
        assert task.attempts == 3
        # Attempt 1 used the agent's own model (no override yet); attempt 2
        # escalated to rung 1; attempt 3 (which succeeded) escalated to rung 2.
        assert seen_models == [None, "model-rung-1", "model-rung-2"]

        assert len(task.heal_log) == 2
        assert task.heal_log[0]["classification"] == "approach"
        assert task.heal_log[0]["model"] == "model-rung-1"
        assert "model-rung-1" in task.heal_log[0]["diagnosis"]
        assert task.heal_log[1]["model"] == "model-rung-2"
        assert "model-rung-2" in task.heal_log[1]["diagnosis"]
        # The entry whose escalated model actually fixed the task is the one
        # marked resolved — proving "the fix came from a stronger model".
        assert task.heal_log[1]["resolved"] is True

        run = await _get_run(run_id)
        assert run.status == "done"
    finally:
        await _cleanup(run_id, agent_id)


async def test_transient_failure_does_not_advance_ladder(monkeypatch) -> None:
    """A transient (infrastructure) failure is never the model's fault, so
    it must not consume a ladder rung — the retry stays on the same model."""
    await engine.dispose()
    agent_slug = f"self-heal-ladder-transient-{uuid.uuid4().hex[:8]}"
    agent_id = await _make_agent(agent_slug)  # agent.model == "test-model"
    run_id: uuid.UUID | None = None
    try:
        settings = get_settings()
        monkeypatch.setattr(
            settings, "self_heal_escalation_models", "model-rung-1,model-rung-2"
        )
        monkeypatch.setattr(settings, "self_heal_transient_backoff_seconds", 0)

        run_id = await _make_run(
            agent_slug, [{"ordinal": 0, "title": "Flaky then fine", "description": "call it"}]
        )

        seen_models: list[str | None] = []
        calls = {"n": 0}

        async def fake_stream_chat(conversation_id, prompt, model_override=None):
            calls["n"] += 1
            seen_models.append(model_override)
            if calls["n"] == 1:
                yield _frame({"type": "error", "message": "RateLimitError: 429 too many requests"})
            else:
                yield _frame({"type": "token", "content": "done"})
                yield _frame(
                    {
                        "type": "done",
                        "usage": {"tokens_in": 1, "tokens_out": 1, "cost_usd": 0, "latency_ms": 1},
                    }
                )

        monkeypatch.setattr("app.services.orchestrator.stream_chat", fake_stream_chat)

        await execute_run(run_id)

        task = await _get_task(run_id, 0)
        assert task.status == "done"
        assert task.attempts == 2
        # BOTH attempts used the agent's own model — a configured ladder
        # exists, but the transient failure never advanced the rung.
        assert seen_models == [None, None]
        assert task.heal_log[0]["classification"] == "transient"
        assert task.heal_log[0]["model"] == "test-model"

        run = await _get_run(run_id)
        assert run.status == "done"
    finally:
        await _cleanup(run_id, agent_id)


async def test_ladder_exhausted_keeps_repairing_on_last_rung(monkeypatch) -> None:
    """Once every rung has been used, further approach failures keep using
    the STRONGEST rung rather than stopping — escalation exhaustion must
    never become a new way to give up (that stays stall/deadline/budget/
    capability's job). Also doubles as the no-fixed-cap regression guard
    for the ladder specifically: with only ONE rung configured, the task
    must still be retried many times past that single rung before the
    wall-clock deadline ends it."""
    await engine.dispose()
    agent_slug = f"self-heal-ladder-exhausted-{uuid.uuid4().hex[:8]}"
    agent_id = await _make_agent(agent_slug)  # agent.model == "test-model"
    run_id: uuid.UUID | None = None
    try:
        settings = get_settings()
        monkeypatch.setattr(settings, "self_heal_escalation_models", "model-rung-1")
        monkeypatch.setattr(settings, "self_heal_deadline_seconds", 0.5)
        monkeypatch.setattr(settings, "self_heal_transient_backoff_seconds", 0)

        run_id = await _make_run(
            agent_slug, [{"ordinal": 0, "title": "Never resolved", "description": "keeps failing"}]
        )

        # Rotating, genuinely different "approach"-classified error texts (no
        # digits) so the ordinary stall detector never fires — only the
        # ladder-exhaustion behaviour and the deadline are under test here.
        errors = [
            "BadRequestError: malformed tool arguments",
            "BadRequestError: invalid argument shape",
            "Tool returned: not found for widget",
            "Tool returned: empty result for gadget",
            "Tool returned: no results for gizmo",
            "Guardrail flagged this response",
        ]
        seen_models: list[str | None] = []
        calls = {"n": 0}

        async def fake_stream_chat(conversation_id, prompt, model_override=None):
            i = calls["n"]
            calls["n"] += 1
            seen_models.append(model_override)
            yield _frame({"type": "error", "message": errors[i % len(errors)]})

        monkeypatch.setattr("app.services.orchestrator.stream_chat", fake_stream_chat)

        await execute_run(run_id)  # must not hang

        task = await _get_task(run_id, 0)
        assert task.status == "failed"
        assert "deadline" in task.heal_log[-1]["diagnosis"]
        # Escalated once (rung 1), then kept retrying on that SAME rung for
        # every remaining attempt — well past the single configured rung —
        # rather than stopping once the ladder ran out.
        assert seen_models[0] is None
        assert len(seen_models) >= 5, f"expected retries well past one rung, got {seen_models}"
        assert all(m == "model-rung-1" for m in seen_models[1:])
        assert task.heal_log[-1]["model"] == "model-rung-1"

        run = await _get_run(run_id)
        assert run.status == "done_with_issues"
    finally:
        await _cleanup(run_id, agent_id)


async def test_empty_ladder_behaves_like_today(monkeypatch) -> None:
    """No configured ladder and no planner_model -> no escalation at all:
    every attempt (however many approach failures precede it) keeps using
    the agent's own model, identical to the behaviour before this setting
    existed."""
    await engine.dispose()
    agent_slug = f"self-heal-ladder-empty-{uuid.uuid4().hex[:8]}"
    agent_id = await _make_agent(agent_slug)  # agent.model == "test-model"
    run_id: uuid.UUID | None = None
    try:
        settings = get_settings()
        monkeypatch.setattr(settings, "self_heal_escalation_models", "")
        monkeypatch.setattr(settings, "planner_model", "")

        run_id = await _make_run(
            agent_slug, [{"ordinal": 0, "title": "No ladder configured", "description": "do it"}]
        )

        seen_models: list[str | None] = []
        calls = {"n": 0}

        async def fake_stream_chat(conversation_id, prompt, model_override=None):
            calls["n"] += 1
            seen_models.append(model_override)
            if calls["n"] == 1:
                yield _frame({"type": "error", "message": "BadRequestError: malformed tool arguments"})
            elif calls["n"] == 2:
                yield _frame({"type": "error", "message": "BadRequestError: invalid argument shape"})
            else:
                yield _frame({"type": "token", "content": "done"})
                yield _frame(
                    {
                        "type": "done",
                        "usage": {"tokens_in": 1, "tokens_out": 1, "cost_usd": 0, "latency_ms": 1},
                    }
                )

        monkeypatch.setattr("app.services.orchestrator.stream_chat", fake_stream_chat)

        await execute_run(run_id)

        task = await _get_task(run_id, 0)
        assert task.status == "done"
        assert task.attempts == 3
        assert seen_models == [None, None, None]
        assert task.heal_log[0]["model"] == "test-model"
        assert task.heal_log[1]["model"] == "test-model"
        assert task.heal_log[1]["resolved"] is True

        run = await _get_run(run_id)
        assert run.status == "done"
    finally:
        await _cleanup(run_id, agent_id)


# --- rich evidence: repair prompt carries the failing tool + its output ----


async def test_repair_prompt_includes_tool_name_and_output_on_failure(monkeypatch) -> None:
    await engine.dispose()
    agent_slug = f"self-heal-evidence-{uuid.uuid4().hex[:8]}"
    agent_id = await _make_agent(agent_slug)
    run_id: uuid.UUID | None = None
    try:
        run_id = await _make_run(
            agent_slug,
            [{"ordinal": 0, "title": "Search then answer", "description": "search then answer"}],
        )

        prompts_seen: list[str] = []
        calls = {"n": 0}

        async def fake_stream_chat(conversation_id, prompt):
            prompts_seen.append(prompt)
            calls["n"] += 1
            if calls["n"] == 1:
                yield _frame(
                    {"type": "tool_call", "name": "search_web", "arguments": {"q": "x"}}
                )
                yield _frame(
                    {
                        "type": "tool_result",
                        "name": "search_web",
                        "preview": "NO_RESULTS_FOUND_MARKER",
                    }
                )
                yield _frame({"type": "error", "message": "BadRequestError: malformed tool arguments"})
            else:
                yield _frame({"type": "token", "content": "done"})
                yield _frame(
                    {
                        "type": "done",
                        "usage": {"tokens_in": 1, "tokens_out": 1, "cost_usd": 0, "latency_ms": 1},
                    }
                )

        monkeypatch.setattr("app.services.orchestrator.stream_chat", fake_stream_chat)

        await execute_run(run_id)

        task = await _get_task(run_id, 0)
        assert task.status == "done"
        repair_prompt = prompts_seen[1]
        assert "search_web" in repair_prompt
        assert "NO_RESULTS_FOUND_MARKER" in repair_prompt
        # The heal_log entry itself also carries the (truncated) evidence,
        # not just the bare error string.
        assert task.heal_log[0]["evidence"]["tool"] == "search_web"
        assert "NO_RESULTS_FOUND_MARKER" in task.heal_log[0]["evidence"]["tool_output"]

        run = await _get_run(run_id)
        assert run.status == "done"
    finally:
        await _cleanup(run_id, agent_id)
