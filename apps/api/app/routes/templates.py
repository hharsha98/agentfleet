from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db import get_session
from app.models import Agent
from app.schemas import AgentOut
from app.templates_catalog import TEMPLATES

router = APIRouter()


@router.get("")
async def list_templates() -> list[dict]:
    return TEMPLATES


@router.post("/{slug}/install", response_model=AgentOut, status_code=201)
async def install_template(
    slug: str, session: AsyncSession = Depends(get_session)
) -> Agent:
    template = next((t for t in TEMPLATES if t["slug"] == slug), None)
    if template is None:
        raise HTTPException(status_code=404, detail="Unknown template")

    existing = (
        await session.execute(select(Agent).where(Agent.slug == slug))
    ).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=409, detail="An agent with this slug already exists")

    agent = Agent(
        slug=template["slug"],
        name=template["name"],
        description=template["description"],
        system_prompt=template["system_prompt"],
        model=get_settings().default_model,
        tools=template["tools"],
        is_builtin=False,
    )
    session.add(agent)
    await session.commit()
    await session.refresh(agent)
    return agent
