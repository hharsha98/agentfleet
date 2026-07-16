"""Budget CRUD: one row per agent plus a single GLOBAL row (agent_id NULL).
Mounted at /api/v1/budgets — see app/main.py.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import current_user
from app.db import get_session
from app.models import Agent, Budget, User
from app.ownership import is_visible
from app.schemas import BudgetOut, BudgetUpsert

router = APIRouter()


@router.get("", response_model=list[BudgetOut])
async def list_budgets(
    session: AsyncSession = Depends(get_session), user: User = Depends(current_user)
) -> list[BudgetOut]:
    rows = (
        await session.execute(
            select(Budget, Agent.slug).outerjoin(Agent, Agent.id == Budget.agent_id)
        )
    ).all()
    return [
        BudgetOut(
            id=budget.id,
            agent_id=budget.agent_id,
            agent_slug=slug,
            daily_token_limit=budget.daily_token_limit,
            daily_usd_limit=(
                float(budget.daily_usd_limit) if budget.daily_usd_limit is not None else None
            ),
        )
        for budget, slug in rows
    ]


@router.put("")
async def upsert_budget(
    payload: BudgetUpsert,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
) -> dict:
    if payload.agent_id is not None:
        agent = await session.get(Agent, payload.agent_id)
        if agent is None or not is_visible(agent, user, builtin=True):
            raise HTTPException(status_code=404, detail="Agent not found")

    existing = (
        await session.execute(
            select(Budget).where(Budget.agent_id == payload.agent_id)
            if payload.agent_id is not None
            else select(Budget).where(Budget.agent_id.is_(None))
        )
    ).scalar_one_or_none()

    if payload.daily_token_limit is None and payload.daily_usd_limit is None:
        if existing is not None:
            await session.delete(existing)
            await session.commit()
        return {"ok": True, "budget": None}

    if existing is not None:
        existing.daily_token_limit = payload.daily_token_limit
        existing.daily_usd_limit = payload.daily_usd_limit
        budget = existing
    else:
        budget = Budget(
            agent_id=payload.agent_id,
            daily_token_limit=payload.daily_token_limit,
            daily_usd_limit=payload.daily_usd_limit,
        )
        session.add(budget)
    await session.commit()
    await session.refresh(budget)

    agent_slug = None
    if budget.agent_id is not None:
        agent_obj = await session.get(Agent, budget.agent_id)
        agent_slug = agent_obj.slug if agent_obj else None

    return {
        "ok": True,
        "budget": BudgetOut(
            id=budget.id,
            agent_id=budget.agent_id,
            agent_slug=agent_slug,
            daily_token_limit=budget.daily_token_limit,
            daily_usd_limit=(
                float(budget.daily_usd_limit) if budget.daily_usd_limit is not None else None
            ),
        ),
    }
