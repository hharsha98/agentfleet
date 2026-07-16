from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+asyncpg://agentfleet:agentfleet@localhost:5432/agentfleet"
    redis_url: str = "redis://localhost:6379/0"

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
    # CORS_ORIGINS. Default matches the web app's local dev port.
    cors_origins: str = "http://localhost:3002"

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


@lru_cache
def get_settings() -> Settings:
    return Settings()
