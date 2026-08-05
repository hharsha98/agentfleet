"""Bug 3 (Wave 1): app.main._mark_incomplete_runs — the part of the shutdown
drain that cancels still-running tracked tasks (Bug 4) and writes a
truthful terminal status to their Run row.

This exercises the REAL asyncio cancellation path (a genuinely long-running
task, genuinely cancelled) against the REAL test database, rather than
mocking it away — a manual live SIGTERM run against a throwaway uvicorn
process caught a real bug here: asyncio.CancelledError has subclassed
BaseException (not Exception) since Python 3.8, so an `except Exception`
around `await asyncio.wait_for(cancelled_task, ...)` does not catch it,
and the whole shutdown teardown (arq pool close, engine.dispose()) crashed
before ever reaching the DB write. This test pins that fix in the normal
pytest suite instead of relying solely on the manual reproduction.
"""

import asyncio
import uuid

import app.main as app_main
from app.db import SessionLocal
from app.models import Run


async def _never_finishes() -> None:
    await asyncio.Event().wait()


async def test_mark_incomplete_runs_cancels_task_and_writes_failed_status() -> None:
    run_id = uuid.uuid4()
    async with SessionLocal() as session:
        session.add(Run(id=run_id, goal="shutdown-drain-test", status="running"))
        await session.commit()

    task = asyncio.create_task(_never_finishes())
    # Give the task a chance to actually start running before we cancel it —
    # matches the real shutdown path, where the task is genuinely in flight.
    await asyncio.sleep(0)

    await app_main._mark_incomplete_runs({task: run_id})

    assert task.cancelled() or task.done()

    async with SessionLocal() as session:
        run = await session.get(Run, run_id)
        assert run is not None
        assert run.status == "failed"


async def test_mark_incomplete_runs_leaves_already_terminal_runs_alone() -> None:
    """A task that raced to completion (status already "done") before the
    drain got to it must not be overwritten to "failed"."""
    run_id = uuid.uuid4()
    async with SessionLocal() as session:
        session.add(Run(id=run_id, goal="already-done-test", status="done"))
        await session.commit()

    async def _already_finished() -> None:
        return None

    task = asyncio.create_task(_already_finished())
    await asyncio.sleep(0)  # let it actually finish
    assert task.done()

    await app_main._mark_incomplete_runs({task: run_id})

    async with SessionLocal() as session:
        run = await session.get(Run, run_id)
        assert run is not None
        assert run.status == "done"
