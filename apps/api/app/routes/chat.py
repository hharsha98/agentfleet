import uuid

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db import get_session
from app.models import Agent, Conversation
from app.schemas import ConversationCreate, ConversationOut, MessageIn
from app.services.chat import stream_chat
from app.services.graph_runtime import stream_chat_graph

router = APIRouter()


@router.post("", response_model=ConversationOut, status_code=201)
async def create_conversation(
    payload: ConversationCreate,
    session: AsyncSession = Depends(get_session),
) -> Conversation:
    agent = await session.get(Agent, payload.agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail="Agent not found")
    conversation = Conversation(agent_id=agent.id)
    session.add(conversation)
    await session.commit()
    await session.refresh(conversation)
    return conversation


@router.post("/{conversation_id}/messages")
async def send_message(
    conversation_id: uuid.UUID,
    payload: MessageIn,
    session: AsyncSession = Depends(get_session),
) -> StreamingResponse:
    conversation = await session.get(Conversation, conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    # The generator opens its own DB session: it outlives this handler's one.
    # Runtime choice is an env switch (Settings.agent_runtime / AGENT_RUNTIME,
    # ADR-001): LangGraph is the default; the hand-built loop is the fallback.
    settings = get_settings()
    runner = stream_chat_graph if settings.agent_runtime == "langgraph" else stream_chat
    return StreamingResponse(
        runner(conversation_id, payload.content),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
