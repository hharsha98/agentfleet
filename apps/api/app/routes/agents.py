from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.models import Agent
from app.schemas import AgentOut

router = APIRouter()


@router.get("", response_model=list[AgentOut])
async def list_agents(session: AsyncSession = Depends(get_session)) -> list[Agent]:
    result = await session.execute(select(Agent).order_by(Agent.name))
    return list(result.scalars().all())
