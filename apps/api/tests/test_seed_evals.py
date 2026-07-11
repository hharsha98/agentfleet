"""Tests for scripts.seed_evals: idempotent seeding of golden eval cases for
the built-in agents.

Same single-event-loop pattern as test_evals.py (see that file's docstring)
— dispose the engine first so every connection this test's pool hands out is
created fresh on THIS test's event loop.
"""

from sqlalchemy import select

from app.db import SessionLocal, engine
from app.models import Agent, EvalCase
from scripts.seed_agents import BUILTIN
from scripts.seed_agents import main as seed_agents
from scripts.seed_evals import main as seed_evals


async def _case_counts(slugs: list[str]) -> dict[str, int]:
    counts: dict[str, int] = {}
    async with SessionLocal() as session:
        for slug in slugs:
            agent = (
                await session.execute(select(Agent).where(Agent.slug == slug))
            ).scalar_one_or_none()
            if agent is None:
                counts[slug] = 0
                continue
            cases = (
                (await session.execute(select(EvalCase).where(EvalCase.agent_id == agent.id)))
                .scalars()
                .all()
            )
            counts[slug] = len(cases)
    return counts


async def test_seed_evals_idempotent() -> None:
    await engine.dispose()
    await seed_agents()

    builtin_slugs = [spec["slug"] for spec in BUILTIN]

    try:
        await seed_evals()
        counts_first = await _case_counts(builtin_slugs)
        for slug in builtin_slugs:
            assert counts_first[slug] >= 1, f"{slug} has no eval cases after seeding"

        # Re-run: idempotent, must not duplicate existing cases.
        await seed_evals()
        counts_second = await _case_counts(builtin_slugs)
        assert counts_second == counts_first, "re-running seed_evals duplicated cases"
    finally:
        # Cleanup: delete the eval cases we created so re-runs of the test
        # suite (and the CI eval gate) stay unaffected by this test.
        async with SessionLocal() as session:
            for slug in builtin_slugs:
                agent = (
                    await session.execute(select(Agent).where(Agent.slug == slug))
                ).scalar_one_or_none()
                if agent is None:
                    continue
                cases = (
                    (await session.execute(select(EvalCase).where(EvalCase.agent_id == agent.id)))
                    .scalars()
                    .all()
                )
                for case in cases:
                    await session.delete(case)
            await session.commit()
        await engine.dispose()
