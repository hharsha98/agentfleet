import uuid
from datetime import datetime

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
    runtime: str


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


class AgentVersionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    version: int
    note: str
    created_at: datetime


class AgentVersionDetailOut(AgentVersionOut):
    config: dict


class AgentPublish(BaseModel):
    note: str = ""


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


class EvalCaseCreate(BaseModel):
    input: str = Field(min_length=1, max_length=8000)
    expected_contains: list[str] = []
    forbidden_contains: list[str] = []
    judge_rubric: str = ""


class EvalCaseOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    agent_id: uuid.UUID
    input: str
    expected_contains: list[str]
    forbidden_contains: list[str]
    judge_rubric: str
    created_at: datetime


class EvalRunOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    agent_id: uuid.UUID
    total: int
    passed: int
    results: list[dict]
    created_at: datetime


class EvalRunSummaryOut(BaseModel):
    """Lightweight run listing — omits the heavy per-case `results` payload."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    total: int
    passed: int
    created_at: datetime


class BudgetOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    agent_id: uuid.UUID | None
    agent_slug: str | None = None
    daily_token_limit: int | None
    daily_usd_limit: float | None


class BudgetUpsert(BaseModel):
    agent_id: uuid.UUID | None = None
    daily_token_limit: int | None = Field(default=None, ge=0)
    daily_usd_limit: float | None = Field(default=None, ge=0)


class UsageTodayOut(BaseModel):
    tokens: int
    cost_usd: float
    messages: int


class UsagePerAgentOut(BaseModel):
    agent_slug: str
    agent_name: str
    tokens: int
    cost_usd: float
    messages: int


class UsageSummaryOut(BaseModel):
    today: UsageTodayOut
    per_agent: list[UsagePerAgentOut]


class UsageDailyOut(BaseModel):
    date: str
    tokens: int
    cost_usd: float


class PlaygroundRunRequest(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    system_prompt: str = Field(default="", max_length=8000)
    user_message: str = Field(min_length=1, max_length=8000)
    model: str = Field(min_length=1, max_length=120)
    temperature: float = Field(default=0.7, ge=0, le=2)
    max_tokens: int | None = Field(default=None, ge=1, le=32000)


class PlaygroundUsageOut(BaseModel):
    tokens_in: int
    tokens_out: int
    cost_usd: float
    latency_ms: int


class PlaygroundRunResponse(BaseModel):
    output: str
    usage: PlaygroundUsageOut


class PlaygroundModelsOut(BaseModel):
    models: list[str]


class PlaygroundVariant(BaseModel):
    """One A/B variant: the config that produced `output`, plus its usage."""

    model_config = ConfigDict(protected_namespaces=())

    model: str = Field(min_length=1, max_length=120)
    temperature: float = Field(ge=0, le=2)
    output: str
    usage: PlaygroundUsageOut


class PlaygroundExperimentCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    system_prompt: str = Field(default="", max_length=8000)
    user_message: str = Field(min_length=1, max_length=8000)
    variant_a: PlaygroundVariant
    variant_b: PlaygroundVariant


class PlaygroundExperimentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    system_prompt: str
    user_message: str
    variant_a: dict
    variant_b: dict
    created_at: datetime


class PlaygroundExperimentSummaryOut(BaseModel):
    """Lightweight list entry — omits prompts/outputs (see PlaygroundExperimentOut)."""

    id: uuid.UUID
    title: str
    created_at: datetime
    models: list[str]


class ScheduledRunOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    goal: str
    cron: str
    enabled: bool
    last_run_at: datetime | None
    created_at: datetime
