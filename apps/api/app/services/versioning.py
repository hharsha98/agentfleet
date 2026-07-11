"""Agent config versioning: snapshot on publish, restore on rollback.

Publishing is an explicit user action (button in the UI, or the automatic
"Initial version" snapshot on create) — routes/agents.py deliberately does
NOT call publish_version on every PATCH, since that would flood the history
with a version per keystroke-driven edit.
"""

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Agent, AgentVersion

CONFIG_FIELDS = (
    "name",
    "description",
    "system_prompt",
    "model",
    "temperature",
    "tools",
    "mcp_servers",
)


def snapshot_config(agent: Agent) -> dict:
    """Return the agent's versionable config fields as a plain dict."""
    return {field: getattr(agent, field) for field in CONFIG_FIELDS}


async def publish_version(session: AsyncSession, agent: Agent, note: str = "") -> AgentVersion:
    """Snapshot the agent's current config as the next version. Caller commits."""
    max_version = (
        await session.execute(
            select(func.max(AgentVersion.version)).where(AgentVersion.agent_id == agent.id)
        )
    ).scalar_one()
    next_version = (max_version or 0) + 1
    version = AgentVersion(
        agent_id=agent.id,
        version=next_version,
        config=snapshot_config(agent),
        note=note,
    )
    session.add(version)
    await session.flush()
    return version


async def restore_version(session: AsyncSession, agent: Agent, version_row: AgentVersion) -> None:
    """Restore a snapshot's config onto the live agent, then publish a new
    version recording the rollback — history stays append-only. Caller commits.
    """
    for field in CONFIG_FIELDS:
        setattr(agent, field, version_row.config[field])
    await publish_version(session, agent, note=f"Rolled back to v{version_row.version}")
