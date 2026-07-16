import re
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db import get_session
from app.models import Agent, AgentVersion
from app.schemas import (
    AgentCreate,
    AgentOut,
    AgentPublish,
    AgentUpdate,
    AgentVersionDetailOut,
    AgentVersionOut,
)
from app.services.versioning import publish_version, restore_version
from app.tools import TOOLS

router = APIRouter()

MCP_SERVER_NAME_RE = re.compile(r"^[a-z0-9-]{1,30}$")
MAX_MCP_SERVERS = 5


def _validate_tools(tools: list[str]) -> None:
    unknown = [t for t in tools if t not in TOOLS]
    if unknown:
        raise HTTPException(status_code=422, detail=f"Unknown tools: {', '.join(unknown)}")


def _validate_mcp_servers(servers: list[dict]) -> None:
    if len(servers) > MAX_MCP_SERVERS:
        raise HTTPException(
            status_code=422, detail=f"At most {MAX_MCP_SERVERS} MCP servers are allowed"
        )
    for entry in servers:
        if not isinstance(entry, dict):
            raise HTTPException(status_code=422, detail="Each mcp_servers entry must be an object")
        name = entry.get("name")
        url = entry.get("url")
        if not isinstance(name, str) or not MCP_SERVER_NAME_RE.match(name):
            raise HTTPException(
                status_code=422,
                detail=f"Invalid MCP server name: {name!r} (must match ^[a-z0-9-]{{1,30}}$)",
            )
        if not isinstance(url, str) or not (url.startswith("http://") or url.startswith("https://")):
            raise HTTPException(
                status_code=422,
                detail=f"Invalid MCP server url for {name!r} (must start with http:// or https://)",
            )


@router.get("", response_model=list[AgentOut])
async def list_agents(
    response: Response,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    session: AsyncSession = Depends(get_session),
) -> list[Agent]:
    total = (await session.execute(select(func.count()).select_from(Agent))).scalar_one()
    result = await session.execute(
        select(Agent).order_by(Agent.name, Agent.id).offset(offset).limit(limit)
    )
    response.headers["X-Total-Count"] = str(total)
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
    _validate_mcp_servers(payload.mcp_servers)
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
        mcp_servers=payload.mcp_servers,
        is_builtin=False,
    )
    session.add(agent)
    await session.commit()
    await session.refresh(agent)
    await publish_version(session, agent, note="Initial version")
    await session.commit()
    return agent


# NOTE: publishing is an explicit user action (this create hook, or the
# POST /{agent_id}/publish endpoint below) — PATCH deliberately does NOT
# auto-publish a version on every edit, or the history would flood with a
# version per keystroke-driven change.
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
    if "mcp_servers" in updates and updates["mcp_servers"] is not None:
        _validate_mcp_servers(updates["mcp_servers"])
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


@router.post("/{agent_id}/publish", response_model=AgentVersionOut, status_code=201)
async def publish_agent(
    agent_id: uuid.UUID, payload: AgentPublish, session: AsyncSession = Depends(get_session)
) -> AgentVersion:
    agent = await session.get(Agent, agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail="Agent not found")
    version = await publish_version(session, agent, note=payload.note)
    await session.commit()
    await session.refresh(version)
    return version


@router.get("/{agent_id}/versions", response_model=list[AgentVersionOut])
async def list_versions(
    agent_id: uuid.UUID,
    response: Response,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    session: AsyncSession = Depends(get_session),
) -> list[AgentVersion]:
    total = (
        await session.execute(
            select(func.count())
            .select_from(AgentVersion)
            .where(AgentVersion.agent_id == agent_id)
        )
    ).scalar_one()
    result = await session.execute(
        select(AgentVersion)
        .where(AgentVersion.agent_id == agent_id)
        .order_by(AgentVersion.version.desc())
        .offset(offset)
        .limit(limit)
    )
    response.headers["X-Total-Count"] = str(total)
    return list(result.scalars().all())


@router.get("/{agent_id}/versions/{version_id}", response_model=AgentVersionDetailOut)
async def get_version(
    agent_id: uuid.UUID, version_id: uuid.UUID, session: AsyncSession = Depends(get_session)
) -> AgentVersion:
    version = await session.get(AgentVersion, version_id)
    if version is None or version.agent_id != agent_id:
        raise HTTPException(status_code=404, detail="Version not found")
    return version


@router.post("/{agent_id}/versions/{version_id}/rollback", response_model=AgentOut)
async def rollback_agent(
    agent_id: uuid.UUID, version_id: uuid.UUID, session: AsyncSession = Depends(get_session)
) -> Agent:
    agent = await session.get(Agent, agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail="Agent not found")
    version = await session.get(AgentVersion, version_id)
    if version is None or version.agent_id != agent_id:
        raise HTTPException(status_code=404, detail="Version not found")
    await restore_version(session, agent, version)
    await session.commit()
    await session.refresh(agent)
    return agent
