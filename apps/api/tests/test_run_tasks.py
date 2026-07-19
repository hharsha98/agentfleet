"""Tests for PATCH /api/v1/runs/{run_id}/tasks/{task_id} (UI-5 Chunk C —
drag-and-drop re-queue on the missions Kanban board).

Same single-event-loop httpx.AsyncClient + ASGITransport pattern as
test_auth.py (see that file's docstring for why — asyncpg connections are
bound to the event loop that created them). Run/RunTask rows are built
directly via the ORM rather than through POST /runs, since that endpoint
kicks off the real orchestrator (an LLM planning call) — not something this
suite can depend on (no LLM proxy in CI). dispatch_execute is monkeypatched
for the same reason: exercising the actual re-queue/re-dispatch wiring
without requiring a live orchestrator run.
"""

import uuid

from httpx import ASGITransport
from sqlalchemy import select

from app.db import SessionLocal, engine
from app.main import app
from app.models import Run, RunTask, User
from tests.conftest import RawAsyncClient, mint_token


def _client(token: str | None = None):
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    return RawAsyncClient(transport=ASGITransport(app=app), base_url="http://test", headers=headers)


async def _make_user(email: str) -> uuid.UUID:
    async with SessionLocal() as session:
        user = User(email=email.strip().lower())
        session.add(user)
        await session.commit()
        await session.refresh(user)
        return user.id


async def _make_run_with_task(
    user_id: uuid.UUID, *, task_status: str, error: str | None = None, result: str = ""
) -> tuple[uuid.UUID, uuid.UUID]:
    async with SessionLocal() as session:
        run = Run(goal="test goal", status="running", user_id=user_id)
        session.add(run)
        await session.flush()
        task = RunTask(
            run_id=run.id,
            ordinal=0,
            title="Do the thing",
            agent_slug="orchestrator",
            status=task_status,
            needs_approval=(task_status == "review"),
            error=error,
            result=result,
        )
        session.add(task)
        await session.commit()
        return run.id, task.id


async def _cleanup(run_id: uuid.UUID | None, email: str) -> None:
    async with SessionLocal() as session:
        if run_id:
            run = await session.get(Run, run_id)
            if run:
                await session.delete(run)
        user = (
            await session.execute(select(User).where(User.email == email.strip().lower()))
        ).scalar_one_or_none()
        if user:
            await session.delete(user)
        await session.commit()
    await engine.dispose()


def _patch_dispatch(monkeypatch) -> list[uuid.UUID]:
    calls: list[uuid.UUID] = []

    async def _fake_dispatch_execute(run_id: uuid.UUID) -> None:
        calls.append(run_id)

    monkeypatch.setattr("app.routes.runs.dispatch_execute", _fake_dispatch_execute)
    return calls


# --- allowed transitions ------------------------------------------------------


async def test_failed_to_todo_clears_error_and_dispatches(monkeypatch) -> None:
    await engine.dispose()
    calls = _patch_dispatch(monkeypatch)
    email = f"dnd-failed-{uuid.uuid4().hex[:8]}@agentfleet.test"
    user_id = await _make_user(email)
    run_id: uuid.UUID | None = None
    try:
        run_id, task_id = await _make_run_with_task(
            user_id, task_status="failed", error="rate limited"
        )
        token = mint_token(email=email)
        async with _client(token) as client:
            res = await client.patch(
                f"/api/v1/runs/{run_id}/tasks/{task_id}", json={"status": "todo"}
            )
            assert res.status_code == 200, res.text
            assert res.json() == {"ok": True}

        async with SessionLocal() as session:
            task = await session.get(RunTask, task_id)
            run = await session.get(Run, run_id)
            assert task.status == "todo"
            assert task.error is None
            assert run.status == "running"
        assert calls == [run_id]
    finally:
        await _cleanup(run_id, email)


async def test_review_to_todo_is_approve_equivalent(monkeypatch) -> None:
    await engine.dispose()
    calls = _patch_dispatch(monkeypatch)
    email = f"dnd-review-{uuid.uuid4().hex[:8]}@agentfleet.test"
    user_id = await _make_user(email)
    run_id: uuid.UUID | None = None
    try:
        run_id, task_id = await _make_run_with_task(user_id, task_status="review")
        token = mint_token(email=email)
        async with _client(token) as client:
            res = await client.patch(
                f"/api/v1/runs/{run_id}/tasks/{task_id}", json={"status": "todo"}
            )
            assert res.status_code == 200, res.text

        async with SessionLocal() as session:
            task = await session.get(RunTask, task_id)
            run = await session.get(Run, run_id)
            assert task.status == "todo"
            assert task.needs_approval is False
            assert run.status == "running"
        assert calls == [run_id]
    finally:
        await _cleanup(run_id, email)


