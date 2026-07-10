import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db import get_session
from app.models import Agent
from app.schemas import AgentCreate, AgentOut, AgentUpdate
from app.tools import TOOLS

router = APIRouter()


def _validate_tools(tools: list[str]) -> None:
    unknown = [t for t in tools if t not in TOOLS]
    if unknown:
        raise HTTPException(status_code=422, detail=f"Unknown tools: {', '.join(unknown)}")


@router.get("", response_model=list[AgentOut])
async def list_agents(session: AsyncSession = Depends(get_session)) -> list[Agent]:
    result = await session.execute(select(Agent).order_by(Agent.name))
    return list(result.scalars().all())


# Registered before "/{agent_id}" so the literal "tools" path segment isn't
# shadowed by the agent-id path parameter.
@router.get("/tools")
async def list_tools() -> list[str]:
    return sorted(TOOLS.keys())


@router.post("", response_model=AgentOut, status_code=201)
async def create_agent(
    payload: AgentCreate, session: AsyncSession = Depends(get_session)
) -> Agent:
    _validate_tools(payload.tools)
    existing = (
        await session.execute(select(Agent).where(Agent.slug == payload.slug))
    ).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=409, detail="An agent with this slug already exists")
    model = payload.model or get_settings().default_model
    agent = Agent(
        slug=payload.slug,
        name=payload.name,
        description=payload.description,
        system_prompt=payload.system_prompt,
        model=model,
        temperature=payload.temperature,
        tools=payload.tools,
        is_builtin=False,
    )
    session.add(agent)
    await session.commit()
    await session.refresh(agent)
    return agent


@router.patch("/{agent_id}", response_model=AgentOut)
async def update_agent(
    agent_id: uuid.UUID, payload: AgentUpdate, session: AsyncSession = Depends(get_session)
) -> Agent:
    agent = await session.get(Agent, agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail="Agent not found")
    updates = payload.model_dump(exclude_unset=True)
    if "tools" in updates and updates["tools"] is not None:
        _validate_tools(updates["tools"])
    for field, value in updates.items():
        setattr(agent, field, value)
    await session.commit()
    await session.refresh(agent)
    return agent


@router.delete("/{agent_id}")
async def delete_agent(
    agent_id: uuid.UUID, session: AsyncSession = Depends(get_session)
) -> dict:
    agent = await session.get(Agent, agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail="Agent not found")
    if agent.is_builtin:
        raise HTTPException(status_code=409, detail="Built-in agents cannot be deleted")
    await session.delete(agent)
    await session.commit()
    return {"ok": True}
