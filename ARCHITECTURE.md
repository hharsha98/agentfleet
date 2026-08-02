# Architecture Decision Records

Short, honest records of the trade-offs behind AgentFleet. Format: context → decision → why → what we gave up.

## ADR-001: LangGraph for agent orchestration

**Alternatives considered:** Claude Agent SDK, Pydantic AI, OpenAI Agents SDK, CrewAI, AutoGen.
**Decision:** LangGraph for the core runtime.
**Why:** Explicit state machines with checkpointing, first-class `interrupt()` for human-in-the-loop gates, and the highest demand signal in 2026 German job postings. CrewAI abstracts too much for a platform runtime; the Claude Agent SDK and Pydantic AI are strong but younger — one roster agent may be re-implemented on a second SDK later to show breadth.
**Trade-off:** More boilerplate than CrewAI; LangChain ecosystem coupling.
**Status (2026-07-11):** Implemented and now the default (`AGENT_RUNTIME=langgraph`). `services/graph_runtime.py` compiles a `StateGraph`: a model node and a custom tools node (still our own guardrails + MCP dispatch, not the prebuilt `ToolNode`) linked by a conditional edge — tool calls loop back to the model, a plain answer routes to `END` — with checkpointing keyed by `thread_id`. It streams the identical SSE contract the hand-built loop produced. That original hand-built loop (`services/chat.py`) — built first, before adopting LangGraph, specifically to understand the agentic tool-call loop from scratch — is kept as an env-switchable fallback (`AGENT_RUNTIME=native`) and as a deliberate "built it from scratch first" learning artifact.
**Status (2026-08-02):** Two corrections to the note above, both in the direction of "the code is now more careful than this record said". Checkpointing is no longer `MemorySaver` — `services/checkpointer.py` provides a process-wide `AsyncPostgresSaver` over a `psycopg_pool` connection pool (lock-guarded double-checked init, DSN translated from `postgresql+asyncpg://` to psycopg v3, graceful `MemorySaver` fallback, no connection at import time). And the `thread_id` is minted **per turn** (`f"{conversation_id}:{uuid4().hex}"`), not per conversation: LangGraph's `add_messages` reducer *appends* to whatever the checkpointer already holds, and this runtime separately re-seeds full history from the `messages` table each turn, so a stable per-conversation thread id would duplicate every prior message and compound token cost on every turn. The `messages` table stays the single source of conversation memory; the checkpointer provides durability within a turn. Also note ADR-001's original "first-class `interrupt()` for human-in-the-loop" rationale: HITL approvals are in fact hand-rolled on a DB status field (`RunTask.status == "review"` plus an approve endpoint), not LangGraph `interrupt()`. The feature works; the justification named a mechanism we did not end up using.

## ADR-002: One Postgres (with pgvector) for everything

**Alternatives:** Pinecone/Qdrant for vectors, separate state store.
**Decision:** Single Postgres instance holds app state, LangGraph checkpoints, vector embeddings (pgvector), and the audit log.
**Why:** One database = one backup, one migration tool (Alembic), one RDS instance on AWS (cost). pgvector handles our scale (thousands of chunks, not billions).
**Trade-off:** At serious scale a dedicated vector DB wins; we document the swap path.
**Status (2026-08-02):** The single-Postgres decision holds and is implemented. An earlier version of this record claimed *hybrid search* as though it were built. It was not, and that claim is withdrawn here rather than quietly deleted. Retrieval today is **dense-only**: `Chunk.embedding.cosine_distance(...)` ordered and limited (`services/ingest.py`, `tools.py::search_documents`), with **no ANN index**, so it is an exact scan — verified by grep, zero occurrences of `tsvector`, `bm25`, or `rerank` anywhere in `apps/api`. Sparse retrieval fused with dense via Reciprocal Rank Fusion, cross-encoder reranking, and an HNSW index are planned; this line moves to "implemented" only when the retrieval-eval table shows the measured difference. The gap between what an ADR claims and what the code does is precisely the thing an ADR exists to prevent, so the correction is recorded in place.

## ADR-003: Langfuse Cloud (free tier) instead of self-hosted

