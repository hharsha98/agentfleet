"""arq worker entrypoint — runs mission orchestration as durable background
jobs on a separate process, so a run survives an API process restart
(ARCHITECTURE.md ADR-004). Enabled by setting ORCHESTRATOR_MODE=arq (see
app/config.py and app/services/queue.py); the in-process asyncio fallback
stays the default so plain `uvicorn` dev and the test suite are unaffected.

Start with:  uv run arq app.worker.WorkerSettings

These are thin wrappers — all planning/execution logic lives in
app.services.orchestrator, so the worker and the in-process fallback share
the exact same code path and behave identically.
"""

import logging
import uuid

from arq import cron
from arq.connections import RedisSettings

from app.config import get_settings
from app.services.orchestrator import execute_run, plan_and_execute
from app.services.scheduler import poll_due_schedules

logger = logging.getLogger(__name__)


async def run_plan_and_execute(ctx: dict, run_id: str) -> None:
    logger.info("arq worker: starting plan_and_execute for run %s", run_id)
    await plan_and_execute(uuid.UUID(run_id))
    logger.info("arq worker: finished plan_and_execute for run %s", run_id)


async def run_execute_run(ctx: dict, run_id: str) -> None:
    logger.info("arq worker: starting execute_run for run %s", run_id)
    await execute_run(uuid.UUID(run_id))
    logger.info("arq worker: finished execute_run for run %s", run_id)


async def poll_schedules_job(ctx: dict) -> None:
    """Cron job (see WorkerSettings.cron_jobs below): runs at the top of
    every minute and fires any ScheduledRun that's due. Scheduled runs only
    fire while this worker process is up (ORCHESTRATOR_MODE=arq) — there is
    no in-process equivalent, since "inprocess" mode has no long-lived
    process to host a minute-by-minute poll loop.
    """
    fired = await poll_due_schedules()
    if fired:
        logger.info("arq worker: poll_schedules_job fired %s scheduled run(s)", fired)


class WorkerSettings:
    functions = [run_plan_and_execute, run_execute_run]
    cron_jobs = [cron(poll_schedules_job, second=0)]
    redis_settings = RedisSettings.from_dsn(get_settings().redis_url)
