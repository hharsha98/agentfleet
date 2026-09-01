from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+asyncpg://agentfleet:agentfleet@localhost:5432/agentfleet"
    # Postgres schema for app tables + Alembic version + LangGraph checkpoints.
    # Default `public` matches local compose. Cloudflare/Supabase set
    # DATABASE_SCHEMA=agentfleet so we do not collide with other public tables.
    database_schema: str = "public"
    # asyncpg rejects `?sslmode=require` on the DSN. Set DATABASE_SSL=1 and
    # the engine passes ssl=True (Supabase/Neon TLS). Leave off for local
    # compose, which has no TLS.
    database_ssl: bool = False
    redis_url: str = "redis://localhost:6379/0"

    # Async engine connection pool (Bug 1, Wave 1 — see app/db.py for
    # pool_pre_ping, which is hardcoded True rather than a setting because
    # there is no deployment where you'd ever want it off).
    #
    # Sizing is derived, not guessed — the arithmetic:
    #
    # Assumed cap: 25 concurrent connections. That's GCP Cloud SQL's
    # documented default max_connections for the db-f1-micro tier (Wave 4's
    # target; GCP sizes the default off the tier's ~0.6GB RAM). Neon's free
    # tier (Wave 2's target) is NOT the binding constraint: its pooled
    # (pgbouncer) endpoint supports far more than 25, so whichever number
    # this app is sized against, Cloud SQL is the tighter one. This is a
    # documented ASSUMPTION pending real numbers once each service is
    # actually provisioned (Wave 2 / Wave 4) — re-derive this arithmetic
    # then rather than trusting it forever.
    #
    # Assumed fleet shape: up to 4 API instances (Cloud Run's eventual
    # autoscale ceiling for a portfolio-scale app — k8s/api.yaml hardcodes
    # replicas: 1 today, so 4 is a forward-looking assumption, not a
    # measurement) + 1 arq worker instance (matches k8s/worker.yaml's
    # replicas: 1 today; the cron poller in worker.py's WorkerSettings also
    # assumes exactly one process, so this one shouldn't be scaled anyway).
    #
    #   API:    (db_pool_size=3 + db_max_overflow=2) x 4 instances = 20
    #   Worker: (worker's own smaller pool, set via env — see app/worker.py
    #            which defaults DB_POOL_SIZE/DB_MAX_OVERFLOW down to 1+1
    #            before importing app.db) x 1 instance              =  2
    #   ---------------------------------------------------------------
    #   Peak = 22, leaving 3 connections of headroom under the 25 cap for a
    #   manual psql/alembic/admin connection.
    #
    # If max_app_instances or the cap changes, redo this arithmetic — these
    # defaults are sized against it, not picked round numbers.
    db_pool_size: int = 3
    db_max_overflow: int = 2
    # Recycle comfortably under Neon's free-tier auto-suspend (assumed 5
    # minutes / 300s of idle compute — confirm at Wave 2; this is the
    # "proxy/DB idle timeout" this must sit under). pool_pre_ping already
    # catches a connection that went stale AFTER a suspend; pool_recycle
    # proactively refreshes connections before they'd have gone stale, so
    # the two are complementary, not redundant.
    db_pool_recycle_seconds: int = 270
    # SQLAlchemy's own library default (30s) — made an explicit, documented
    # setting here rather than an implicit default so it shows up as a real
    # knob during a review, not something to rediscover in the SQLAlchemy
    # source.
    db_pool_timeout_seconds: int = 30

    # How mission runs get dispatched: "inprocess" (default — asyncio.create_task
    # in the API process; dies if the API restarts, but needs no extra
    # service, so `uvicorn` dev flow and the test suite keep working
    # unchanged) or "arq" (durable — enqueued to the Redis-backed arq worker
    # in app/worker.py, survives an API restart; set by compose/k8s).
    orchestrator_mode: str = "inprocess"  # "arq" | "inprocess"

    free_llm_base_url: str = "http://localhost:3001/v1"
    free_llm_key: str = ""
    default_model: str = "openai/gpt-oss-120b"
    # Tiered routing: strong model plans (the "brain"), cheap models execute.
    # Empty -> planning falls back to default_model.
    planner_model: str = ""

    anthropic_api_key: str = ""

    # LLM client timeouts (Bug 2, Wave 1 — see app/providers.py). Asymmetric
    # on purpose: `connect` fails fast because a dead endpoint has no reason
    # to take long; `read` is generous because a large model streaming a
    # long completion can legitimately run past a minute.
    #
    # `read` MUST stay under Cloud Run's request timeout (default 300s,
    # Wave 4's eventual deploy target) — if Cloud Run kills the request
    # first, this timeout never gets the chance to fire. 120s leaves
    # ~2.5x Cloud Run's own margin over a typical long completion while
    # keeping well clear of the 300s ceiling.
    llm_connect_timeout_seconds: float = 5.0
    llm_read_timeout_seconds: float = 120.0
    llm_write_timeout_seconds: float = 10.0
    llm_pool_timeout_seconds: float = 5.0
    # SDK retry cap: kept LOW on purpose. self_heal_deadline_seconds and the
    # escalation ladder above already retry *semantically* (new prompt,
    # escalated model) on top of whatever the SDK does — piling the SDK's
    # own retries underneath that would let a transport hiccup compound
    # into a multi-minute stall exactly while the self-heal clock is
    # already ticking. 1 covers a single transport blip (dropped
    # connection, a bare 5xx) without adding meaningfully to worst-case
    # latency; anything beyond that is self-heal's job, not the SDK's.
    llm_max_retries: int = 1

    # Shared HS256 JWT signing secret (Phase 12 B): same value the web app
    # uses to mint tokens. Blank -> app.auth.current_user fails CLOSED (503),
    # never open. Env: AUTH_SECRET.
    auth_secret: str = ""

    # Which agent loop implementation runs chat turns: the LangGraph
    # StateGraph runtime (default, ADR-001) or the original hand-built
    # while-loop (services/chat.py), kept as a documented fallback.
    agent_runtime: str = "langgraph"  # "langgraph" | "native"

    # Which LangGraph checkpointer backs graph state: durable Postgres
    # (default; see services/checkpointer.py) or an in-process MemorySaver
    # for environments without a database (the checkpointer also falls back
    # automatically on connection failure — this setting forces it
    # explicitly, e.g. for tests or a DB-less dev laptop).
    checkpointer: str = "postgres"  # "postgres" | "memory"

    searxng_url: str = "http://localhost:8081"

    # New-agent integrations (Phase 10 H): leave blank to disable that
    # agent's external action — the agent still loads and runs, it just
    # returns a graceful "not configured" message instead of calling out.
    slack_webhook_url: str = ""  # Competitor Monitor's send_slack tool
    hubspot_access_token: str = ""  # Meeting Notes -> CRM's push_to_crm tool

    # Optional dedicated Postgres for the SQL Analytics agent's sql_query
    # tool. Blank (default) -> sql_query reuses the main app database, where
    # scripts/seed_analytics.py seeds the demo analytics_sales /
    # analytics_customers tables. Set to point sql_query at a separate,
    # truly read-only database instead.
    analytics_database_url: str = ""

    # web_search provider routing: "tavily" | "exa" | "searxng". Missing key,
    # a raised error, or zero results for the chosen provider all fall back
    # to SearXNG (see tools.py web_search).
    web_search_provider: str = "searxng"
    tavily_api_key: str = ""
    exa_api_key: str = ""

    # Optional Langfuse tracing — leave empty to run without it.
    langfuse_public_key: str = ""
    langfuse_secret_key: str = ""
    langfuse_host: str = "https://cloud.langfuse.com"

    # Comma-separated list of origins allowed to call the API (CORS). Env:
    # CORS_ORIGINS. Default matches the web app's local dev port (3002). 3010 is
    # kept listed because the web app briefly ran there while another tool held
    # 3002, and listing both means moving the web port never breaks CORS.
    cors_origins: str = "http://localhost:3002,http://localhost:3010"

    # Voice agent (Phase 10 N): Vapi bundles browser mic capture, STT, TTS,
    # and telephony behind one web SDK. Blank public key -> GET
    # /api/v1/voice/config returns {"enabled": false} and the frontend shows
    # a "not configured" state instead of attempting a call.
    vapi_public_key: str = ""  # browser SDK uses this to start a call
    vapi_api_key: str = ""  # reserved for server-side Vapi management, unused for now

    # Error monitoring (Phase 11 P): blank DSN -> app.observability.init_sentry()
    # logs one line and skips sentry_sdk.init() entirely — no behavior change.
    sentry_dsn: str = ""
    sentry_environment: str = "dev"

    # Rate limiting (Phase 12 C, app/ratelimit.py): slowapi + `limits`, keyed
    # per-user (JWT email) else per-IP. Applied only to chat send, document
    # upload, and the public invoke endpoint — see ARCHITECTURE.md. Strings
    # use the `limits` ratelimit-string format ("N/second|minute|hour|day").
    rate_limit_chat: str = "30/minute"
    rate_limit_upload: str = "10/minute"
    rate_limit_public: str = "60/minute"
    # Set to true (env RATE_LIMIT_DISABLED=1) to turn all rate limiting off —
    # used by the test suite (tests/conftest.py) and available for local dev.
    rate_limit_disabled: bool = False

    # Deploy safety (Phase 12 F2): load the fastembed model in a background
    # thread at API startup so the first document upload doesn't eat the
    # multi-second cold start. Set EMBEDDINGS_PREWARM=0 to skip (CI/tests —
    # the model is a ~130MB download; tests/conftest.py sets this).
    embeddings_prewarm: str = "1"

    # Self-healing task execution (services/orchestrator.py::_execute_task):
    # a failed attempt is retried as a follow-up turn in the SAME
    # conversation asking the agent to diagnose and try a different
    # approach, instead of giving up. This is a WALL-CLOCK bound on how long
    # that repair loop may keep retrying a single task — deliberately NOT an
    # attempt count (there is no fixed retry cap). The loop also stops early
    # on stall detection (two consecutive attempts hit the same normalized
    # error) or budget exhaustion (services/budget.py::check_budget).
    self_heal_deadline_seconds: int = 300
    # Failure classification (services/orchestrator.py::classify_failure): a
    # "transient" failure (provider 5xx/429/timeout/connection reset) means
    # the approach was fine and infrastructure blipped, so the retry reuses
    # the SAME prompt rather than spending an LLM reasoning turn — but it
    # still needs a brief pause before hammering the provider again. Tests
    # monkeypatch this to 0 so the transient path doesn't slow the suite.
    self_heal_transient_backoff_seconds: float = 1.0

    # Self-heal escalation ladder (services/orchestrator.py::_execute_task,
    # Layer 2): a comma-separated, ORDERED list of progressively stronger
    # model ids, e.g. "openai/gpt-oss-120b,anthropic/claude-sonnet-4". Retrying
    # an "approach"-classified repair on the SAME model that just failed is
    # the weakest available move — a person would bring in something
    # stronger. Only "approach" failures advance one rung on the NEXT
    # attempt (a "transient" provider blip is never the model's fault, so it
    # never consumes a rung); once the ladder is exhausted, repairs keep
    # using the strongest (last) rung rather than stopping — escalation
    # picks WHICH model the next attempt uses, it never introduces a fixed
    # attempt cap (see self_heal_deadline_seconds for the actual stop
    # condition). Tiered routing, same style as planner_model above: strong
    # model repairs, cheap model executes the happy path.
    #
    # Empty (default) -> falls back to a single-rung ladder made of
    # planner_model, if that's set (the "brain" model becomes the
    # escalation target for free); if planner_model is ALSO empty, there is
    # no escalation at all — every attempt uses the agent's own model,
    # identical to the behaviour before this setting existed.
    self_heal_escalation_models: str = ""


@lru_cache
def get_settings() -> Settings:
    return Settings()
