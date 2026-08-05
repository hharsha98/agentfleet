"""Dispatch mission runs to either the arq worker queue (durable — survives
an API process restart) or an in-process asyncio task (dev fallback — dies
with the API process). Switched by Settings.orchestrator_mode ("arq" |
"inprocess", env ORCHESTRATOR_MODE). See app/worker.py for the arq job
functions that wrap app.services.orchestrator; both paths call the exact
same orchestrator code, so behavior is identical either way.

If Redis is unreachable when in "arq" mode, enqueue() raises and
dispatch_plan()/dispatch_execute() fall back to the in-process path so a
Redis hiccup never silently drops a run.
"""

import asyncio
import logging
import uuid

from arq import create_pool
from arq.connections import ArqRedis, RedisSettings

from app.config import get_settings
from app.services.orchestrator import execute_run, plan_and_execute

logger = logging.getLogger(__name__)

_pool: ArqRedis | None = None

# Bug 4 (Wave 1): asyncio.create_task()'s return value is the ONLY strong
# reference CPython keeps to a scheduled task — the event loop itself only
# holds a WEAK reference (see the asyncio.create_task docs: "the event loop
# only keeps a weak reference to the task... task can be garbage collected
# at any time"). This module used to call asyncio.create_task(...) as a bare
# statement and drop the return value, which made every in-process run
# eligible for silent mid-execution GC — no exception, no log line, just a
# mission that stops.
#
# Keyed by task -> run_id (not a plain set()) because Bug 3's graceful
# shutdown needs to know which Run row a still-running task belongs to, to
# mark it terminal instead of leaving it stuck in "running" forever when the
# drain timeout expires.
_background_tasks: dict[asyncio.Task, uuid.UUID] = {}


def _track(task: asyncio.Task, run_id: uuid.UUID) -> None:
    """Retain a strong reference to `task` until it finishes, and record
    which run it belongs to for app.main's shutdown drain (Bug 3)."""
    _background_tasks[task] = run_id
    task.add_done_callback(lambda t: _background_tasks.pop(t, None))


async def get_arq_pool() -> ArqRedis:
    """Lazily create (and cache) the arq Redis connection pool."""
    global _pool
    if _pool is None:
        settings = get_settings()
        _pool = await create_pool(RedisSettings.from_dsn(settings.redis_url))
    return _pool


async def close_arq_pool() -> None:
    """Close the module-level arq pool, if one was ever created (Bug 3,
    Wave 1). Previously never called anywhere — the pool just leaked its
    Redis connection on process exit. Safe to call even if `_pool` is still
    None (nothing was ever created, e.g. pure "inprocess" mode) or already
    closed."""
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


async def enqueue(func_name: str, *args: str) -> None:
    """Enqueue an arq job by function name. Raises on failure — callers
    decide whether/how to fall back."""
    try:
        pool = await get_arq_pool()
        await pool.enqueue_job(func_name, *args)
    except Exception:
        logger.exception("failed to enqueue arq job %s%s", func_name, args)
        raise


async def dispatch_plan(run_id: uuid.UUID) -> None:
    """Start planning+execution for a new run: durable (arq) or in-process."""
    settings = get_settings()
    if settings.orchestrator_mode == "arq":
        try:
            await enqueue("run_plan_and_execute", str(run_id))
            return
        except Exception:
            logger.warning(
                "arq enqueue failed for run %s; falling back to in-process", run_id
            )
    _track(asyncio.create_task(plan_and_execute(run_id)), run_id)


async def dispatch_execute(run_id: uuid.UUID) -> None:
    """Resume execution after a task approval: durable (arq) or in-process."""
    settings = get_settings()
    if settings.orchestrator_mode == "arq":
        try:
            await enqueue("run_execute_run", str(run_id))
            return
        except Exception:
            logger.warning(
                "arq enqueue failed for run %s; falling back to in-process", run_id
            )
    _track(asyncio.create_task(execute_run(run_id)), run_id)
