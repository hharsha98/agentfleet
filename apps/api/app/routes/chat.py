import uuid

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import current_user
from app.config import get_settings
from app.db import get_session
from app.models import Agent, Conversation, User
from app.ownership import is_visible
from app.ratelimit import chat_limit, limiter
from app.schemas import ConversationCreate, ConversationOut, MessageIn
from app.services.chat import stream_chat
from app.services.graph_runtime import stream_chat_graph
from app.services.pydantic_runtime import stream_chat_pydantic

router = APIRouter()


@router.post("", response_model=ConversationOut, status_code=201)
async def create_conversation(
    payload: ConversationCreate,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
) -> Conversation:
    agent = await session.get(Agent, payload.agent_id)
    if agent is None or not is_visible(agent, user, builtin=True):
        raise HTTPException(status_code=404, detail="Agent not found")
    conversation = Conversation(agent_id=agent.id, user_id=user.id)
    session.add(conversation)
    await session.commit()
    await session.refresh(conversation)
    return conversation


@router.post("/{conversation_id}/messages")
@limiter.limit(chat_limit)
async def send_message(
    request: Request,
    conversation_id: uuid.UUID,
    payload: MessageIn,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
) -> StreamingResponse:
    conversation = await session.get(Conversation, conversation_id)
    if conversation is None or not is_visible(conversation, user):
        raise HTTPException(status_code=404, detail="Conversation not found")
    agent = await session.get(Agent, conversation.agent_id)
    # The generator opens its own DB session: it outlives this handler's one.
    # Runtime dispatch (single point): a per-agent choice (Agent.runtime,
    # Phase 10 M / ARCHITECTURE.md ADR-001) takes priority — "pydantic-ai"
    # routes to services/pydantic_runtime.py. Every other agent (runtime
    # defaults to "langgraph") falls through to the existing process-wide
    # env switch (Settings.agent_runtime / AGENT_RUNTIME): LangGraph is the
    # default, the original hand-built loop is the documented fallback.
    settings = get_settings()
    if agent.runtime == "pydantic-ai":
        runner = stream_chat_pydantic
    elif settings.agent_runtime == "langgraph":
        runner = stream_chat_graph
    else:
        runner = stream_chat
    return StreamingResponse(
        runner(conversation_id, payload.content),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
