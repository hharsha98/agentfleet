"""Run orchestration: plan a goal into a task DAG, execute it with agents.

Each task executes THROUGH the chat runtime (stream_chat) via a throwaway
conversation — inheriting tools, metering, Langfuse tracing, and the
salvage logic for free. Ready tasks run in parallel (asyncio.gather);
tasks flagged needs_approval pause in "review" until a human approves.

v1 executes in-process (asyncio task); the arq worker split happens with
the packaging milestone (ARCHITECTURE.md ADR-004).

Self-healing has three layers, each in _execute_task unless noted:
  1. Retry a failed attempt as a follow-up turn in the same conversation.
  2. Escalate "approach" failures up a configured model ladder.
  3. Re-planning (append-and-supersede, see _attempt_replan): when a task
     STALLS or hits a "capability" failure, ask the orchestrator whether the
     SHAPE of the work should change instead of just retrying the same
     approach — a missing step first, or a different agent. RunTask.depends_on
     ordinals only ever point backward (0 <= d < ordinal), so a stuck task
     can't be replaced "in place": new task(s) are APPENDED with higher
     ordinals, and the stuck task is marked status="superseded",
     superseded_by=<replacement ordinal>. execute_run resolves dependency
     satisfaction and skip-blocking THROUGH that pointer transitively (see
     _resolve_supersession) so existing depends_on arrays never need
     rewriting.
"""

import asyncio
import json
import logging
import re
import time
import traceback
import uuid

from sqlalchemy import func, select

from app.config import get_settings
from app.db import SessionLocal
from app.models import Agent, Conversation, Run, RunTask
from app.providers import get_llm_client
from app.services.budget import check_budget
from app.services.chat import stream_chat

logger = logging.getLogger(__name__)

