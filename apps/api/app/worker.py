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

from arq.connections import RedisSettings

from app.config import get_settings
from app.services.orchestrator import execute_run, plan_and_execute

logger = logging.getLogger(__name__)


async def run_plan_and_execute(ctx: dict, run_id: str) -> None:
    logger.info("arq worker: starting plan_and_execute for run %s", run_id)
    await plan_and_execute(uuid.UUID(run_id))
    logger.info("arq worker: finished plan_and_execute for run %s", run_id)


async def run_execute_run(ctx: dict, run_id: str) -> None:
    logger.info("arq worker: starting execute_run for run %s", run_id)
    await execute_run(uuid.UUID(run_id))
    logger.info("arq worker: finished execute_run for run %s", run_id)


class WorkerSettings:
    functions = [run_plan_and_execute, run_execute_run]
    redis_settings = RedisSettings.from_dsn(get_settings().redis_url)
