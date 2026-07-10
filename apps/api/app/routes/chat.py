import uuid

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.models import Agent, Conversation
from app.schemas import ConversationCreate, ConversationOut, MessageIn
from app.services.chat import stream_chat

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
    return StreamingResponse(
        stream_chat(conversation_id, payload.content),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
