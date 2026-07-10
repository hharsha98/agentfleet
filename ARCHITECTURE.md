# Architecture Decision Records

Short, honest records of the trade-offs behind AgentFleet. Format: context → decision → why → what we gave up.

## ADR-001: LangGraph for agent orchestration

**Alternatives considered:** Claude Agent SDK, Pydantic AI, OpenAI Agents SDK, CrewAI, AutoGen.
**Decision:** LangGraph for the core runtime.
**Why:** Explicit state machines with Postgres checkpointing, first-class `interrupt()` for human-in-the-loop gates, and the highest demand signal in 2026 German job postings. CrewAI abstracts too much for a platform runtime; the Claude Agent SDK and Pydantic AI are strong but younger — one roster agent may be re-implemented on a second SDK later to show breadth.
**Trade-off:** More boilerplate than CrewAI; LangChain ecosystem coupling.

## ADR-002: One Postgres (with pgvector) for everything

**Alternatives:** Pinecone/Qdrant for vectors, separate state store.
**Decision:** Single Postgres instance holds app state, LangGraph checkpoints, vector embeddings (pgvector), and the audit log.
**Why:** One database = one backup, one migration tool (Alembic), one RDS instance on AWS (cost). pgvector handles our scale (thousands of chunks, not billions) with hybrid search.
**Trade-off:** At serious scale a dedicated vector DB wins; we document the swap path.

## ADR-003: Langfuse Cloud (free tier) instead of self-hosted

**Decision:** Langfuse cloud free tier + OpenTelemetry GenAI conventions; deep links from our in-app trace timeline.
**Why:** Langfuse v3 self-host requires ClickHouse + MinIO + Redis — three extra containers that bloat local dev and AWS cost for zero portfolio value. The integration code is identical either way.
**Trade-off:** Trace data lives in Langfuse's EU cloud; acceptable for a portfolio project with synthetic data.

## ADR-004: arq (Redis) for the task DAG, not Celery or Temporal

**Decision:** arq worker + Postgres task table + Redis pub/sub for live board updates.
**Why:** arq is async-native (matches FastAPI), tiny, and easy to reason about. Celery is heavier with no async benefit for us. Temporal is the "right" durable-execution answer at company scale — and is called out in job postings — but running a Temporal cluster triples infra for a solo project.
**Trade-off:** We hand-roll retry/resume semantics that Temporal gives for free; documented as the known upgrade path (and interview talking point).

## ADR-005: Dual-path LLM strategy (free dev / paid demo)

**Decision:** All LLM calls go through an OpenAI-compatible provider abstraction. Dev/testing points at the local `freellmapi` proxy (11 free providers, quota cascade). Demos and recordings switch via env to Anthropic API or AWS Bedrock.
**Why:** Free tiers (Groq `gpt-oss-120b` primary — reliable tool calling, no training on inputs) make development ~free, but they throw 429s mid-demo and cap context. Cost per run is metered and surfaced in the dashboard either way — the routing itself is a product feature.
**Trade-off:** Two code paths to test; some free models have weaker tool-calling — the eval suite catches regressions when switching.

## ADR-006: Redis as a Fargate sidecar container, not ElastiCache

**Decision:** On AWS, Redis runs as a container alongside the worker instead of ElastiCache.
**Why:** ElastiCache's smallest node adds ~€11/month for a demo deployment; our Redis holds only queues and pub/sub (ephemeral, rebuildable).
**Trade-off:** No HA, data lost on restart — fine for queues, wrong for anything durable (which lives in Postgres).
