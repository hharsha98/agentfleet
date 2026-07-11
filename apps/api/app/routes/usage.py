"""Usage/cost dashboard routes: today's totals, per-agent breakdown, and a
daily time series. Mounted at /api/v1/usage — see app/main.py.

Message rows are the single source of truth for tokens/cost (see
models.py); everything here reads assistant-turn Message rows joined
through Conversation (and Agent for the per-agent breakdown).
"""

from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.models import Agent, Conversation, Message
from app.schemas import UsageDailyOut, UsagePerAgentOut, UsageSummaryOut, UsageTodayOut

router = APIRouter()


def _today_start_utc() -> datetime:
    now = datetime.now(timezone.utc)
    return now.replace(hour=0, minute=0, second=0, microsecond=0)


def _date_start_utc(d: date) -> datetime:
    return datetime(d.year, d.month, d.day, tzinfo=timezone.utc)


@router.get("/summary", response_model=UsageSummaryOut)
async def summary(session: AsyncSession = Depends(get_session)) -> UsageSummaryOut:
    today_start = _today_start_utc()

    today_row = (
        await session.execute(
            select(
                func.coalesce(func.sum(Message.tokens_in + Message.tokens_out), 0),
                func.coalesce(func.sum(Message.cost_usd), 0),
                func.count(Message.id),
            )
            .where(Message.role == "assistant")
            .where(Message.created_at >= today_start)
        )
    ).one()
    today = UsageTodayOut(
        tokens=int(today_row[0]), cost_usd=float(today_row[1]), messages=int(today_row[2])
    )

    week_start = datetime.now(timezone.utc) - timedelta(days=7)
    per_agent_rows = (
        await session.execute(
            select(
                Agent.slug,
                Agent.name,
                func.coalesce(func.sum(Message.tokens_in + Message.tokens_out), 0),
                func.coalesce(func.sum(Message.cost_usd), 0),
                func.count(Message.id),
            )
            .select_from(Message)
            .join(Conversation, Conversation.id == Message.conversation_id)
            .join(Agent, Agent.id == Conversation.agent_id)
            .where(Message.role == "assistant")
            .where(Message.created_at >= week_start)
            .group_by(Agent.id, Agent.slug, Agent.name)
            .order_by(func.sum(Message.tokens_in + Message.tokens_out).desc())
        )
    ).all()
    per_agent = [
        UsagePerAgentOut(
            agent_slug=row[0],
            agent_name=row[1],
            tokens=int(row[2]),
            cost_usd=float(row[3]),
            messages=int(row[4]),
        )
        for row in per_agent_rows
    ]

    return UsageSummaryOut(today=today, per_agent=per_agent)


@router.get("/daily", response_model=list[UsageDailyOut])
async def daily(
    days: int = Query(default=14, ge=1, le=60),
    session: AsyncSession = Depends(get_session),
) -> list[UsageDailyOut]:
    today = datetime.now(timezone.utc).date()
    start_date = today - timedelta(days=days - 1)
    start_dt = _date_start_utc(start_date)

    rows = (
        await session.execute(
            select(
                func.date_trunc("day", Message.created_at, "UTC").label("day"),
                func.coalesce(func.sum(Message.tokens_in + Message.tokens_out), 0),
                func.coalesce(func.sum(Message.cost_usd), 0),
            )
            .where(Message.role == "assistant")
            .where(Message.created_at >= start_dt)
            .group_by("day")
            .order_by("day")
        )
    ).all()

    by_date: dict[str, tuple[int, float]] = {}
    for row in rows:
        day_str = row[0].date().isoformat() if hasattr(row[0], "date") else str(row[0])[:10]
        by_date[day_str] = (int(row[1]), float(row[2]))

    result: list[UsageDailyOut] = []
    for i in range(days):
        d = (start_date + timedelta(days=i)).isoformat()
        tokens, cost = by_date.get(d, (0, 0.0))
        result.append(UsageDailyOut(date=d, tokens=tokens, cost_usd=cost))
    return result
