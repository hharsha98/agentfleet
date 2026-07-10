"""Regression gate: run every agent's eval suite and fail CI on a low score.

Usage: uv run python -m scripts.run_evals

Iterates every agent that has at least one eval case, runs it through
app.services.evals.run_eval, and prints a score table. Exits 1 if any
agent's pass rate is below EVAL_THRESHOLD (env, float 0-1, default 1.0 —
all cases must pass). Intended to run in CI once a provider key is
configured (see .github/workflows/evals.yml).
"""

import asyncio
import os
import sys

from sqlalchemy import distinct, select

from app.db import SessionLocal
from app.models import Agent, EvalCase
from app.services.evals import run_eval


async def main() -> int:
    threshold = float(os.environ.get("EVAL_THRESHOLD", "1.0"))

    async with SessionLocal() as session:
        agent_ids = (
            (await session.execute(select(distinct(EvalCase.agent_id)))).scalars().all()
        )
        if not agent_ids:
            print("No agents have eval cases — nothing to run.")
            return 0

        rows: list[tuple[str, int, int]] = []
        failed = False
        for agent_id in agent_ids:
            agent = await session.get(Agent, agent_id)
            if agent is None:
                continue
            run = await run_eval(session, agent_id)
            rows.append((agent.slug, run.passed, run.total))
            rate = (run.passed / run.total) if run.total else 1.0
            if rate < threshold:
                failed = True

    header = f"{'agent':<24} {'passed/total':<14} {'rate':<8}"
    print(header)
    print("-" * len(header))
    for slug, passed, total in rows:
        rate = (passed / total) if total else 1.0
        print(f"{slug:<24} {f'{passed}/{total}':<14} {rate:.0%}")

    if failed:
        print(f"\nFAILED — one or more agents scored below threshold ({threshold:.0%}).")
        return 1
    print(f"\nOK — all agents met threshold ({threshold:.0%}).")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