**Decision:** Langfuse cloud free tier for LLM tracing.
**Why:** Langfuse v3 self-host requires ClickHouse + MinIO + Redis — three extra containers that bloat local dev and AWS cost for zero portfolio value. The integration code is identical either way.
**Trade-off:** Trace data lives in Langfuse's EU cloud; acceptable for a portfolio project with synthetic data.
**Status (2026-08-02):** Partially implemented, and an earlier version of this record overstated it. Two claims are withdrawn. (1) **OpenTelemetry GenAI conventions** — not implemented; grep finds zero occurrences of `opentelemetry` in `apps/api`. (2) **"deep links from our in-app trace timeline"** — there is no in-app trace timeline. What exists is narrower than it sounds: `providers.py` swaps in `langfuse.openai.AsyncOpenAI` when both Langfuse keys are set, and that is the whole integration. Note the consequence, because it is the part worth knowing — the **default** runtime (`services/graph_runtime.py`) constructs `langchain_openai.ChatOpenAI` directly and never routes through `providers.py`, so the default path is not traced at all. Planned: emit OTel spans following the GenAI semantic conventions across both runtimes and the orchestrator (including across the arq process boundary via W3C `traceparent`), make Langfuse a **destination over OTLP rather than a wrapped SDK**, and add a narrow in-app timeline that works with no collector configured.

## ADR-004: arq (Redis) for the task DAG, not Celery or Temporal

**Decision:** arq worker + Postgres task table + Redis pub/sub for live board updates.
**Why:** arq is async-native (matches FastAPI), tiny, and easy to reason about. Celery is heavier with no async benefit for us. Temporal is the "right" durable-execution answer at company scale — and is called out in job postings — but running a Temporal cluster triples infra for a solo project.
**Trade-off:** We hand-roll retry/resume semantics that Temporal gives for free; documented as the known upgrade path (and interview talking point).

## ADR-005: Dual-path LLM strategy (free dev / paid demo)

**Decision:** All LLM calls go through an OpenAI-compatible provider abstraction. Dev/testing points at the local `freellmapi` proxy (11 free providers, quota cascade). Demos and recordings switch via env to Anthropic API or AWS Bedrock.
**Why:** Free tiers (Groq `gpt-oss-120b` primary — reliable tool calling, no training on inputs) make development ~free, but they throw 429s mid-demo and cap context. Cost per run is metered and surfaced in the dashboard either way — the routing itself is a product feature.
**Trade-off:** Two code paths to test; some free models have weaker tool-calling — the eval suite catches regressions when switching.

## ADR-007: Local-first delivery; cloud deployment on demand

**Decision (2026-07-11):** Build the complete prototype locally (Docker Compose, later kind/K8s manifests). Cloud deployment happens on demand: AWS first when interviews are scheduled (~$100 credit ≈ the interview window), GCP after (~3 months free tier). Terraform/GCP configs are prepared in advance so going live is a ~1-hour task.
**Why:** Cloud credits are a scarce resource for a student; burning them before anyone is watching buys nothing. Containerized, provider-agnostic services make the cloud switch a configuration change.
**Trade-off:** No always-on public URL until interview season — mitigated by a polished demo video and one-command local setup.

## ADR-008: Local embeddings (fastembed) for document RAG

**Decision:** Embeddings run locally via fastembed (ONNX, `BAAI/bge-small-en-v1.5`, 384 dims) instead of a paid/remote embedding API.
**Why:** Local-first (works offline, zero per-token cost, no data leaves the machine), small and CPU-fast, production-credible (maintained by Qdrant). pgvector stores the vectors either way, so swapping to a hosted embedding model later is a one-file change.
**Trade-off:** English-optimized small model — retrieval quality below large hosted embedders; acceptable at portfolio corpus size.

## ADR-006: Redis as a Fargate sidecar container, not ElastiCache

**Decision:** On AWS, Redis runs as a container alongside the worker instead of ElastiCache.
**Why:** ElastiCache's smallest node adds ~€11/month for a demo deployment; our Redis holds only queues and pub/sub (ephemeral, rebuildable).
**Trade-off:** No HA, data lost on restart — fine for queues, wrong for anything durable (which lives in Postgres).

## Second runtime: Pydantic AI (Phase 10 M)

**Decision (2026-07-16):** Add a `runtime` column to `Agent` (`"langgraph"` default, `"pydantic-ai"` opt-in) and a second chat-turn executor, `services/pydantic_runtime.py`, built on `pydantic-ai-slim[openai]`. `routes/chat.py`'s `send_message` dispatches on `agent.runtime` at a single point — every existing agent is unaffected, only the new built-in `fact-checker` agent opts in.
**Why:** ADR-001 flagged Pydantic AI as a framework to demonstrate breadth on later; this is that agent. It reuses the same OpenAI-compatible proxy, `app.tools` functions (wrapped as thin Pydantic AI tools rather than rewritten), budget checks, and `app.costs` metering — only the model↔tool loop implementation differs.
**Contract parity, not feature parity:** the SSE frames (`token`/`done`/`error`) and usage/cost shape are identical to `graph_runtime.py`'s, so the frontend and the eval harness can't tell which runtime answered. Scope is deliberately narrower than the LangGraph runtime — two wrapped tools, no MCP dispatch, no guardrail scanning, no recursion-limit salvage path — since the goal is showing a second SDK works, not re-implementing the whole roster.
**Trade-off:** a second code path to keep in sync with `app.tools`' function signatures; accepted because it's isolated to one opt-in agent.

