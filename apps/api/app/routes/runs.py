import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth import current_user
from app.db import get_session
from app.models import Run, RunTask, User
from app.ownership import is_mutable, is_visible, visibility_clause
from app.services.queue import dispatch_execute, dispatch_plan

router = APIRouter()


class RunCreate(BaseModel):
    goal: str = Field(min_length=1, max_length=2000)


def _task_dict(t: RunTask) -> dict:
    return {
        "id": str(t.id),
        "ordinal": t.ordinal,
        "title": t.title,
        "description": t.description,
        "agent_slug": t.agent_slug,
        "depends_on": t.depends_on or [],
        "needs_approval": t.needs_approval,
        "status": t.status,
        "result": t.result,
        "error": t.error,
        "tokens_in": t.tokens_in,
        "tokens_out": t.tokens_out,
        "latency_ms": t.latency_ms,
    }


def _run_dict(r: Run, with_tasks: bool = False) -> dict:
    data = {
        "id": str(r.id),
        "goal": r.goal,
        "status": r.status,
        "created_at": r.created_at.isoformat(),
    }
    if with_tasks:
        data["tasks"] = [_task_dict(t) for t in r.tasks]
    return data


@router.post("", status_code=201)
async def create_run(
    payload: RunCreate,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
) -> dict:
    run = Run(goal=payload.goal, user_id=user.id)
    session.add(run)
    await session.commit()
    await session.refresh(run)
    # Durable (arq worker) or in-process asyncio task, per ORCHESTRATOR_MODE
    # (ADR-004; see app/services/queue.py).
    await dispatch_plan(run.id)
    return _run_dict(run)


@router.get("")
async def list_runs(
    response: Response,
    limit: int = Query(default=20, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    session: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
) -> list[dict]:
    visible = visibility_clause(Run, user)
    total = (
        await session.execute(select(func.count()).select_from(Run).where(visible))
    ).scalar_one()
    runs = (
        (
            await session.execute(
                select(Run)
                .where(visible)
                .order_by(Run.created_at.desc(), Run.id)
                .offset(offset)
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )
    response.headers["X-Total-Count"] = str(total)
    return [_run_dict(r) for r in runs]


@router.get("/{run_id}")
async def get_run(
    run_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
) -> dict:
    run = (
        await session.execute(
            select(Run).where(Run.id == run_id).options(selectinload(Run.tasks))
        )
    ).scalar_one_or_none()
    if run is None or not is_visible(run, user):
        raise HTTPException(status_code=404, detail="Run not found")
    return _run_dict(run, with_tasks=True)


@router.post("/{run_id}/tasks/{task_id}/approve")
async def approve_task(
    run_id: uuid.UUID,
    task_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
) -> dict:
    run = await session.get(Run, run_id)
    if run is None or not is_visible(run, user):
        raise HTTPException(status_code=404, detail="Run not found")
    if not is_mutable(run, user):
        raise HTTPException(status_code=403, detail="Not permitted to modify this run")
    task = await session.get(RunTask, task_id)
    if task is None or task.run_id != run_id:
        raise HTTPException(status_code=404, detail="Task not found")
    if task.status != "review":
        raise HTTPException(status_code=409, detail=f"Task is {task.status}, not review")
    task.status = "todo"
    task.needs_approval = False
    run.status = "running"
    await session.commit()
    await dispatch_execute(run_id)
    return {"ok": True}