# Strips uuids and any other digit runs (ids, timestamps) out of an error
# message so two attempts hitting the same underlying problem compare equal
# even though the message embeds a different id/timestamp each time.
_UUID_RE = re.compile(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")
_DIGIT_RE = re.compile(r"\d+")


def _error_signature(error: str) -> str:
    """Normalize an error into a signature for stall detection (see
    _execute_task). Two attempts that failed for "the same reason" produce
    the same signature even if the raw message differs in an id/timestamp."""
    text = _UUID_RE.sub("#", error or "")
    text = _DIGIT_RE.sub("#", text)
    return text.strip().lower()


def _truncate(text: str | None, limit: int = 300) -> str:
    text = text or ""
    return text if len(text) <= limit else text[: limit - 1] + "…"


# --- failure classification (pure, no LLM call) -----------------------------
#
# Every failed attempt gets ONE label, which _execute_task uses to route the
# retry. This is the fix for a real run that burned two full LLM reasoning
# turns on a TypeError in our own frame-handling code (structurally
# unfixable by retrying) before the stall detector finally gave up — and,
# separately, wasted a reasoning turn on a plain transient provider blip
# where a bare retry would have worked.
#
# Keyword lists match on the lower-cased error string (which already embeds
# the provider/exception class name — see _run_turn and chat.py's sanitized
# error message); bare numeric HTTP-status checks use word-boundaried regex
# so they can't accidentally fire on digits embedded in an unrelated id.

_CAPABILITY_KEYWORDS = (
    # Bugs in OUR OWN code, not something the provider returned — these are
    # structurally unfixable by retrying the same or a different prompt.
    "typeerror",
    "attributeerror",
    "keyerror",
    # Missing/invalid capability this agent doesn't have.
    "missing credential",
    "invalid credential",
    "missing api key",
    "invalid api key",
    "no api key",
    "unauthorized",
    "authenticationerror",
    "forbidden",
    "permissiondeniederror",
    "permission denied",
    "unknown tool",
    "no such tool",
    "tool not found",
    "unrecognized tool",
)

_TRANSIENT_KEYWORDS = (
    "rate limit",
    "ratelimit",
    "internalservererror",
    "bad gateway",
    "service unavailable",
    "gateway timeout",
    "timeout",
    "timed out",
    "connection reset",
    "connection refused",
    "connection error",
    "connection aborted",
    "apiconnectionerror",
    "stream aborted",
    "stream closed unexpectedly",
)

_APPROACH_KEYWORDS = (
    "guardrail",
    "malformed",
    "invalid argument",
    "invalid arguments",
    "bad request",
    "badrequesterror",
    "not found",
    "empty result",
    "no results",
)

# Isolated 3-digit HTTP-status-shaped tokens only (word-boundaried), so a
# random uuid/request-id embedding "500" as part of a longer digit run can't
# masquerade as a status code.
_STATUS_5XX_RE = re.compile(r"\b5\d{2}\b")
_STATUS_429_RE = re.compile(r"\b429\b")
_STATUS_401_403_RE = re.compile(r"\b40[13]\b")


def classify_failure(error: str | None, evidence: dict | None = None) -> str:
    """Label a failed attempt as "transient", "approach", or "capability" —
    pure function, no LLM call, so _execute_task can route the retry without
    spending a reasoning turn deciding HOW to retry.

    - "transient": provider 5xx/429/timeout/connection reset/stream aborted.
      The approach was fine; infrastructure blipped. Retry the same prompt.
    - "approach": the model did something wrong (bad tool arguments,
      malformed output, tool returned not-found/empty, guardrail tripped).
      Worth an LLM repair turn.
    - "capability": structurally unfixable by this node — missing/invalid
      credential, unknown tool, permission denied, or a bug in OUR OWN code
      (TypeError/AttributeError/KeyError raised inside our stack rather than
      returned by a provider). Stop immediately; retrying cannot fix it.

    Unrecognized shapes default to "approach" — safer than silently stopping
    (capability) or retrying forever with no plan (transient).
    """
    evidence = evidence or {}
    text = error or ""
    # Fold evidence["error_type"] (set by _run_turn from the actual raised
    # exception's class, e.g. "KeyError") into the same text that keyword
    # matching scans, so a caller passing structured evidence instead of a
    # descriptive string still gets the right label.
    lower = f"{text} {evidence.get('error_type') or ''}".lower()
    status_code = evidence.get("status_code")

    if any(keyword in lower for keyword in _CAPABILITY_KEYWORDS):
        return "capability"
    if status_code in (401, 403) or _STATUS_401_403_RE.search(text):
        return "capability"

    if status_code == 429 or (isinstance(status_code, int) and 500 <= status_code < 600):
        return "transient"
    if any(keyword in lower for keyword in _TRANSIENT_KEYWORDS):
        return "transient"
    if _STATUS_429_RE.search(text) or _STATUS_5XX_RE.search(text):
        return "transient"

    if evidence.get("guardrail"):
        return "approach"
    if status_code == 400:
        return "approach"
    if any(keyword in lower for keyword in _APPROACH_KEYWORDS):
        return "approach"

    return "approach"


def _log_evidence(evidence: dict, limit: int = 300) -> dict:
    """Compact copy of `evidence` for heal_log storage — these render on the
    missions board, so every string value is truncated small. The fuller
    ~2000-char traceback used in the repair prompt (see _build_repair_prompt)
    is NOT what gets persisted here."""
    out: dict = {}
    for key, value in evidence.items():
        out[key] = _truncate(value, limit) if isinstance(value, str) else value
    return out


def _build_repair_prompt(error: str, evidence: dict, prompt_original: str) -> str:
    """The rich-evidence repair turn: same guarantee as before — restate the
    ORIGINAL brief and ask for ONLY the final result, so the model diagnoses
    privately instead of narrating the failure into the deliverable — but
    now backed by concrete evidence (which tool failed and its raw output, a
    trimmed traceback, guardrail flags) instead of a bare error string."""
    lines = [f"That attempt failed with this error: {error}"]
    if evidence.get("tool"):
        lines.append(f"Tool that failed: {evidence['tool']}")
    if evidence.get("tool_output"):
        lines.append(f"That tool's raw output was:\n{evidence['tool_output']}")
    if evidence.get("guardrail"):
        lines.append(f"Guardrail flags tripped: {evidence['guardrail']}")
    if evidence.get("traceback"):
        lines.append(f"Traceback (most recent call last):\n{evidence['traceback']}")
    evidence_block = "\n\n".join(lines)
    return (
        f"{evidence_block}\n\n"
        "Work out what went wrong and take a different approach. Do not repeat "
        "the action that just failed.\n\n"
        f"Then complete the original task and reply with ONLY its final result:\n{prompt_original}"
    )


def _escalation_ladder(settings) -> list[str]:
    """Parse `settings.self_heal_escalation_models` into an ordered list of
    progressively stronger model ids to escalate through on repeated
    "approach"-classified repair failures (see _execute_task). No model
    names are hardcoded here — the ladder is entirely configuration.

    Empty setting -> falls back to a single-rung ladder made of
    `planner_model`, if that's set (the "brain" model becomes the
    escalation target for free, same tiered-routing idea as planning
    already uses). If `planner_model` is ALSO empty, there is no
    escalation at all: `_execute_task` never advances past rung 0, so every
    attempt uses the agent's own model — identical to the behaviour before
    this setting existed.
    """
    raw = (settings.self_heal_escalation_models or "").strip()
    if raw:
        return [m.strip() for m in raw.split(",") if m.strip()]
    if settings.planner_model:
        return [settings.planner_model]
    return []


def _heal_entry(
    attempt: int,
    error: str,
    diagnosis: str,
    classification: str,
    evidence: dict,
    model: str,
) -> dict:
    """Build one heal_log entry with the classification, the model that
    entry pertains to (and, when present, truncated evidence) recorded
    alongside the existing attempt/error/diagnosis/resolved fields.

    `model` lets the board show that a fix came from a stronger model: for
    a continuing retry (transient/approach) it's the model the NEXT attempt
    will use, so a `resolved: True` entry's `model` is the one that actually
    produced the fix; for a stopping entry (capability/stall/deadline/
    budget) it's the model the just-failed attempt used, since there is no
    next attempt.
    """
    entry = {
        "attempt": attempt,
        "error": _truncate(error),
        "diagnosis": diagnosis,
        "classification": classification,
        "model": model,
        "resolved": False,
    }
    if evidence:
        entry["evidence"] = _log_evidence(evidence)
    return entry


# LLM-planner cap ONLY (parse_plan/plan_and_execute above) — how many tasks
# the LLM may propose in a single planning call. Hand-authored workflows
# compiled by services/workflow_compiler.py are capped independently, via
# schemas.MAX_WORKFLOW_NODES. Never apply this constant to compiled
# workflows.
MAX_PLAN_TASKS = 6

PLAN_PROMPT = """You are the AgentFleet Orchestrator. Decompose the user's goal into
2-{max_tasks} concrete tasks for the available agents.

Available agents:
{roster}

Rules:
- Each task gets exactly one agent (use the slug).
- depends_on lists the ordinals (0-based) of tasks that must finish first.
  Independent tasks run in parallel — only add dependencies that are real.
- Set needs_approval=true for consequential output a human should sign off
  (final deliverables, anything that would be sent/published).
- Task descriptions must be self-contained instructions for that agent.

Respond with ONLY this JSON, no other text:
{{"tasks": [{{"title": "...", "description": "...", "agent": "slug",
"depends_on": [], "needs_approval": false}}]}}

Goal: {goal}"""


def _extract_json_object(text: str, error_context: str) -> dict:
    """Strip optional markdown fences and parse the first {...} JSON object
    in `text`. Factored out of parse_plan so parse_repair_plan (below) can
    tolerate the same "```json ... ```" wrapping a chat model commonly adds
    without duplicating the fence-stripping logic. `error_context` only
    flavors the ValueError message (e.g. "plan" vs "repair plan")."""
    cleaned = text.strip()
    if "```" in cleaned:  # tolerate markdown fences
        cleaned = cleaned.split("```")[1]
        cleaned = cleaned.removeprefix("json").strip()
    start, end = cleaned.find("{"), cleaned.rfind("}")
    if start == -1 or end == -1:
        raise ValueError(f"no JSON object in {error_context}")
    return json.loads(cleaned[start : end + 1])


def parse_plan(text: str, valid_slugs: set[str]) -> list[dict]:
    """Extract and normalize the plan JSON; raises ValueError on garbage."""
    plan = _extract_json_object(text, "plan")
    tasks = plan.get("tasks") or []
    if not tasks:
        raise ValueError("plan has no tasks")
    normalized = []
    for i, t in enumerate(tasks[:MAX_PLAN_TASKS]):
        agent = t.get("agent") if t.get("agent") in valid_slugs else "orchestrator"
        deps = [d for d in (t.get("depends_on") or []) if isinstance(d, int) and 0 <= d < i]
        normalized.append(
            {
                "title": str(t.get("title") or f"Task {i + 1}")[:200],
                "description": str(t.get("description") or ""),
                "agent_slug": agent,
                "depends_on": deps,
                "needs_approval": bool(t.get("needs_approval")),
            }
        )
    return normalized


# --- Layer 3: re-planning a stuck workflow task (append-and-supersede) -----
#
# _execute_task's self-heal loop (see its docstring) can only rewrite a
# task's own answer by retrying. When that loop itself gives up (stall or a
# "capability" failure — see the two call sites in _execute_task), that's
# the moment Claude-Code-style re-planning kicks in: instead of going
# straight to "failed", ask the orchestrator (the planner-tier LLM, same
# tiered routing as plan_and_execute) whether the SHAPE of the work needs to
# change — a missing step first, or a different agent.
#
# RunTask.depends_on ordinals may only point BACKWARD (0 <= d < ordinal,
# enforced by workflow_compiler and assumed by execute_run's dependency
# check), so a stuck task can never be replaced "in place" — renumbering
# would invalidate every existing depends_on. Instead: append new task(s)
# with ordinals strictly greater than the current max, then mark the stuck
# task status="superseded" with superseded_by=<replacement ordinal>. See
# _resolve_supersession in execute_run for how dependents resolve through
# that pointer instead of being skipped.

# Structural cap on how many tasks ONE repair plan may append (helper steps
# + the one required replacement) — analogous to MAX_PLAN_TASKS, but for a
# single repair call's fan-out. This is NOT an attempt cap: it bounds one
# LLM call's output size, never how many TIMES re-planning can happen for a
# lineage (that stays governed by stall/deadline/budget, same as ordinary
# self-heal retries — see _attempt_replan's deadline-inheritance comment).
MAX_REPAIR_PLAN_TASKS = 4

REPAIR_PLAN_PROMPT = """You are the AgentFleet Orchestrator, brought in because a running task \
got stuck and could not fix itself no matter how it retried. When simply retrying stops \
working, the fix is to re-plan: add a step it's missing, hand the work to a different agent, \
or split it into smaller pieces — the same way a senior engineer unblocks stuck work.

Available agents:
{roster}

The stuck task ("{title}"):
{brief}

Why it got stuck ({classification}):
{evidence}

Already-available results from its completed dependencies:
{dependency_context}

Propose a repair. You may add zero or more HELPER tasks that must run before the retry (e.g. a \
missing research step) — chain them with depends_on if one helper needs another's output — plus \
exactly ONE replacement task that redoes the stuck task's own work (it may use a DIFFERENT agent \
than the original if that's the actual fix). Flag that one task with "replacement": true.

Every depends_on value must be the integer ordinal of an EXISTING task in this run (0 through \
{max_existing}) or an earlier task in this same list — never itself or a later one. Leave \
depends_on off the replacement task entirely; its dependencies are wired up automatically.

If there is no useful repair, respond with EXACTLY {{"tasks": []}} and nothing else.

Otherwise respond with ONLY this JSON, no other text:
{{"tasks": [{{"title": "...", "description": "...", "agent": "slug", "depends_on": [...], \
"needs_approval": false, "replacement": false}}, ...]}}"""


def parse_repair_plan(text: str, valid_slugs: set[str], next_ordinal: int) -> list[dict] | None:
    """Extract and STRICTLY validate a repair plan.

    Unlike parse_plan — which degrades LLM output gracefully for freeform
    goals, per its module-level contrast with workflow_compiler.py — a
    repair plan gets the workflow_compiler treatment: never trust the
    model's output structurally, because a silently-coerced bad plan could
    violate the compiler's backward-only depends_on invariant that
    execute_run relies on. So this reuses parse_plan's slug-validity CHECK
    (`agent in valid_slugs`) but not its coercion policy: an unknown slug
    here REJECTS the whole plan (raises ValueError) instead of silently
    falling back to "orchestrator".

    Ordinals are real, run-global ordinals here (not parse_plan's
    batch-local 0-based indices): entry i of `tasks` is assigned real
    ordinal `next_ordinal + i`, and every depends_on value must satisfy
    `0 <= d < next_ordinal + i` — backward to either an already-existing
    task or an earlier entry in this same batch. Since ordinals are always
    a contiguous 0..N-1 range in this system, that single range check is
    sufficient to prove `d` refers to a real task.

    Returns None for an explicit, valid "no useful plan" response (empty/
    missing "tasks") — a deliberate outcome, not an error. Raises
    ValueError for anything malformed: bad JSON, an unknown agent slug, a
    depends_on that doesn't point backward, or not EXACTLY one task flagged
    "replacement". Both outcomes are handled the same way by the caller
    (the stuck task ends up "failed", not superseded) — only the heal_log
    wording differs.
    """
    plan = _extract_json_object(text, "repair plan")
    tasks = plan.get("tasks")
    if tasks is None or not isinstance(tasks, list):
        raise ValueError("repair plan missing a 'tasks' list")
    if not tasks:
        return None  # explicit "no useful plan" — not malformed

    normalized: list[dict] = []
    replacement_count = 0
    for i, t in enumerate(tasks[:MAX_REPAIR_PLAN_TASKS]):
        if not isinstance(t, dict):
            raise ValueError(f"repair plan task at index {i} is not an object")
        agent = t.get("agent")
        if agent not in valid_slugs:
            raise ValueError(f"unknown agent slug in repair plan: {agent!r}")
        ordinal = next_ordinal + i
        deps: list[int] = []
        for d in t.get("depends_on") or []:
            if not isinstance(d, int) or isinstance(d, bool) or not (0 <= d < ordinal):
                raise ValueError(
                    f"repair plan depends_on {d!r} on task at index {i} does not point backward"
                )
            deps.append(d)
        is_replacement = bool(t.get("replacement"))
        replacement_count += is_replacement
        normalized.append(
            {
                "title": str(t.get("title") or f"Repair task {i + 1}")[:200],
                "description": str(t.get("description") or ""),
                "agent_slug": agent,
                "depends_on": deps,
                "needs_approval": bool(t.get("needs_approval")),
                "replacement": is_replacement,
            }
        )
    if replacement_count != 1:
        raise ValueError(
            f"repair plan must flag exactly one replacement task, got {replacement_count}"
        )
    return normalized


async def plan_and_execute(run_id: uuid.UUID) -> None:
    """Background entrypoint: plan the goal, then drive execution."""
    try:
        async with SessionLocal() as session:
            run = await session.get(Run, run_id)
            agents = (await session.execute(select(Agent))).scalars().all()
            roster = "\n".join(f"- {a.slug}: {a.description}" for a in agents)
            valid_slugs = {a.slug for a in agents}

            client = get_llm_client()
            settings = get_settings()
            # The "brain" call: planning quality gates the whole run, so it may
            # use a stronger model than the task executors (tiered routing).
            planner = settings.planner_model or settings.default_model
            response = await client.chat.completions.create(
                model=planner,
                messages=[
                    {
                        "role": "user",
                        "content": PLAN_PROMPT.format(
                            max_tasks=MAX_PLAN_TASKS, roster=roster, goal=run.goal
                        ),
                    }
                ],
                temperature=0.2,
            )
            plan = parse_plan(response.choices[0].message.content or "", valid_slugs)
            for i, spec in enumerate(plan):
                session.add(RunTask(run_id=run.id, ordinal=i, **spec))
            run.status = "running"
            await session.commit()
    except Exception:
        logger.exception("planning failed for run %s", run_id)
        async with SessionLocal() as session:
            run = await session.get(Run, run_id)
            if run:
                run.status = "failed"
                await session.commit()
        return

    await execute_run(run_id)


def _resolve_supersession(ordinal: int, by_ordinal: dict[int, RunTask]) -> RunTask | None:
    """Follow `superseded_by` transitively — e.g. task 3 superseded_by 7,
    task 7 superseded_by 9, resolves ordinal 3 to task 9: whichever task
    actually carries that ordinal's work forward today. Returns the
    terminal (non-superseded) RunTask, or None if `ordinal` isn't a real
    task.

    Bounded by the total task count rather than following `superseded_by`
    until it stops: that pointer only ever targets a strictly larger
    ordinal (see _apply_repair_plan), so a cycle should be unreachable, but
    a legitimate chain can never be longer than the number of tasks that
    exist. This guard costs nothing and turns a malformed/cyclic chain into
    "treated as unresolved" instead of an infinite loop — see the
    superseded-chain-of-depth-2 and cycle-safety tests.
    """
    current = by_ordinal.get(ordinal)
    for _ in range(len(by_ordinal) + 1):
        if current is None or current.status != "superseded" or current.superseded_by is None:
            return current
        current = by_ordinal.get(current.superseded_by)
    return None  # chain longer than the total task count -> malformed/cyclic


def _effectively_done(task: RunTask, by_ordinal: dict[int, RunTask]) -> bool:
    """A task counts toward the run's "did everything succeed" check either
    directly (status == "done"), or — since append-and-supersede never sets
    a superseded task's own status to "done" — by its supersession chain
    resolving to a task that succeeded. Lets a run where re-planning healed
    every stuck task still end "done" rather than "done_with_issues"."""
    if task.status == "done":
        return True
    if task.status == "superseded":
        resolved = _resolve_supersession(task.ordinal, by_ordinal)
        return resolved is not None and resolved.status == "done"
    return False


async def execute_run(run_id: uuid.UUID) -> None:
    """Drive the DAG until every task reaches a terminal state, or the run
    pauses for approval. A task's own failure no longer stops the run
    (Claude-Code-style: diagnose and keep going, see _execute_task) — only a
    task's *dependents* are affected, and only because they genuinely can
    never run: a "todo" task whose dependency ultimately failed or was
    skipped is marked "skipped" (propagated transitively through the DAG),
    while independent branches keep executing to completion.

    Layer 3 (append-and-supersede, see _attempt_replan): a "superseded" task
    is neither terminal-failing nor immediately done — its dependents wait
    for whatever replaced it. Dependency satisfaction ("is ordinal d done?")
    and skip-blocking ("did ordinal d's work ultimately fail?") both resolve
    THROUGH `superseded_by` transitively via _resolve_supersession, so
    existing depends_on arrays never need rewriting when a replacement is
    appended.

    Terminal run status: "done" only if every task succeeded (directly or
    via a successful replacement — _effectively_done), "awaiting_approval"
    while a review gate is open, otherwise "done_with_issues" once nothing
    is left to run (something failed or was skipped). This also guarantees
    the loop always terminates: it returns the instant there are no more
    "ready" tasks to dispatch, regardless of which branch set the final
    status.
    """
    # Ordinal -> inherited wall-clock deadline (an absolute time.monotonic()
    # cutoff), threaded through every _execute_task call for the life of
    # THIS execute_run invocation. When a stuck task gets superseded,
    # _attempt_replan writes the CURRENT task's own deadline in here under
    # the new replacement's ordinal, so the replacement's self-heal loop
    # shares that same cutoff instead of getting a fresh
    # settings.self_heal_deadline_seconds window. That is what bounds an
    # entire re-planning lineage (3 -> 7 -> 9 -> ...) by ONE deadline rather
    # than letting each generation reset the clock — without it, re-planning
    # would have no wall-clock bound at all, only ever a NEW per-task one.
    # Safe to mutate across the concurrent _execute_task calls below:
    # different tasks only ever touch DIFFERENT ordinal keys, and asyncio
    # coroutines never interleave mid dict-operation.
    deadlines: dict[int, float] = {}

    while True:
        async with SessionLocal() as session:
            tasks = (
                (await session.execute(select(RunTask).where(RunTask.run_id == run_id)))
                .scalars()
                .all()
            )
            by_ordinal = {t.ordinal: t for t in tasks}

            # A task is "blocked" — nothing depending on it can ever run —
            # if it directly failed/was skipped, OR its supersession chain
            # resolves to a task that did. A superseded task whose
            # replacement is still todo/in_progress resolves to that
            # (non-terminal) replacement, so it is NOT blocked yet — that's
            # what lets a superseded node's dependents wait instead of
            # being skipped.
            blocked: set[int] = set()
            for t in tasks:
                resolved = _resolve_supersession(t.ordinal, by_ordinal)
                if resolved is None or resolved.status in ("failed", "skipped"):
                    blocked.add(t.ordinal)

            # Propagate "skipped" to a fixed point: a dependency chain
            # A (failed) -> B (skipped) -> C (depends on B) also skips C.
            changed = True
            while changed:
                changed = False
                for t in tasks:
                    if t.status == "todo" and set(t.depends_on or []) & blocked:
                        t.status = "skipped"
                        blocked.add(t.ordinal)
                        changed = True

            # A dependency ordinal counts as satisfied either directly, or
            # (same resolution) once its replacement chain finishes
            # successfully. `context` mirrors that: a downstream task's
            # depends_on still names the ORIGINAL ordinal (never rewritten),
            # so its prompt-building code must find the REPLACEMENT's
            # result under that original key.
            done: set[int] = set()
            context: dict[int, str] = {}
            for t in tasks:
                resolved = _resolve_supersession(t.ordinal, by_ordinal)
                if resolved is not None and resolved.status == "done":
                    done.add(t.ordinal)
                    context[t.ordinal] = resolved.result

            ready, reviewing = [], False
            for t in tasks:
                if t.status == "review":
                    reviewing = True
                if t.status != "todo" or not set(t.depends_on or []) <= done:
                    continue
                if t.needs_approval:
                    t.status = "review"
                    reviewing = True
                else:
                    t.status = "in_progress"
                    ready.append(t.id)

            run = await session.get(Run, run_id)
            if not ready:
                if reviewing:
                    run.status = "awaiting_approval"
                elif all(_effectively_done(t, by_ordinal) for t in tasks):
                    run.status = "done"
                else:
                    # Nothing left to dispatch and not everything succeeded —
                    # some task failed and/or some dependents were skipped.
                    # (Also the safety net: with a non-cyclic DAG this is the
                    # only remaining case, but resolving to a terminal status
                    # here rather than looping is what guarantees this
                    # function always returns.)
                    run.status = "done_with_issues"
            await session.commit()
            if not ready:
                return
        await asyncio.gather(
            *(_execute_task(task_id, context, deadlines) for task_id in ready)
        )


async def _run_turn(
    conversation_id: uuid.UUID, prompt: str, model_override: str | None = None
) -> tuple[str, dict, str | None, dict]:
    """Run one stream_chat turn to completion. Returns (text, usage, error,
    evidence) — `usage` is {} when the turn errored (stream_chat only emits a
    "done" event, carrying usage, on a clean finish).

    `evidence` is rich failure context beyond the bare error string: which
    tool was last active and its raw output (from the "tool_call"/
    "tool_result"/"guardrail" SSE frames — see services/chat.py), a trimmed
    traceback, and any provider status_code/body already on the exception
    when stream_chat itself raises rather than yielding a sanitized "error"
    frame. Feeds classify_failure() and the repair prompt. Empty dict when
    there's nothing beyond the plain error message (the common case).

    `model_override` (self-heal escalation ladder, see _execute_task) is
    passed to stream_chat ONLY when set, rather than always forwarding it
    (even as None) — this keeps the call shape `stream_chat(conversation_id,
    prompt)` byte-for-byte identical to before this parameter existed on the
    common (unescalated) path, so every test double already monkeypatching
    `stream_chat` with a 2-argument fake keeps working unchanged."""
    text, usage, error = "", {}, None
    last_tool: str | None = None
    last_tool_output: str | None = None
    guardrail_flags: list | None = None
    try:
        stream = (
            stream_chat(conversation_id, prompt, model_override)
            if model_override
            else stream_chat(conversation_id, prompt)
        )
        async for frame in stream:
            event = json.loads(frame[6:])  # strip "data: " SSE framing
            etype = event["type"]
            if etype == "token":
                # Belt and braces. services/chat.py now normalises provider
                # content blocks to text at the source, but there are three
                # other runtimes emitting this event; a malformed token must
                # not be able to kill a task the way it did before, because
                # a crash here is unretryable — every attempt hits the same
                # provider response shape.
                content = event["content"]
                text += content if isinstance(content, str) else str(content or "")
            elif etype == "tool_call":
                last_tool = event.get("name")
            elif etype == "tool_result":
                if event.get("name") == last_tool:
                    last_tool_output = event.get("preview")
            elif etype == "guardrail":
                guardrail_flags = event.get("flags")
                last_tool = last_tool or event.get("tool")
            elif etype == "done":
                usage = event["usage"]
            elif etype == "error":
                error = event["message"]
    except Exception as exc:
        logger.exception("task turn crashed for conversation %s", conversation_id)
        # Include the message, not just the class. The self-heal loop feeds
        # this string back to the model as the thing to diagnose, and a bare
        # "TypeError" gives it nothing to work with — observed in a real run
        # where two repair attempts were asked to fix "TypeError" and
        # correctly concluded they were getting nowhere. It also feeds the
        # stall signature, so more detail means fewer false "same error"
        # matches between genuinely different failures.
        detail = str(exc).strip()
        error = f"{type(exc).__name__}: {detail}" if detail else type(exc).__name__
        evidence_exc: dict = {
            "traceback": _truncate(traceback.format_exc(), 2000),
            "error_type": type(exc).__name__,
        }
        status_code = getattr(exc, "status_code", None)
        if isinstance(status_code, int):
            evidence_exc["status_code"] = status_code
        body = getattr(exc, "body", None)
        if body is not None:
            evidence_exc["body"] = _truncate(str(body), 300)
    else:
        evidence_exc = {}

    evidence: dict = dict(evidence_exc)
    if last_tool:
        evidence["tool"] = last_tool
    if last_tool_output is not None:
        evidence["tool_output"] = _truncate(last_tool_output, 500)
    if guardrail_flags:
        evidence["guardrail"] = guardrail_flags
    return text, usage, error, evidence


# One asyncio.Lock per run, lazily created — serializes _attempt_replan's
# read-max-ordinal + append + supersede sequence. execute_run's
# asyncio.gather runs every "ready" task in a wave CONCURRENTLY; if two of
# them stall / hit a capability failure at the same moment, both would
# otherwise read the same "current max ordinal" and race onto the SAME new
# ordinal — RunTask has no DB-level uniqueness on (run_id, ordinal) to catch
# that. Entries are left in the dict for the process's lifetime rather than
# cleaned up after use — small, bounded by how many runs ever re-plan
# during this process's uptime, same "v1, in-process" pragmatism as
# services/queue.py's `_pool` global.
_replan_locks: dict[uuid.UUID, asyncio.Lock] = {}


def _replan_lock(run_id: uuid.UUID) -> asyncio.Lock:
    lock = _replan_locks.get(run_id)
    if lock is None:
        lock = asyncio.Lock()
        _replan_locks[run_id] = lock
    return lock


async def _attempt_replan(
    run_id: uuid.UUID,
    task_id: uuid.UUID,
    title: str,
    brief: str,
    deps: list[int],
    context: dict[int, str],
    error: str,
    classification: str,
    evidence: dict,
    deadline: float,
    deadlines: dict[int, float],
) -> tuple[int | None, str]:
    """Ask the orchestrator (planner-tier LLM) to propose a repair plan for
    a task that just exhausted its own self-repair (called only from
    _execute_task's "capability" and stall branches — see there). Never
    raises: any failure proposing or applying a plan is caught and reported
    as "no repair" so the caller's self-heal loop can fall back to its
    normal "stopping" path instead of crashing.

    Returns (replacement_ordinal, note). On success, replacement_ordinal is
    the new task's ordinal and the ORIGINAL task has already been committed
    as status="superseded" (superseded_by=replacement_ordinal) by the time
    this returns. On failure — the LLM call itself erroring, a malformed
    plan (parse_repair_plan raising ValueError), or an explicit "no useful
    plan" — replacement_ordinal is None and nothing was written; either way
    `note` is a short, human-readable reason for the caller's heal_log.
    """
    try:
        async with SessionLocal() as session:
            agents = (await session.execute(select(Agent))).scalars().all()
            hint_max_ordinal = (
                await session.execute(
                    select(func.max(RunTask.ordinal)).where(RunTask.run_id == run_id)
                )
            ).scalar_one()
        valid_slugs = {a.slug for a in agents}
        roster = "\n".join(f"- {a.slug}: {a.description}" for a in agents)

        dependency_context = (
            "\n\n".join(f"[Result of task {d}]\n{context.get(d, '')[:3000]}" for d in deps)
            or "(none)"
        )
        evidence_lines = [f"error: {error}"]
        if evidence.get("tool"):
            evidence_lines.append(f"tool: {evidence['tool']}")
        if evidence.get("tool_output"):
            evidence_lines.append(f"tool output: {evidence['tool_output']}")
        if evidence.get("guardrail"):
            evidence_lines.append(f"guardrail flags: {evidence['guardrail']}")
        if evidence.get("traceback"):
            evidence_lines.append(f"traceback: {evidence['traceback']}")

        prompt = REPAIR_PLAN_PROMPT.format(
            roster=roster,
            title=title,
            brief=brief,
            classification=classification,
            evidence="\n".join(evidence_lines),
            dependency_context=dependency_context,
            # Informational only (the actual ordinal numbering — and
            # depends_on validation — happens fresh under the lock below,
            # in case another task's repair plan appended tasks meanwhile).
            max_existing=(hint_max_ordinal or 0),
        )

        settings = get_settings()
        client = get_llm_client()
        planner = settings.planner_model or settings.default_model
        response = await client.chat.completions.create(
            model=planner,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.2,
        )
        response_text = response.choices[0].message.content or ""
    except Exception as exc:
        logger.exception("repair-plan call failed for task %s", task_id)
        return None, f"repair-plan call failed: {exc}"

    async with _replan_lock(run_id):
        try:
            async with SessionLocal() as session:
                task = await session.get(RunTask, task_id)
                max_ordinal = (
                    await session.execute(
                        select(func.max(RunTask.ordinal)).where(RunTask.run_id == run_id)
                    )
                ).scalar_one()
                next_ordinal = (max_ordinal or 0) + 1

                try:
                    normalized = parse_repair_plan(response_text, valid_slugs, next_ordinal)
                except ValueError as exc:
                    return None, f"repair plan rejected: {exc}"
                if normalized is None:
                    return None, "orchestrator proposed no useful repair plan"

                helper_ordinals = [
                    next_ordinal + i
                    for i, spec in enumerate(normalized)
                    if not spec["replacement"]
                ]
                replacement_ordinal = next(
                    next_ordinal + i for i, spec in enumerate(normalized) if spec["replacement"]
                )
                replacement_agent = next(
                    spec["agent_slug"] for spec in normalized if spec["replacement"]
                )

                new_rows = []
                for i, spec in enumerate(normalized):
                    ordinal = next_ordinal + i
                    if spec["replacement"]:
                        # Deterministic, NOT the model's proposed depends_on
                        # (which the prompt tells it to omit anyway): the
                        # replacement redoes the stuck task's work, so it
                        # needs everything the original depended on, plus
                        # every helper this same plan just added.
                        row_deps = sorted(set(task.depends_on or []) | set(helper_ordinals))
                        description = spec["description"] or brief
                    else:
                        row_deps = spec["depends_on"]
                        description = spec["description"]
                    new_rows.append(
                        RunTask(
                            run_id=run_id,
                            ordinal=ordinal,
                            title=spec["title"],
                            description=description,
                            agent_slug=spec["agent_slug"],
                            depends_on=row_deps,
                            needs_approval=spec["needs_approval"],
                            status="todo",
                        )
                    )
                session.add_all(new_rows)

                task.status = "superseded"
                task.superseded_by = replacement_ordinal
                await session.commit()

            # Propagate THIS task's own (possibly already-inherited)
            # deadline forward to the replacement — see execute_run's
            # `deadlines` comment: it's what bounds an entire re-planning
            # lineage by one wall-clock window instead of each generation
            # resetting the clock.
            deadlines[replacement_ordinal] = deadline
        except Exception as exc:
            logger.exception("failed to apply repair plan for task %s", task_id)
            return None, f"failed to apply repair plan: {exc}"

    note = (
        f"added {len(helper_ordinals)} helper task(s) and replacement ordinal "
        f"{replacement_ordinal} (agent {replacement_agent})"
    )
    return replacement_ordinal, note


async def _execute_task(
    task_id: uuid.UUID, context: dict[int, str], deadlines: dict[int, float]
) -> None:
    """Run one task through the chat runtime (tools/metering/tracing
    included), self-healing on failure rather than giving up.

    A failed attempt is fed back as a FOLLOW-UP turn into the SAME
    conversation, describing the error and asking the agent to diagnose and
    try a different approach — this inherits conversation memory, tools,
    guardrails, metering, and tracing from stream_chat for free, with no
    separate diagnosis pipeline or second model client.

    There is deliberately NO fixed attempt cap. Retrying stops only when:
      1. it stopped improving — the normalized error signature repeats from
         the immediately preceding attempt (self-improvement has stalled);
      2. the wall-clock deadline (settings.self_heal_deadline_seconds) for
         this task has passed;
      3. the budget is exhausted (services.budget.check_budget);
      4. the failure is classified "capability" (classify_failure) — a
         missing/invalid credential, unknown tool, or a bug in our own code.
         Structurally unfixable by retrying, so it stops on the FIRST
         occurrence without spending an LLM reasoning turn.

    Every other failure is classified "transient" (provider blip — retry the
    SAME prompt after a short backoff, no reasoning turn) or "approach" (the
    model did something wrong — the existing LLM repair turn, now carrying
    rich evidence from _run_turn). Both remain subject to (1)-(3) above, so
    a transient failure that never stops recurring still terminates via
    stall/deadline rather than looping forever.

    Escalation ladder (Layer 2, settings.self_heal_escalation_models): attempt
    1 always uses the agent's own model. Retrying an "approach" failure on
    the SAME model that just failed is the weakest available move, so each
    approach-class failure advances one rung up a configured ladder of
    progressively stronger models for the NEXT attempt — a "transient"
    failure never advances it, since the model was never the problem. Once
    the ladder is exhausted, repairs keep using the strongest rung rather
    than stopping. This only ever changes WHICH model an attempt uses; it
    introduces no counter and no cap — stopping is still governed
    exclusively by (1)-(4) above.
    """
    async with SessionLocal() as session:
        task = await session.get(RunTask, task_id)
        agent = (
            await session.execute(select(Agent).where(Agent.slug == task.agent_slug))
        ).scalar_one()
        agent_id = agent.id
        # Captured now (while the session is open) rather than read off
        # `agent` later: this is attempt 1's model and the ladder's rung-0
        # fallback, needed after this session block closes.
        agent_model = agent.model
        conversation = Conversation(agent_id=agent.id, title=f"run-task {task.title[:50]}")
        session.add(conversation)
        await session.commit()
        conversation_id = conversation.id
        deps = task.depends_on or []
        brief = task.description or task.title
        # Captured for Layer 3 re-planning (_attempt_replan, below) — the
        # run/ordinal this task belongs to and its own title, needed after
        # this session block closes.
        run_id = task.run_id
        task_ordinal = task.ordinal
        task_title = task.title

    prior = "\n\n".join(f"[Result of task {d}]\n{context.get(d, '')[:3000]}" for d in deps)
    prompt = f"{prior}\n\nYour task: {brief}" if prior else f"Your task: {brief}"
    # Kept verbatim so every repair turn can re-state the real deliverable
    # rather than drifting into a conversation about the error.
    prompt_original = prompt

    settings = get_settings()
    # Layer 3: a replacement task appended by _attempt_replan inherits its
    # predecessor's own deadline (see execute_run's `deadlines` comment)
    # instead of getting a fresh settings.self_heal_deadline_seconds window
    # — that's what bounds an ENTIRE re-planning lineage by one wall-clock
    # cutoff rather than letting each new generation reset the clock. Absent
    # for an ordinary (non-replacement) task, exactly like before this
    # existed.
    inherited_deadline = deadlines.pop(task_ordinal, None)
    deadline = (
        inherited_deadline
        if inherited_deadline is not None
        else time.monotonic() + settings.self_heal_deadline_seconds
    )
    attempts = 0
    prior_signature: str | None = None
    heal_log: list[dict] = []
    text, usage, error = "", {}, None
    evidence: dict = {}
    # Set by a successful _attempt_replan call (capability/stall branches,
    # below) — non-None means this task ended "superseded", not
    # "done"/"failed", and the final status block must not override it.
    superseded_ordinal: int | None = None

    # Escalation ladder (Layer 2): attempt 1 uses the agent's own model
    # (model_override stays None, rung stays 0 — byte-for-byte today's
    # behaviour). Only an "approach"-classified repair attempt that then
    # FAILS advances `rung` by one, via the ladder branch below; a
    # "transient" provider blip never touches `rung` — the model was never
    # the problem, so retrying it isn't wasted, and escalating past it
    # would burn the ladder on infrastructure noise instead of saving it
    # for genuine reasoning failures. Once `rung` reaches len(ladder) it
    # stays there: repairs keep using the strongest configured model rather
    # than stopping — escalation only ever changes WHICH model the next
    # attempt uses, never whether there IS a next attempt (that stays the
    # job of stall/deadline/budget/capability below, no fixed attempt cap).
    ladder = _escalation_ladder(settings)
    rung = 0
    model_override: str | None = None

    # Metering must cover EVERY attempt, not just the last one. Budget
    # enforcement reads Message rows (see services/budget.py) so it already
    # counts all turns, but RunTask's display copy is what the board shows —
    # reporting only the final attempt would under-state what a task that
    # healed across several attempts actually cost.
    spent = {"tokens_in": 0, "tokens_out": 0, "cost_usd": 0.0, "latency_ms": 0}

    while True:
        attempts += 1
        text, usage, error, evidence = await _run_turn(conversation_id, prompt, model_override)
        spent["tokens_in"] += usage.get("tokens_in", 0) or 0
        spent["tokens_out"] += usage.get("tokens_out", 0) or 0
        spent["cost_usd"] += float(usage.get("cost_usd", 0) or 0)
        spent["latency_ms"] += usage.get("latency_ms", 0) or 0
        if not (error and not text):
            if heal_log:
                heal_log[-1]["resolved"] = True
            break  # succeeded (possibly after one or more repairs)

        classification = classify_failure(error, evidence)
        # The model THIS attempt (the one that just failed) actually used —
        # resolves to agent_model on rung 0, exactly like before escalation
        # existed.
        model_used = model_override or agent_model

        async with SessionLocal() as session:
            violation = await check_budget(session, agent_id)
        if violation:
            heal_log.append(
                _heal_entry(
                    attempts,
                    error,
                    _truncate(f"Stopping: {violation}"),
                    classification,
                    evidence,
                    model_used,
                )
            )
            break

        if time.monotonic() >= deadline:
            heal_log.append(
                _heal_entry(
                    attempts,
                    error,
                    "Stopping: self-heal deadline exceeded.",
                    classification,
                    evidence,
                    model_used,
                )
            )
            break

        if classification == "capability":
            # Structurally unfixable by this node — no stall check needed
            # and no LLM reasoning turn spent retrying the SAME approach.
            # This is exactly the case that used to burn two repair
            # attempts on a TypeError in our own code. But before giving up
            # outright, Layer 3: ask the orchestrator whether the SHAPE of
            # the work should change (e.g. a different agent that actually
            # has the missing capability) rather than failing this node.
            replacement_ordinal, replan_note = await _attempt_replan(
                run_id,
                task_id,
                task_title,
                brief,
                deps,
                context,
                error,
                classification,
                evidence,
                deadline,
                deadlines,
            )
            if replacement_ordinal is not None:
                superseded_ordinal = replacement_ordinal
                heal_log.append(
                    _heal_entry(
                        attempts,
                        error,
                        "Re-planned instead of failing: needs a capability this agent "
                        f"doesn't have — {replan_note}.",
                        classification,
                        evidence,
                        model_used,
                    )
                )
            else:
                heal_log.append(
                    _heal_entry(
                        attempts,
                        error,
                        "Stopping: needs a capability this agent doesn't have (missing "
                        "credential / platform error) — retrying cannot fix it. Tried "
                        f"re-planning first: {replan_note}.",
                        classification,
                        evidence,
                        model_used,
                    )
                )
            break

        signature = _error_signature(error)
        if prior_signature is not None and signature == prior_signature:
            # Self-improvement has stalled on this node's own approach.
            # Layer 3, same as the capability branch above: ask the
            # orchestrator for a repair plan before giving up — maybe this
            # needs a missing step first, or a different agent entirely.
            replacement_ordinal, replan_note = await _attempt_replan(
                run_id,
                task_id,
                task_title,
                brief,
                deps,
                context,
                error,
                classification,
                evidence,
                deadline,
                deadlines,
            )
            if replacement_ordinal is not None:
                superseded_ordinal = replacement_ordinal
                heal_log.append(
                    _heal_entry(
                        attempts,
                        error,
                        "Re-planned instead of failing: repeated the same error — "
                        f"self-improvement stalled — {replan_note}.",
                        classification,
                        evidence,
                        model_used,
                    )
                )
            else:
                heal_log.append(
                    _heal_entry(
                        attempts,
                        error,
                        "Stopping: repeated the same error — self-improvement stalled. "
                        f"Tried re-planning first: {replan_note}.",
                        classification,
                        evidence,
                        model_used,
                    )
                )
            break

        if classification == "transient":
            # Infrastructure blip, not a reasoning problem — retry the SAME
            # prompt after a short backoff instead of spending an LLM turn.
            # Still subject to the stall/deadline checks above, so a
            # transient error that never stops recurring still terminates.
            # `model_override`/`rung` are DELIBERATELY untouched here — a
            # transient failure never consumes a ladder rung.
            await asyncio.sleep(settings.self_heal_transient_backoff_seconds)
            heal_log.append(
                _heal_entry(
                    attempts,
                    error,
                    "Retried the same prompt after a short backoff — no reasoning "
                    "turn spent (transient failure).",
                    classification,
                    evidence,
                    model_used,
                )
            )
            prior_signature = signature
            # prompt intentionally unchanged — same prompt, no follow-up.
        else:
            # "approach": retrying on the SAME model that just failed is the
            # weakest available move — escalate to the next ladder rung (if
            # any configured) BEFORE building the repair turn, so the
            # follow-up actually runs on a stronger model. Ladder exhausted
            # (rung already at len(ladder)) or empty -> min() keeps `rung`
            # right where it is, so model_override stays whatever it already
            # was (or None on an empty ladder) — repairs keep using the
            # strongest rung reached rather than stopping.
            if ladder:
                rung = min(rung + 1, len(ladder))
                model_override = ladder[rung - 1]
            # re-state the ORIGINAL task in every repair turn. Asking only
            # to "diagnose and try again" makes the model narrate the
            # failure, and that narration then becomes the task's stored
            # result — verified against the live model, which answered a
            # "name a fruit" task with an essay about the upstream error.
            # The deliverable must stay the deliverable: diagnose privately
            # (now with rich evidence), then answer the original brief.
            follow_up = _build_repair_prompt(error, evidence, prompt_original)
            diagnosis = "Retried with a different approach."
            if model_override:
                diagnosis += f" Escalated to {model_override}."
            # Store a SHORT note, not the follow-up prompt itself. That
            # prompt now re-states the whole original brief plus evidence,
            # so logging it verbatim would write a lot per attempt into the
            # row and bury the actual cause on the board. _heal_entry's
            # truncated `evidence` field is the useful part. `model` here is
            # the NEXT attempt's model (post-escalation), so a `resolved`
            # entry shows which model actually produced the fix.
            heal_log.append(
                _heal_entry(
                    attempts,
                    error,
                    diagnosis,
                    classification,
                    evidence,
                    model_override or agent_model,
                )
            )
            prior_signature = signature
            prompt = follow_up

    async with SessionLocal() as session:
        task = await session.get(RunTask, task_id)
        if superseded_ordinal is not None:
            # Already committed as status="superseded"/superseded_by=... by
            # _attempt_replan — don't override it here. Metering below still
            # applies: every attempt this (now-superseded) task actually
            # made still cost real tokens/time and belongs on its row.
            pass
        elif error and not text:
            task.status = "failed"
            task.error = _truncate(error)
        else:
            task.status = "done"
            task.result = text
        task.attempts = attempts
        task.heal_log = heal_log
        task.tokens_in = spent["tokens_in"]
        task.tokens_out = spent["tokens_out"]
        task.cost_usd = spent["cost_usd"]
        task.latency_ms = spent["latency_ms"] or None
        await session.commit()
        outcome = task.status
    logger.info("task %s -> %s (attempts=%d)", task_id, outcome, attempts)
