"""Run orchestration: plan a goal into a task DAG, execute it with agents.

Each task executes THROUGH the chat runtime (stream_chat) via a throwaway
conversation — inheriting tools, metering, Langfuse tracing, and the
salvage logic for free. Ready tasks run in parallel (asyncio.gather);
tasks flagged needs_approval pause in "review" until a human approves.

v1 executes in-process (asyncio task); the arq worker split happens with
the packaging milestone (ARCHITECTURE.md ADR-004).
"""

import asyncio
import json
import logging
import re
import time
import uuid

from sqlalchemy import select

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


def parse_plan(text: str, valid_slugs: set[str]) -> list[dict]:
    """Extract and normalize the plan JSON; raises ValueError on garbage."""
    cleaned = text.strip()
    if "```" in cleaned:  # tolerate markdown fences
        cleaned = cleaned.split("```")[1]
        cleaned = cleaned.removeprefix("json").strip()
    start, end = cleaned.find("{"), cleaned.rfind("}")
    if start == -1 or end == -1:
        raise ValueError("no JSON object in plan")
    plan = json.loads(cleaned[start : end + 1])
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


async def execute_run(run_id: uuid.UUID) -> None:
    """Drive the DAG until every task reaches a terminal state, or the run
    pauses for approval. A task's own failure no longer stops the run
    (Claude-Code-style: diagnose and keep going, see _execute_task) — only a
    task's *dependents* are affected, and only because they genuinely can
    never run: a "todo" task whose dependency ultimately failed or was
    skipped is marked "skipped" (propagated transitively through the DAG),
    while independent branches keep executing to completion.

    Terminal run status: "done" only if every task succeeded,
    "awaiting_approval" while a review gate is open, otherwise
    "done_with_issues" once nothing is left to run (something failed or was
    skipped). This also guarantees the loop always terminates: it returns
    the instant there are no more "ready" tasks to dispatch, regardless of
    which branch set the final status.
    """
    while True:
        async with SessionLocal() as session:
            tasks = (
                (await session.execute(select(RunTask).where(RunTask.run_id == run_id)))
                .scalars()
                .all()
            )
            by_ordinal = {t.ordinal: t for t in tasks}

            # Propagate "skipped" to a fixed point: a dependency chain
            # A (failed) -> B (skipped) -> C (depends on B) also skips C.
            blocked = {t.ordinal for t in tasks if t.status in ("failed", "skipped")}
            changed = True
            while changed:
                changed = False
                for t in tasks:
                    if t.status == "todo" and set(t.depends_on or []) & blocked:
                        t.status = "skipped"
                        blocked.add(t.ordinal)
                        changed = True

            done = {t.ordinal for t in tasks if t.status == "done"}
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
                elif all(t.status == "done" for t in tasks):
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
            context = {o: by_ordinal[o].result for o in done}
        await asyncio.gather(*(_execute_task(task_id, context) for task_id in ready))


async def _run_turn(conversation_id: uuid.UUID, prompt: str) -> tuple[str, dict, str | None]:
    """Run one stream_chat turn to completion. Returns (text, usage, error) —
    `usage` is {} when the turn errored (stream_chat only emits a "done"
    event, carrying usage, on a clean finish)."""
    text, usage, error = "", {}, None
    try:
        async for frame in stream_chat(conversation_id, prompt):
            event = json.loads(frame[6:])  # strip "data: " SSE framing
            if event["type"] == "token":
                # Belt and braces. services/chat.py now normalises provider
                # content blocks to text at the source, but there are three
                # other runtimes emitting this event; a malformed token must
                # not be able to kill a task the way it did before, because
                # a crash here is unretryable — every attempt hits the same
                # provider response shape.
                content = event["content"]
                text += content if isinstance(content, str) else str(content or "")
            elif event["type"] == "done":
                usage = event["usage"]
            elif event["type"] == "error":
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
    return text, usage, error


