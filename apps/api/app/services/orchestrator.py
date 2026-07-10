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
import uuid

from sqlalchemy import select

from app.db import SessionLocal
from app.models import Agent, Conversation, Run, RunTask
from app.providers import get_llm_client
from app.services.chat import stream_chat

logger = logging.getLogger(__name__)

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
            model = next(a.model for a in agents)
            response = await client.chat.completions.create(
                model=model,
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
    """Drive the DAG until done, failed, or paused for approval."""
    while True:
        async with SessionLocal() as session:
            tasks = (
                (await session.execute(select(RunTask).where(RunTask.run_id == run_id)))
                .scalars()
                .all()
            )
            by_ordinal = {t.ordinal: t for t in tasks}
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
            if any(t.status == "failed" for t in tasks):
                run.status = "failed"
            elif not ready and not reviewing and all(t.status == "done" for t in tasks):
                run.status = "done"
            elif not ready and reviewing:
                run.status = "awaiting_approval"
            await session.commit()
            if run.status in ("done", "failed", "awaiting_approval") and not ready:
                return
            context = {o: by_ordinal[o].result for o in done}
        if not ready:
            return
        await asyncio.gather(*(_execute_task(task_id, context) for task_id in ready))


async def _execute_task(task_id: uuid.UUID, context: dict[int, str]) -> None:
    """Run one task through the chat runtime (tools/metering/tracing included)."""
    async with SessionLocal() as session:
        task = await session.get(RunTask, task_id)
        agent = (
            await session.execute(select(Agent).where(Agent.slug == task.agent_slug))
        ).scalar_one()
        conversation = Conversation(agent_id=agent.id, title=f"run-task {task.title[:50]}")
        session.add(conversation)
        await session.commit()
        conversation_id = conversation.id
        deps = task.depends_on or []
        brief = task.description or task.title

    prior = "\n\n".join(f"[Result of task {d}]\n{context.get(d, '')[:3000]}" for d in deps)
    prompt = f"{prior}\n\nYour task: {brief}" if prior else f"Your task: {brief}"

    text, usage, error = "", {}, None
    try:
        async for frame in stream_chat(conversation_id, prompt):
            event = json.loads(frame[6:])  # strip "data: " SSE framing
            if event["type"] == "token":
                text += event["content"]
            elif event["type"] == "done":
                usage = event["usage"]
            elif event["type"] == "error":
                error = event["message"]
    except Exception as exc:
        logger.exception("task %s crashed", task_id)
        error = f"{type(exc).__name__}"

    async with SessionLocal() as session:
        task = await session.get(RunTask, task_id)
        if error and not text:
            task.status = "failed"
            task.error = error[:300]
        else:
            task.status = "done"
            task.result = text
        task.tokens_in = usage.get("tokens_in", 0)
        task.tokens_out = usage.get("tokens_out", 0)
        task.cost_usd = usage.get("cost_usd", 0)
        task.latency_ms = usage.get("latency_ms")
        await session.commit()
        outcome = task.status
    logger.info("task %s -> %s", task_id, outcome)
