import uuid

from croniter import CroniterBadCronError, croniter
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.models import ScheduledRun
from app.schemas import ScheduledRunOut

router = APIRouter()


def _validate_cron(expr: str) -> None:
    try:
        croniter(expr)
    except (CroniterBadCronError, ValueError) as exc:
        raise HTTPException(status_code=422, detail="Invalid cron expression") from exc


class ScheduledRunCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    goal: str = Field(min_length=1, max_length=2000)
    cron: str = Field(min_length=1, max_length=120)


class ScheduledRunUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    goal: str | None = Field(default=None, min_length=1, max_length=2000)
    cron: str | None = Field(default=None, min_length=1, max_length=120)
    enabled: bool | None = None


@router.post("", response_model=ScheduledRunOut, status_code=201)
async def create_schedule(
    payload: ScheduledRunCreate, session: AsyncSession = Depends(get_session)
) -> ScheduledRun:
    _validate_cron(payload.cron)
    schedule = ScheduledRun(name=payload.name, goal=payload.goal, cron=payload.cron)
    session.add(schedule)
    await session.commit()
    await session.refresh(schedule)
    return schedule


@router.get("", response_model=list[ScheduledRunOut])
async def list_schedules(session: AsyncSession = Depends(get_session)) -> list[ScheduledRun]:
    result = await session.execute(
        select(ScheduledRun).order_by(ScheduledRun.created_at.desc())
    )
    return list(result.scalars().all())


@router.patch("/{schedule_id}", response_model=ScheduledRunOut)
async def update_schedule(
    schedule_id: uuid.UUID,
    payload: ScheduledRunUpdate,
    session: AsyncSession = Depends(get_session),
) -> ScheduledRun:
    schedule = await session.get(ScheduledRun, schedule_id)
    if schedule is None:
        raise HTTPException(status_code=404, detail="Schedule not found")
    updates = payload.model_dump(exclude_unset=True)
    if "cron" in updates and updates["cron"] is not None:
        _validate_cron(updates["cron"])
    for field, value in updates.items():
        setattr(schedule, field, value)
    await session.commit()
    await session.refresh(schedule)
    return schedule


@router.delete("/{schedule_id}")
async def delete_schedule(
    schedule_id: uuid.UUID, session: AsyncSession = Depends(get_session)
) -> dict:
    schedule = await session.get(ScheduledRun, schedule_id)
    if schedule is None:
        raise HTTPException(status_code=404, detail="Schedule not found")
    await session.delete(schedule)
    await session.commit()
    return {"ok": True}
