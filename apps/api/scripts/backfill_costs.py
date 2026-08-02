"""Recompute Message.cost_usd and RunTask.cost_usd from each row's stored
model + token counts, using app.costs's current pricing table.

Why this exists: app/costs.py originally priced only two model prefixes
("claude-sonnet", "claude-haiku"), so every row ever inserted against the
real default model (openai/gpt-oss-120b) was metered at $0. Fixing
app/costs.py prices NEW rows correctly going forward, but existing rows are
still stuck at their old (wrong) cost -- this script brings them up to
date without waiting for new traffic to flush the bad values out.

Idempotent: recomputing a row that's already correct is a no-op (same
model + same tokens -> same cost_usd, so no UPDATE is issued and re-running
this any number of times converges, it doesn't drift). Batched (default 500
rows per page, ordered by primary key) so a large table is never loaded
into memory at once.

Rows priced from a model app.costs doesn't recognize (app.costs.is_priced()
is False) are left COMPLETELY UNCHANGED and counted separately as "skipped:
unpriced" -- never zeroed out and never guessed at.

RunTask has no `model` column of its own -- a single task can span several
self-heal attempts at DIFFERENT models (services/orchestrator.py's
escalation ladder), and only the final SUMMED tokens_in/tokens_out survive
on the row, not a per-attempt breakdown (heal_log records which model each
attempt used, but not that attempt's token counts). This script prices each
RunTask using its agent's CURRENT model (RunTask.agent_slug -> Agent.model)
-- the same model rung-0 (no escalation) attempts always use, and the best
available approximation for tasks that did escalate mid-run. That
approximation is called out here, not hidden: a task that actually
escalated to a differently-priced model may come out slightly off from
what it truly cost. A RunTask whose agent_slug no longer matches any Agent
row is skipped as unpriced, same as an unrecognized model string.

Usage:
    uv run python -m scripts.backfill_costs              # dry run (default)
    uv run python -m scripts.backfill_costs --apply       # write changes
    uv run python -m scripts.backfill_costs --apply --batch-size 200

Defaults to a DRY RUN (reports what would change, writes nothing) so
running this against a real database is always a deliberate, visible
choice -- pass --apply to actually commit the recomputed costs.
"""

import argparse
import asyncio

from sqlalchemy import select

from app.costs import cost_usd, is_priced
from app.db import SessionLocal
from app.models import Agent, Message, RunTask

DEFAULT_BATCH_SIZE = 500


async def _backfill_messages(batch_size: int, apply: bool) -> tuple[int, int, float, float]:
    """Returns (rows_updated, rows_skipped_unpriced, total_before, total_after)."""
    updated = 0
    skipped = 0
    total_before = 0.0
    total_after = 0.0
    last_id = None

    while True:
        async with SessionLocal() as session:
            query = select(Message).order_by(Message.id).limit(batch_size)
            if last_id is not None:
                query = query.where(Message.id > last_id)
            rows = (await session.execute(query)).scalars().all()
            if not rows:
                break

            for row in rows:
                last_id = row.id
                before = float(row.cost_usd or 0)
                total_before += before
                if not is_priced(row.model):
                    skipped += 1
                    total_after += before
                    continue
                new_cost = cost_usd(row.model, row.tokens_in or 0, row.tokens_out or 0)
                total_after += new_cost
                if round(new_cost, 6) != round(before, 6):
                    updated += 1
                    if apply:
                        row.cost_usd = new_cost

            if apply:
                await session.commit()

    return updated, skipped, total_before, total_after


async def _backfill_run_tasks(batch_size: int, apply: bool) -> tuple[int, int, float, float]:
    """Returns (rows_updated, rows_skipped_unpriced, total_before, total_after)."""
    updated = 0
    skipped = 0
    total_before = 0.0
    total_after = 0.0
    last_id = None

    while True:
        async with SessionLocal() as session:
            query = select(RunTask).order_by(RunTask.id).limit(batch_size)
            if last_id is not None:
                query = query.where(RunTask.id > last_id)
            rows = (await session.execute(query)).scalars().all()
            if not rows:
                break

            agent_slugs = {row.agent_slug for row in rows}
            agents = (
                (await session.execute(select(Agent).where(Agent.slug.in_(agent_slugs))))
                .scalars()
                .all()
            )
            model_by_slug = {a.slug: a.model for a in agents}

            for row in rows:
                last_id = row.id
                before = float(row.cost_usd or 0)
                total_before += before
                model = model_by_slug.get(row.agent_slug)
                if not model or not is_priced(model):
                    skipped += 1
                    total_after += before
                    continue
                new_cost = cost_usd(model, row.tokens_in or 0, row.tokens_out or 0)
                total_after += new_cost
                if round(new_cost, 6) != round(before, 6):
                    updated += 1
                    if apply:
                        row.cost_usd = new_cost

            if apply:
                await session.commit()

    return updated, skipped, total_before, total_after


async def main(batch_size: int, apply: bool) -> None:
    msg_updated, msg_skipped, msg_before, msg_after = await _backfill_messages(batch_size, apply)
    task_updated, task_skipped, task_before, task_after = await _backfill_run_tasks(
        batch_size, apply
    )

    mode = "APPLIED (changes written)" if apply else "DRY RUN (no changes written)"
    print(f"backfill_costs -- {mode}")
    print()
    header = f"{'':12}{'updated':>10}{'skipped':>10}{'before':>16}{'after':>16}"
    print(header)
    print("-" * len(header))
    print(
        f"{'messages':12}{msg_updated:>10}{msg_skipped:>10}"
        f"{msg_before:>16.6f}{msg_after:>16.6f}"
    )
    print(
        f"{'run_tasks':12}{task_updated:>10}{task_skipped:>10}"
        f"{task_before:>16.6f}{task_after:>16.6f}"
    )
    print()
    print(f"total cost_usd: ${msg_before + task_before:,.6f} -> ${msg_after + task_after:,.6f}")
    if not apply:
        print("Dry run only -- pass --apply to write these changes.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Recompute Message/RunTask cost_usd from stored model + token counts."
    )
    parser.add_argument(
        "--batch-size", type=int, default=DEFAULT_BATCH_SIZE, help="rows per page (default 500)"
    )
    parser.add_argument(
        "--apply", action="store_true", help="write recomputed costs (default is dry run)"
    )
    args = parser.parse_args()
    asyncio.run(main(batch_size=args.batch_size, apply=args.apply))
