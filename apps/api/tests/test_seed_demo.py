"""Smoke the public-demo dataset seeder.

scripts.seed_demo is what SEED_DEMO_DATA=1 runs on a Space boot. If it
stops inserting marked rows, /missions and /usage on the hosted demo go
blank and look unfinished. This is a presence check, not a content audit.
"""

from datetime import datetime, timezone

from sqlalchemy import select

from app.db import SessionLocal, engine
from app.models import Run, Workflow
from scripts.seed_demo import MARKER, _seed


async def test_seed_demo_writes_marked_workflows_and_runs() -> None:
    await engine.dispose()
    async with SessionLocal() as session:
        created = await _seed(session, datetime.now(timezone.utc))
        await session.commit()

    assert created["workflows"] >= 1
    assert created["runs"] >= 1

    async with SessionLocal() as session:
        workflows = (
            (await session.execute(select(Workflow).where(Workflow.name.startswith(MARKER))))
            .scalars()
            .all()
        )
        runs = (
            (await session.execute(select(Run).where(Run.goal.startswith(MARKER)))).scalars().all()
        )
    assert len(workflows) >= 1
    assert len(runs) >= 1
    await engine.dispose()
