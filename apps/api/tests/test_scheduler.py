"""Tests for scheduled runs: is_due's pure cron-window logic (no DB), the
ScheduledRun CRUD API, and poll_due_schedules' fire-once-per-window
behavior against a real database.

CRUD and poll tests use the same single-event-loop httpx.AsyncClient +
ASGITransport pattern as test_evals.py (see that file's docstring for why —
asyncpg connections are bound to the event loop that created them).
"""

import uuid
from datetime import datetime, timedelta, timezone

from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.db import SessionLocal, engine
from app.main import app
from app.models import Run, ScheduledRun
from app.services.scheduler import is_due, poll_due_schedules

# ---- is_due unit tests (no DB) ----


def test_is_due_every_minute_cron_with_stale_last_run_is_due() -> None:
    now = datetime(2026, 7, 11, 10, 5, tzinfo=timezone.utc)
    last_run_at = now - timedelta(minutes=2)
    assert is_due("* * * * *", last_run_at, now) is True


def test_is_due_every_minute_cron_with_last_run_equal_now_is_not_due() -> None:
    now = datetime(2026, 7, 11, 10, 5, tzinfo=timezone.utc)
    assert is_due("* * * * *", now, now) is False


def test_is_due_daily_cron_fire_time_in_window_is_due() -> None:
    # "0 9 * * *" = daily at 09:00 UTC. last_run_at = yesterday 08:00,
    # now = today 10:00 -> today's 09:00 fire falls in (last_run_at, now].
    now = datetime(2026, 7, 11, 10, 0, tzinfo=timezone.utc)
    last_run_at = datetime(2026, 7, 10, 8, 0, tzinfo=timezone.utc)
    assert is_due("0 9 * * *", last_run_at, now) is True


def test_is_due_daily_cron_already_ran_today_is_not_due() -> None:
    # last_run_at is today 09:30, already past today's 09:00 fire; the next
    # fire is tomorrow 09:00, which is after `now` -> not due.
    now = datetime(2026, 7, 11, 10, 0, tzinfo=timezone.utc)
    last_run_at = datetime(2026, 7, 11, 9, 30, tzinfo=timezone.utc)
    assert is_due("0 9 * * *", last_run_at, now) is False


def test_is_due_first_run_within_grace_window_is_due() -> None:
    # last_run_at=None (schedule has never fired). The most recent fire for
    # "* * * * *" is always <= 1 minute before `now`, comfortably inside
    # the first-run grace window -> due.
    now = datetime(2026, 7, 11, 10, 5, tzinfo=timezone.utc)
    assert is_due("* * * * *", None, now) is True


def test_is_due_first_run_outside_grace_window_is_not_due() -> None:
    # A never-fired schedule whose most recent scheduled fire time is well
    # outside the grace window is NOT due — this is what stops a "daily at
    # 9am" schedule created at 2pm from firing immediately on creation.
    now = datetime(2026, 7, 11, 14, 0, tzinfo=timezone.utc)
    assert is_due("0 9 * * *", None, now) is False


# ---- CRUD ----


async def test_scheduled_run_crud() -> None:
    await engine.dispose()
    created_ids: list[str] = []

    try:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            create_res = await client.post(
                "/api/v1/schedules",
                json={"name": "test-schedule", "goal": "Say hi.", "cron": "0 9 * * *"},
            )
            assert create_res.status_code == 201, create_res.text
            schedule = create_res.json()
            created_ids.append(schedule["id"])
            assert schedule["name"] == "test-schedule"
            assert schedule["enabled"] is True
            assert schedule["last_run_at"] is None

            bad_res = await client.post(
                "/api/v1/schedules",
                json={"name": "bad", "goal": "x", "cron": "not a cron"},
            )
            assert bad_res.status_code == 422

            list_res = await client.get("/api/v1/schedules")
            assert list_res.status_code == 200
            assert any(s["id"] == schedule["id"] for s in list_res.json())

            patch_res = await client.patch(
                f"/api/v1/schedules/{schedule['id']}", json={"enabled": False}
            )
            assert patch_res.status_code == 200
            assert patch_res.json()["enabled"] is False

            missing_res = await client.patch(
                "/api/v1/schedules/00000000-0000-0000-0000-000000000000",
                json={"enabled": True},
            )
            assert missing_res.status_code == 404

            delete_res = await client.delete(f"/api/v1/schedules/{schedule['id']}")
            assert delete_res.status_code == 200
            assert delete_res.json() == {"ok": True}
            created_ids.remove(schedule["id"])

            list_after_res = await client.get("/api/v1/schedules")
            assert all(s["id"] != schedule["id"] for s in list_after_res.json())

            delete_again_res = await client.delete(f"/api/v1/schedules/{schedule['id']}")
            assert delete_again_res.status_code == 404
    finally:
        if created_ids:
            async with SessionLocal() as session:
                for sid in created_ids:
                    obj = await session.get(ScheduledRun, uuid.UUID(sid))
                    if obj:
                        await session.delete(obj)
                await session.commit()
        await engine.dispose()


# ---- poll_due_schedules integration ----


async def test_poll_due_schedules_fires_once_per_window() -> None:
    await engine.dispose()
    schedule_id: uuid.UUID | None = None
    run_id: uuid.UUID | None = None
    goal = "test_poll_due_schedules_fires_once_per_window goal"

    try:
        async with SessionLocal() as session:
            schedule = ScheduledRun(
                name="poll-test",
                goal=goal,
                cron="* * * * *",
                enabled=True,
                last_run_at=datetime.now(timezone.utc) - timedelta(minutes=5),
            )
            session.add(schedule)
            await session.commit()
            await session.refresh(schedule)
            schedule_id = schedule.id

        fired = await poll_due_schedules()
        assert fired >= 1

        async with SessionLocal() as session:
            refreshed = await session.get(ScheduledRun, schedule_id)
            assert refreshed is not None
            assert refreshed.last_run_at is not None
            last_run_after_first_poll = refreshed.last_run_at

            run = (
                (await session.execute(select(Run).where(Run.goal == goal)))
                .scalars()
                .first()
            )
            assert run is not None
            run_id = run.id

        # Immediate second poll must not double-fire: the (last_run_at, now]
        # window for a "* * * * *" cron is empty once we just fired within
        # the same minute.
        await poll_due_schedules()

        async with SessionLocal() as session:
            refreshed_again = await session.get(ScheduledRun, schedule_id)
            assert refreshed_again is not None
            assert refreshed_again.last_run_at == last_run_after_first_poll
    finally:
        async with SessionLocal() as session:
            if run_id is not None:
                run = await session.get(Run, run_id)
                if run:
                    await session.delete(run)
            if schedule_id is not None:
                schedule = await session.get(ScheduledRun, schedule_id)
                if schedule:
                    await session.delete(schedule)
            await session.commit()
        await engine.dispose()
