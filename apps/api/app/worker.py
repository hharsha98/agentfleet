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
import os
import uuid

# Bug 1 (Wave 1): this worker is one long-running, low-concurrency process —
# it has no business holding the API's larger pool (db_pool_size=3,
# db_max_overflow=2; see app/config.py for the full derivation). These are
# only *defaults* (setdefault, not assignment), so an explicit
# DB_POOL_SIZE/DB_MAX_OVERFLOW already set in this process's deployment env
# (e.g. k8s/worker.yaml) still wins — this just keeps a bare
# `uv run arq app.worker.WorkerSettings` from silently inheriting the API's
# sizing. MUST run before the `app.services.orchestrator` import below,
# which pulls in app.db — and app.db builds its engine from get_settings()
# at import time, same ordering requirement tests/conftest.py documents for
# AUTH_SECRET/DATABASE_URL.
os.environ.setdefault("DB_POOL_SIZE", "1")
os.environ.setdefault("DB_MAX_OVERFLOW", "1")

from arq import cron
from arq.connections import RedisSettings

from app.config import get_settings
from app.services.orchestrator import execute_run, plan_and_execute
from app.services.queue import close_arq_pool
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


async def on_startup(ctx: dict) -> None:
    logger.info("arq worker: startup")


async def on_shutdown(ctx: dict) -> None:
    """Bug 3 (Wave 1): arq's own graceful-shutdown path (SIGTERM/SIGINT —
    see arq.worker.Worker.handle_sig) previously ran no cleanup at all here.
    Mirrors app.main's lifespan teardown for the pieces this process
    actually owns: close the arq Redis pool (this worker is itself the arq
    consumer, so app.services.queue._pool is only ever populated here if a
    job handler falls back to enqueueing — normally it won't be, but
    closing an unopened pool is a no-op) and dispose the shared
    app.db.engine so pooled connections don't leak on a clean shutdown.

    No graceful path survives SIGKILL — this simply never runs then, same
    caveat as app.main's lifespan.
    """
    await close_arq_pool()

    from app import db

    await db.engine.dispose()


class WorkerSettings:
    functions = [run_plan_and_execute, run_execute_run]
    cron_jobs = [cron(poll_schedules_job, second=0)]
    redis_settings = RedisSettings.from_dsn(get_settings().redis_url)
    on_startup = on_startup
    on_shutdown = on_shutdown
    # Bug 3 (Wave 1): explicit rather than relying on arq's own defaults, so
    # this reads as a decision, not an oversight, given this worker is
    # exactly what closes the "run stuck in running forever" bug.
    #
    # job_timeout: comfortably above self_heal_deadline_seconds's default
    # (300s, app/config.py) — a legitimately slow-but-succeeding self-heal
    # repair loop must not get killed by arq's own job timeout before it
    # gets the chance to finish.
    job_timeout = 600
    # retry_jobs: arq's own default (True) already re-enqueues a job whose
    # task got cancelled (e.g. by graceful worker shutdown) instead of
    # dropping it — made explicit here rather than leaving that behavior
    # implicit, since "an interrupted job is re-queued rather than lost" is
    # the entire point of this settings block.
    retry_jobs = True
    # max_tries: lower than arq's own default (5). Known limitation worth
    # flagging rather than silently working around: run_plan_and_execute
    # re-runs planning from scratch on every attempt (see
    # services/orchestrator.py::plan_and_execute, which unconditionally
    # inserts new RunTask rows) — it is NOT idempotent on retry, so a job
    # retried after being cancelled mid-plan will duplicate that run's
    # tasks. 3 bounds how bad that gets rather than fixing the underlying
    # non-idempotency, which is out of scope for this task.
    max_tries = 3
