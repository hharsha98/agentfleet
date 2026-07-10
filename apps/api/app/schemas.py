import uuid

from pydantic import BaseModel, ConfigDict, Field


class AgentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True, protected_namespaces=())

    id: uuid.UUID
    slug: str
    name: str
    description: str
    model: str


class ConversationCreate(BaseModel):
    agent_id: uuid.UUID


class ConversationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    agent_id: uuid.UUID
    title: str


class MessageIn(BaseModel):
    # Hard cap: unbounded input is a memory/DB/provider-cost DoS vector on an
    # endpoint that has no auth yet (review finding, 2026-07-10).
    content: str = Field(min_length=1, max_length=8000)
