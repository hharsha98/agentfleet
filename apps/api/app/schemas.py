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


class RunTaskStatusUpdate(BaseModel):
    """PATCH /runs/{run_id}/tasks/{task_id} body (UI-5 Chunk C — drag-and-drop
    re-queue). `status` must be a known task status; the route's own
    allowlist (not this schema) decides which (from, to) pairs are actually
    permitted — an unrecognized value 422s here before the route even runs."""

    status: str = Field(pattern=r"^(todo|in_progress|review|done|failed)$")


class ScheduledRunOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    goal: str
    cron: str
    enabled: bool
    last_run_at: datetime | None
    created_at: datetime


# --- Workflows (visual workflow builder — Stage 2 backend foundation) ---------
#
# Node/edge ids come from the canvas (React Flow), not the server, so they're
# validated against a conservative charset rather than trusted as-is.

WORKFLOW_ID_RE = r"^[A-Za-z0-9_-]{1,64}$"
MAX_WORKFLOW_NODES = 40
MAX_WORKFLOW_EDGES = 120


class WorkflowPosition(BaseModel):
    """Canvas coordinates — display-only, never read by the compiler."""

    x: float = 0
    y: float = 0


class WorkflowNodeIn(BaseModel):
    id: str = Field(pattern=WORKFLOW_ID_RE)
    agent_slug: str = Field(min_length=1, max_length=64)
    title: str = Field(min_length=1, max_length=200)
    instruction: str = Field(default="", max_length=8000)
    needs_approval: bool = False
    position: WorkflowPosition = Field(default_factory=WorkflowPosition)


class WorkflowEdgeIn(BaseModel):
    id: str = Field(pattern=WORKFLOW_ID_RE)
    source: str = Field(pattern=WORKFLOW_ID_RE)
    target: str = Field(pattern=WORKFLOW_ID_RE)


class WorkflowGraphIn(BaseModel):
    schema_version: int = 1
    nodes: list[WorkflowNodeIn] = Field(default_factory=list, max_length=MAX_WORKFLOW_NODES)
    edges: list[WorkflowEdgeIn] = Field(default_factory=list, max_length=MAX_WORKFLOW_EDGES)


class WorkflowCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=1000)
    graph: WorkflowGraphIn


class WorkflowUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=1000)
    graph: WorkflowGraphIn | None = None


class WorkflowSummaryOut(BaseModel):
    """List-view row — omits `graph` (see WorkflowOut), same split as
    PlaygroundExperimentSummaryOut/EvalRunSummaryOut above."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    description: str
    node_count: int
    edge_count: int
    created_at: datetime
    updated_at: datetime


class WorkflowOut(WorkflowSummaryOut):
    graph: dict


class WorkflowIssue(BaseModel):
    """One compiler finding. `code` is one of: cycle, unknown_agent,
    dangling_edge, self_loop, empty, duplicate_id, orphan_node, wide_fan_in,
    empty_instruction."""

    code: str
    message: str
    node_ids: list[str] = []


class WorkflowTaskPreview(BaseModel):
    """One compiled RunTask-to-be, for the dry-run validation endpoint —
    shaped like the dict compile_workflow() emits, not the ORM RunTask."""

    ordinal: int
    title: str
    agent_slug: str
    depends_on: list[int]
    needs_approval: bool


class WorkflowValidationOut(BaseModel):
    ok: bool
    errors: list[WorkflowIssue] = []
    warnings: list[WorkflowIssue] = []
    tasks: list[WorkflowTaskPreview] = []
    estimated_waves: int
