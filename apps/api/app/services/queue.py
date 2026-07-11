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


async def get_arq_pool() -> ArqRedis:
    """Lazily create (and cache) the arq Redis connection pool."""
    global _pool
    if _pool is None:
        settings = get_settings()
        _pool = await create_pool(RedisSettings.from_dsn(settings.redis_url))
    return _pool


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
    asyncio.create_task(plan_and_execute(run_id))


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
    asyncio.create_task(execute_run(run_id))
