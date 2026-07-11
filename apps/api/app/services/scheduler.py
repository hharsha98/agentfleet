"""Fires due ScheduledRuns: the arq worker's per-minute cron job (see
app/worker.py's WorkerSettings.cron_jobs) calls poll_due_schedules(), which
creates a Run for each schedule whose cron expression has a fire time in
the window since it last ran, then dispatches it exactly like a
user-created Run (app/services/queue.py's dispatch_plan).

Schedules only fire while the arq worker process is running
(ORCHESTRATOR_MODE=arq) — there is no in-process fallback for cron, since
"in-process" mode has no long-lived process to host a minute-by-minute
poll loop outside of a request.
"""

import logging
from datetime import datetime, timedelta, timezone

from croniter import croniter
from sqlalchemy import select

from app.db import SessionLocal
from app.models import Run, ScheduledRun
from app.services.queue import dispatch_plan

logger = logging.getLogger(__name__)

# First-run grace window: if a schedule has never fired (last_run_at is
# None), treat it as due only if its most recent scheduled fire time falls
# within the last FIRST_RUN_GRACE_SECONDS. This avoids two failure modes:
# firing immediately on every schedule the instant it's created (surprising
# if you create a "daily at 9am" schedule at 2pm), while also not silently
# skipping a schedule created right at its fire minute just because the
# poller's tick lands a few seconds later than the cron boundary.
FIRST_RUN_GRACE_SECONDS = 120


def _as_utc(dt: datetime | None) -> datetime | None:
    """Normalize a datetime to timezone-aware UTC (Postgres can hand back
    naive datetimes depending on driver/column config; croniter needs
    consistent tz-awareness to compare against `now`)."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def is_due(cron_expr: str, last_run_at: datetime | None, now: datetime) -> bool:
    """True iff there is a scheduled fire time in the window (last_run_at, now].

    - last_run_at set: due if the most recent fire time at-or-before `now`
      is strictly after last_run_at (i.e. a fire happened since we last ran).
    - last_run_at is None (schedule never fired): due only if that most
      recent fire time is within FIRST_RUN_GRACE_SECONDS of `now` — see
      module docstring for why.
    """
    now = _as_utc(now)
    last_run_at = _as_utc(last_run_at)
    prev_fire = croniter(cron_expr, now).get_prev(datetime).replace(tzinfo=timezone.utc)
    if last_run_at is None:
        return now - prev_fire <= timedelta(seconds=FIRST_RUN_GRACE_SECONDS)
    return prev_fire > last_run_at


async def poll_due_schedules() -> int:
    """Check every enabled schedule; fire (create + dispatch a Run) each
    due one. Returns the number fired. One bad cron expression or dispatch
    failure is logged and skipped — it never blocks the rest of the batch.
    """
    now = datetime.now(timezone.utc)
    fired = 0
    async with SessionLocal() as session:
        schedules = (
            (await session.execute(select(ScheduledRun).where(ScheduledRun.enabled == True)))  # noqa: E712
            .scalars()
            .all()
        )
        for schedule in schedules:
            try:
                if not is_due(schedule.cron, schedule.last_run_at, now):
                    continue
                run = Run(goal=schedule.goal)
                session.add(run)
                await session.commit()
                await session.refresh(run)
                await dispatch_plan(run.id)
                schedule.last_run_at = now
                await session.commit()
                fired += 1
                logger.info("scheduled_run %s fired run %s", schedule.id, run.id)
            except Exception:
                logger.exception("failed to process scheduled_run %s", schedule.id)
                await session.rollback()
    return fired