async def _execute_task(task_id: uuid.UUID, context: dict[int, str]) -> None:
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
      3. the budget is exhausted (services.budget.check_budget).
    """
    async with SessionLocal() as session:
        task = await session.get(RunTask, task_id)
        agent = (
            await session.execute(select(Agent).where(Agent.slug == task.agent_slug))
        ).scalar_one()
        agent_id = agent.id
        conversation = Conversation(agent_id=agent.id, title=f"run-task {task.title[:50]}")
        session.add(conversation)
        await session.commit()
        conversation_id = conversation.id
        deps = task.depends_on or []
        brief = task.description or task.title

    prior = "\n\n".join(f"[Result of task {d}]\n{context.get(d, '')[:3000]}" for d in deps)
    prompt = f"{prior}\n\nYour task: {brief}" if prior else f"Your task: {brief}"
    # Kept verbatim so every repair turn can re-state the real deliverable
    # rather than drifting into a conversation about the error.
    prompt_original = prompt

    settings = get_settings()
    deadline = time.monotonic() + settings.self_heal_deadline_seconds
    attempts = 0
    prior_signature: str | None = None
    heal_log: list[dict] = []
    text, usage, error = "", {}, None

    # Metering must cover EVERY attempt, not just the last one. Budget
    # enforcement reads Message rows (see services/budget.py) so it already
    # counts all turns, but RunTask's display copy is what the board shows —
    # reporting only the final attempt would under-state what a task that
    # healed across several attempts actually cost.
    spent = {"tokens_in": 0, "tokens_out": 0, "cost_usd": 0.0, "latency_ms": 0}

    while True:
        attempts += 1
        text, usage, error = await _run_turn(conversation_id, prompt)
        spent["tokens_in"] += usage.get("tokens_in", 0) or 0
        spent["tokens_out"] += usage.get("tokens_out", 0) or 0
        spent["cost_usd"] += float(usage.get("cost_usd", 0) or 0)
        spent["latency_ms"] += usage.get("latency_ms", 0) or 0
        if not (error and not text):
            if heal_log:
                heal_log[-1]["resolved"] = True
            break  # succeeded (possibly after one or more repairs)

        async with SessionLocal() as session:
            violation = await check_budget(session, agent_id)
        if violation:
            heal_log.append(
                {
                    "attempt": attempts,
                    "error": _truncate(error),
                    "diagnosis": _truncate(f"Stopping: {violation}"),
                    "resolved": False,
                }
            )
            break

        if time.monotonic() >= deadline:
            heal_log.append(
                {
                    "attempt": attempts,
                    "error": _truncate(error),
                    "diagnosis": "Stopping: self-heal deadline exceeded.",
                    "resolved": False,
                }
            )
            break

        signature = _error_signature(error)
        if prior_signature is not None and signature == prior_signature:
            heal_log.append(
                {
                    "attempt": attempts,
                    "error": _truncate(error),
                    "diagnosis": "Stopping: repeated the same error — self-improvement stalled.",
                    "resolved": False,
                }
            )
            break

        # Re-state the ORIGINAL task in every repair turn. Asking only to
        # "diagnose and try again" makes the model narrate the failure, and
        # that narration then becomes the task's stored result — verified
        # against the live model, which answered a "name a fruit" task with
        # an essay about the upstream error. The deliverable must stay the
        # deliverable: diagnose privately, then answer the original brief.
        follow_up = (
            f"That attempt failed with this error: {error}\n\n"
            "Work out what went wrong and take a different approach. Do not repeat "
            "the action that just failed.\n\n"
            f"Then complete the original task and reply with ONLY its final result:\n{prompt_original}"
        )
        # Store a SHORT note, not the follow-up prompt itself. That prompt now
        # re-states the whole original brief, so logging it verbatim wrote
        # several hundred characters per attempt into the row and buried the
        # actual cause on the board. The error above is the useful part.
        heal_log.append(
            {
                "attempt": attempts,
                "error": _truncate(error),
                "diagnosis": "Retried with a different approach.",
                "resolved": False,
            }
        )
        prior_signature = signature
        prompt = follow_up

    async with SessionLocal() as session:
        task = await session.get(RunTask, task_id)
        if error and not text:
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