## Voice agent (Vapi) (Phase 10 N)

**Decision (2026-07-16):** A single `GET /api/v1/voice/config` endpoint gates the whole feature on whether `vapi_public_key` is set — blank returns `{"enabled": false}` and the `/voice` page shows a static "not configured" state; set, it returns a static Vapi-shaped "transient assistant" config (`name`, `firstMessage`, `model`, `voice`) the frontend passes to `vapi.start()` verbatim.
**Why:** Vapi's web SDK (`@vapi-ai/web`, dynamically imported so it never enters the shared bundle) does mic capture, STT, TTS, and telephony entirely in the browser once handed a public key + assistant config — our backend never touches audio and needs no dedicated call-handling code.
**Secrecy:** only `vapi_public_key` is ever returned to the browser; `vapi_api_key` (reserved for future server-side Vapi management) is never read or serialized by the route, verified by a dedicated test.
**Trade-off:** the assistant config is static/demo-only (no persistence, no per-user customization) — acceptable for a scoped portfolio demo; a real deployment would move assistant definition server-side into Vapi's dashboard/API.

## Error monitoring (Sentry) (Phase 11 P)

**Decision (2026-07-16):** Add Sentry to both the API and the web app, gated entirely on DSN env vars — blank `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` (the default; no real DSN exists yet) mean `sentry-sdk`/`@sentry/nextjs` are never initialized and behave as a clean no-op, same graceful-degradation pattern as `vapi_public_key`. Backend: `app/observability.py`'s `init_sentry()` is called once, right after `setup_logging()` in `main.py`. Frontend: Next 16's `instrumentation.ts` (server, `register()`/`onRequestError`) and `instrumentation-client.ts` (browser, runs before hydration) — both dynamically `import("@sentry/nextjs")` only when a DSN is present, so the SDK adds no bundle weight when disabled.
**Why request-ID tagging:** a `before_send` hook (`app/observability.py::attach_request_id`) reads the same `request_id_var` contextvar the JSON log formatter uses, and attaches it as a `request_id` tag on every Sentry event. That means a Sentry error and its corresponding structured log lines share one ID, so debugging can jump between "what Sentry captured" and "what the request actually did" without a separate correlation scheme.
**Sample rate:** `traces_sample_rate` / `tracesSampleRate` is `0.1` (10%) on both sides — enough to see performance trends without paying for full tracing on every request, appropriate for a low-traffic demo/portfolio deployment.
**Sourcemap upload deferred:** no webpack plugin, no `SENTRY_AUTH_TOKEN`, no `next.config.ts` changes — sourcemap upload requires a Sentry auth token that isn't available in this environment; runtime-only init today, source-mapped stack traces are a deploy-phase (Phase 12/13) follow-up.
**Trade-off:** without sourcemaps, client-side stack traces in Sentry will show minified code until that follow-up lands; acceptable since no DSN is configured yet regardless.

## Rate limiting (Phase 12 C)

**Decision (2026-07-16):** `slowapi` (+ `limits`) rate-limits exactly three routes — chat send, document upload, the public invoke endpoint — via `app/ratelimit.py`, wired into `main.py` with a custom `RateLimitExceeded` handler (not slowapi's built-in one — see that module's docstring for why).
**Key + storage:** per-user (the verified JWT's email claim, reusing `app.auth.decode_token`) when a Bearer token is present, else per-IP (`request.client.host`; `X-Forwarded-For` stays untrusted until a real reverse proxy is confirmed). Storage is Redis when reachable at startup, else `limits`' in-memory backend — logged once so it's obvious which is live; this is also what keeps CI green with no Redis service.
**Env-driven limits:** `RATE_LIMIT_CHAT` (30/minute), `RATE_LIMIT_UPLOAD` (10/minute), `RATE_LIMIT_PUBLIC` (60/minute) — read dynamically per request (not baked in at decoration time) specifically so tests can exercise a tiny limit via monkeypatched `Settings`.
**Disabled switch:** `RATE_LIMIT_DISABLED=1` flips `limiter.enabled = False`; the test suite sets this by default (`tests/conftest.py`) since dozens of existing tests reuse one test user across many calls.
**Trade-off:** `limits`' Redis backend is synchronous (blocks the event loop briefly per hit) — acceptable at this traffic scale; a truly async storage backend is a future upgrade if it ever isn't.
