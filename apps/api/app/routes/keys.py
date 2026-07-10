"""Per-agent API key management (Publish pillar).

Keys are generated as "af_" + 24 random bytes of hex. Only the sha256 hash
is ever persisted — the full key is returned exactly once, in the create
response — so it can be safely copied by the user and never recovered again
if lost.
"""

import hashlib
import secrets
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.models import Agent, ApiKey

router = APIRouter()

KEY_PREFIX = "af_"


class ApiKeyCreate(BaseModel):
    name: str = Field(default="default", min_length=1, max_length=100)


def _hash_key(key: str) -> str:
    return hashlib.sha256(key.encode("utf-8")).hexdigest()


@router.post("", status_code=201)
async def create_key(
    agent_id: uuid.UUID,
    payload: ApiKeyCreate,
    session: AsyncSession = Depends(get_session),
) -> dict:
    agent = await session.get(Agent, agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail="Agent not found")

    key = KEY_PREFIX + secrets.token_hex(24)
    api_key = ApiKey(
        agent_id=agent_id,
        name=payload.name,
        prefix=key[:10],
        key_hash=_hash_key(key),
    )
    session.add(api_key)
    await session.commit()
    await session.refresh(api_key)

    # The full key is returned ONLY here, in this create response — it is
    # never stored (only its hash is) and can never be shown again.
    return {
        "id": str(api_key.id),
        "name": api_key.name,
        "prefix": api_key.prefix,
        "created_at": api_key.created_at.isoformat(),
        "key": key,
    }


@router.get("")
async def list_keys(
    agent_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    keys = (
        (await session.execute(select(ApiKey).where(ApiKey.agent_id == agent_id)))
        .scalars()
        .all()
    )
    # NEVER include key_hash or the full key here.
    return [
        {
            "id": str(k.id),
            "name": k.name,
            "prefix": k.prefix,
            "created_at": k.created_at.isoformat(),
            "last_used_at": k.last_used_at.isoformat() if k.last_used_at else None,
        }
        for k in keys
    ]


@router.delete("/{key_id}")
async def delete_key(
    agent_id: uuid.UUID,
    key_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
) -> dict:
    api_key = await session.get(ApiKey, key_id)
    if api_key is None or api_key.agent_id != agent_id:
        raise HTTPException(status_code=404, detail="Key not found")
    await session.delete(api_key)
    await session.commit()
    return {"ok": True}
