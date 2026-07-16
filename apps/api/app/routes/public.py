"""Public, API-key-authenticated agent invocation (Publish pillar).

Lets an outside caller (a script, another app, the bundled MCP server) run
one turn against a published agent without needing a browser session —
just a Bearer key minted from app/routes/keys.py.
"""

import hashlib
import json
import logging

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.models import Agent, ApiKey, Conversation
from app.ratelimit import limiter, public_limit
from app.services.chat import stream_chat

logger = logging.getLogger(__name__)

router = APIRouter()


class InvokeRequest(BaseModel):
    message: str = Field(min_length=1, max_length=8000)


def _hash_key(key: str) -> str:
    return hashlib.sha256(key.encode("utf-8")).hexdigest()


async def _authenticate(
    slug: str, authorization: str | None, session: AsyncSession
) -> ApiKey:
    # Same 401 for "missing header", "unknown key", and "key belongs to a
    # different agent" — a distinct error for the last case would let an
    # attacker confirm a key is valid while probing for the right slug.
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or malformed Authorization header")
    presented = authorization.removeprefix("Bearer ").strip()
    if not presented:
        raise HTTPException(status_code=401, detail="Missing or malformed Authorization header")

    key_hash = _hash_key(presented)
    api_key = (
        await session.execute(select(ApiKey).where(ApiKey.key_hash == key_hash))
    ).scalar_one_or_none()
    if api_key is None:
        raise HTTPException(status_code=401, detail="Invalid API key")

    agent = await session.get(Agent, api_key.agent_id)
    if agent is None or agent.slug != slug:
        raise HTTPException(status_code=401, detail="Invalid API key")

    return api_key


@router.post("/agents/{slug}/invoke")
@limiter.limit(public_limit)
async def invoke_agent(
    request: Request,
    slug: str,
    payload: InvokeRequest,
    authorization: str | None = Header(default=None),
    session: AsyncSession = Depends(get_session),
) -> dict:
    api_key = await _authenticate(slug, authorization, session)

    api_key.last_used_at = func.now()
    await session.commit()

    agent = await session.get(Agent, api_key.agent_id)
    conversation = Conversation(agent_id=agent.id, title="api-invoke")
    session.add(conversation)
    await session.commit()
    conversation_id = conversation.id

    # Consume stream_chat exactly like orchestrator._execute_task does:
    # strip the "data: " SSE framing, collect token text / done usage / error.
    text, usage, error = "", {}, None
    try:
        async for frame in stream_chat(conversation_id, payload.message):
            event = json.loads(frame[6:])
            if event["type"] == "token":
                text += event["content"]
            elif event["type"] == "done":
                usage = event["usage"]
            elif event["type"] == "error":
                error = event["message"]
    except Exception:
        logger.exception("public invoke crashed for conversation %s", conversation_id)
        error = "internal error"

    if error and not text:
        raise HTTPException(status_code=502, detail="Agent execution failed")

    return {"reply": text, "usage": usage}
