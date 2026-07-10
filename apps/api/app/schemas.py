import uuid

from pydantic import BaseModel, ConfigDict, Field


class AgentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True, protected_namespaces=())

    id: uuid.UUID
    slug: str
    name: str
    description: str
    model: str
    system_prompt: str
    temperature: float
    tools: list
    mcp_servers: list
    is_builtin: bool


class AgentCreate(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    slug: str = Field(pattern=r"^[a-z0-9][a-z0-9-]{1,62}$")
    name: str = Field(min_length=1, max_length=120)
    description: str = ""
    system_prompt: str = Field(min_length=1, max_length=8000)
    model: str = ""  # empty means "use server default"
    temperature: float = Field(default=0.7, ge=0, le=2)
    tools: list[str] = []
    mcp_servers: list[dict] = []


class AgentUpdate(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = None
    system_prompt: str | None = Field(default=None, min_length=1, max_length=8000)
    model: str | None = None
    temperature: float | None = Field(default=None, ge=0, le=2)
    tools: list[str] | None = None
    mcp_servers: list[dict] | None = None


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
