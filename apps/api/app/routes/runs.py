import asyncio
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db import get_session
from app.models import Run, RunTask
from app.services.orchestrator import execute_run, plan_and_execute

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
) -> dict:
    run = Run(goal=payload.goal)
    session.add(run)
    await session.commit()
    await session.refresh(run)
    # v1: fire-and-forget in-process execution (ADR-004 notes the arq upgrade).
    asyncio.create_task(plan_and_execute(run.id))
    return _run_dict(run)


@router.get("")
async def list_runs(session: AsyncSession = Depends(get_session)) -> list[dict]:
    runs = (
        (await session.execute(select(Run).order_by(Run.created_at.desc()).limit(20)))
        .scalars()
        .all()
    )
    return [_run_dict(r) for r in runs]


@router.get("/{run_id}")
async def get_run(run_id: uuid.UUID, session: AsyncSession = Depends(get_session)) -> dict:
    run = (
        await session.execute(
            select(Run).where(Run.id == run_id).options(selectinload(Run.tasks))
        )
    ).scalar_one_or_none()
    if run is None:
        raise HTTPException(status_code=404, detail="Run not found")
    return _run_dict(run, with_tasks=True)


@router.post("/{run_id}/tasks/{task_id}/approve")
async def approve_task(
    run_id: uuid.UUID,
    task_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
) -> dict:
    task = await session.get(RunTask, task_id)
    if task is None or task.run_id != run_id:
        raise HTTPException(status_code=404, detail="Task not found")
    if task.status != "review":
        raise HTTPException(status_code=409, detail=f"Task is {task.status}, not review")
    task.status = "todo"
    task.needs_approval = False
    run = await session.get(Run, run_id)
    run.status = "running"
    await session.commit()
    asyncio.create_task(execute_run(run_id))
    return {"ok": True}