async def test_done_to_todo_reruns_and_keeps_prior_result(monkeypatch) -> None:
    await engine.dispose()
    calls = _patch_dispatch(monkeypatch)
    email = f"dnd-done-{uuid.uuid4().hex[:8]}@agentfleet.test"
    user_id = await _make_user(email)
    run_id: uuid.UUID | None = None
    try:
        run_id, task_id = await _make_run_with_task(
            user_id, task_status="done", result="the prior output"
        )
        token = mint_token(email=email)
        async with _client(token) as client:
            res = await client.patch(
                f"/api/v1/runs/{run_id}/tasks/{task_id}", json={"status": "todo"}
            )
            assert res.status_code == 200, res.text

        async with SessionLocal() as session:
            task = await session.get(RunTask, task_id)
            assert task.status == "todo"
            # Documented choice: result is kept as history of the prior run,
            # not cleared — it's overwritten once the re-run completes.
            assert task.result == "the prior output"
        assert calls == [run_id]
    finally:
        await _cleanup(run_id, email)


# --- forbidden transitions -----------------------------------------------------


async def test_todo_to_todo_is_409(monkeypatch) -> None:
    await engine.dispose()
    _patch_dispatch(monkeypatch)
    email = f"dnd-forbid-a-{uuid.uuid4().hex[:8]}@agentfleet.test"
    user_id = await _make_user(email)
    run_id: uuid.UUID | None = None
    try:
        run_id, task_id = await _make_run_with_task(user_id, task_status="todo")
        token = mint_token(email=email)
        async with _client(token) as client:
            res = await client.patch(
                f"/api/v1/runs/{run_id}/tasks/{task_id}", json={"status": "todo"}
            )
            assert res.status_code == 409
            assert res.json()["detail"] == "todo→todo not allowed"
    finally:
        await _cleanup(run_id, email)


async def test_in_progress_to_todo_is_409(monkeypatch) -> None:
    await engine.dispose()
    _patch_dispatch(monkeypatch)
    email = f"dnd-forbid-b-{uuid.uuid4().hex[:8]}@agentfleet.test"
    user_id = await _make_user(email)
    run_id: uuid.UUID | None = None
    try:
        run_id, task_id = await _make_run_with_task(user_id, task_status="in_progress")
        token = mint_token(email=email)
        async with _client(token) as client:
            res = await client.patch(
                f"/api/v1/runs/{run_id}/tasks/{task_id}", json={"status": "todo"}
            )
            assert res.status_code == 409
            assert res.json()["detail"] == "in_progress→todo not allowed"
    finally:
        await _cleanup(run_id, email)


async def test_unknown_target_status_is_422(monkeypatch) -> None:
    await engine.dispose()
    _patch_dispatch(monkeypatch)
    email = f"dnd-422-{uuid.uuid4().hex[:8]}@agentfleet.test"
    user_id = await _make_user(email)
    run_id: uuid.UUID | None = None
    try:
        run_id, task_id = await _make_run_with_task(user_id, task_status="failed")
        token = mint_token(email=email)
        async with _client(token) as client:
            res = await client.patch(
                f"/api/v1/runs/{run_id}/tasks/{task_id}", json={"status": "bogus"}
            )
            assert res.status_code == 422
    finally:
        await _cleanup(run_id, email)


# --- ownership / auth -----------------------------------------------------------


async def test_cross_user_patch_is_404(monkeypatch) -> None:
    await engine.dispose()
    _patch_dispatch(monkeypatch)
    email_a = f"dnd-owner-a-{uuid.uuid4().hex[:8]}@agentfleet.test"
    email_b = f"dnd-owner-b-{uuid.uuid4().hex[:8]}@agentfleet.test"
    user_a_id = await _make_user(email_a)
    await _make_user(email_b)
    run_id: uuid.UUID | None = None
    try:
        run_id, task_id = await _make_run_with_task(user_a_id, task_status="failed")
        token_b = mint_token(email=email_b)
        async with _client(token_b) as client_b:
            res = await client_b.patch(
                f"/api/v1/runs/{run_id}/tasks/{task_id}", json={"status": "todo"}
            )
            assert res.status_code == 404
    finally:
        await _cleanup(run_id, email_a)
        await _cleanup(None, email_b)


async def test_no_auth_header_is_401() -> None:
    await engine.dispose()
    async with _client() as client:
        res = await client.patch(
            f"/api/v1/runs/{uuid.uuid4()}/tasks/{uuid.uuid4()}", json={"status": "todo"}
        )
        assert res.status_code == 401
