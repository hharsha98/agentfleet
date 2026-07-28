import asyncio
import logging
import threading
import time
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi.errors import RateLimitExceeded
from sqlalchemy import text

from app.config import get_settings
from app.logging_config import request_id_var, setup_logging
from app.observability import init_sentry
from app.ratelimit import limiter
from app.routes.agents import router as agents_router
from app.routes.budgets import router as budgets_router
from app.routes.chat import router as chat_router
from app.routes.documents import router as documents_router
from app.routes.evals import router as evals_router
from app.routes.guardrails import router as guardrails_router
from app.routes.hooks import router as hooks_router
from app.routes.keys import router as keys_router
from app.routes.playground import router as playground_router
from app.routes.public import router as public_router
from app.routes.runs import router as runs_router
from app.routes.schedules import router as schedules_router
from app.routes.templates import router as templates_router
from app.routes.usage import router as usage_router
from app.routes.voice import router as voice_router
from app.routes.webhooks import router as webhooks_router
from app.routes.workflows import router as workflows_router

setup_logging()
init_sentry()
logger = logging.getLogger("app.request")

# app.ratelimit's own startup log line (which storage backend it picked)
# fires at import time, before setup_logging() above has attached a
# handler, so it's silently dropped by Python's logging lastResort
# fallback — re-log the already-decided outcome here instead, now that
# logging is actually configured.
logger.info(
    "rate limiting: enabled=%s storage=%s",
    limiter.enabled,
    type(limiter._storage).__name__,
)

def _start_embeddings_prewarm() -> None:
    """Kick off a background load of the fastembed model (Phase 12 F2).

    The first document upload otherwise pays a multi-second cold start
    (model load, plus a ~130MB download on a fresh container). Runs in a
    daemon thread so it never blocks startup, and it is deliberately NOT
    part of /health/ready — embeddings are only needed for document
    upload/search, not core traffic, so readiness stays DB-only by design.

    Guard: EMBEDDINGS_PREWARM=0 skips entirely (CI/tests must not download
    models — tests/conftest.py sets it, and pytest never runs the lifespan
    anyway since tests construct TestClient(app)/ASGITransport without a
    `with` block, which is what triggers lifespan in starlette).
    """
    if get_settings().embeddings_prewarm == "0":
        logger.info("embeddings pre-warm skipped (EMBEDDINGS_PREWARM=0)")
        return

    def _warm() -> None:
        logger.info("embeddings pre-warm started")
        try:
            from app.services import ingest

            ingest._get_embedder()
            logger.info("embeddings pre-warm done")
        except Exception:
            # Non-fatal: uploads fall back to loading the model on demand.
            logger.warning("embeddings pre-warm failed", exc_info=True)

    threading.Thread(target=_warm, name="embeddings-prewarm", daemon=True).start()


@asynccontextmanager
async def lifespan(app: FastAPI):
    _start_embeddings_prewarm()
    yield


app = FastAPI(title="AgentFleet API", version="0.1.0", lifespan=lifespan)

app.state.limiter = limiter


@app.exception_handler(RateLimitExceeded)
async def rate_limit_exceeded_handler(request: Request, exc: RateLimitExceeded) -> JSONResponse:
    """Custom handler rather than slowapi's built-in
    `_rate_limit_exceeded_handler`: that default only writes Retry-After
    when `Limiter(headers_enabled=True)`, which app/ratelimit.py
    deliberately leaves off (see that module's docstring — headers_enabled
    crashes the two routes here that return a plain dict instead of a
    Response). Retry-After is still a hard requirement on 429s, so it's
    computed by hand from the limiter's own window stats, which
    `_check_request_limit` stashes on `request.state.view_rate_limit`
    before raising."""
    retry_after = 60
    view_limit = getattr(request.state, "view_rate_limit", None)
    if view_limit is not None:
        item, identifiers = view_limit
        try:
            reset_at, _remaining = limiter.limiter.get_window_stats(item, *identifiers)
            retry_after = max(1, int(reset_at - time.time()) + 1)
        except Exception:
            pass
    response = JSONResponse({"detail": f"Rate limit exceeded: {exc.detail}"}, status_code=429)
    response.headers["Retry-After"] = str(retry_after)
    return response


app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in get_settings().cors_origins.split(",") if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Request-ID", "X-Total-Count"],
)


@app.middleware("http")
async def request_id_middleware(request: Request, call_next):
    """Tag every request with a correlation ID and log one structured line.

    Reads an incoming X-Request-ID header if present, otherwise generates a
    uuid4 hex. The ID is available to any log call made while handling the
    request (via request_id_var) and echoed back on the response. Logging
    failures are swallowed — they must never break the actual request.
    """
    incoming = request.headers.get("X-Request-ID")
    request_id = incoming if incoming else uuid.uuid4().hex
    token = request_id_var.set(request_id)
    start = time.monotonic()
    try:
        response = await call_next(request)
    except Exception:
        request_id_var.reset(token)
        raise

    duration_ms = round((time.monotonic() - start) * 1000, 2)
    response.headers["X-Request-ID"] = request_id
    try:
        logger.info(
            "request method=%s path=%s status=%s duration_ms=%s",
            request.method,
            request.url.path,
            response.status_code,
            duration_ms,
        )
    except Exception:
        pass
    request_id_var.reset(token)
    return response


app.include_router(agents_router, prefix="/api/v1/agents", tags=["agents"])
app.include_router(chat_router, prefix="/api/v1/conversations", tags=["conversations"])
app.include_router(documents_router, prefix="/api/v1/documents", tags=["documents"])
app.include_router(runs_router, prefix="/api/v1/runs", tags=["runs"])
app.include_router(workflows_router, prefix="/api/v1/workflows", tags=["workflows"])
app.include_router(schedules_router, prefix="/api/v1/schedules", tags=["schedules"])
app.include_router(webhooks_router, prefix="/api/v1/webhooks", tags=["webhooks"])
app.include_router(hooks_router, prefix="/api/v1/hooks", tags=["hooks"])
app.include_router(keys_router, prefix="/api/v1/agents/{agent_id}/keys", tags=["keys"])
app.include_router(evals_router, prefix="/api/v1/agents/{agent_id}/evals", tags=["evals"])
app.include_router(guardrails_router, prefix="/api/v1/guardrails", tags=["guardrails"])
app.include_router(public_router, prefix="/api/v1/public", tags=["public"])
app.include_router(templates_router, prefix="/api/v1/templates", tags=["templates"])
app.include_router(usage_router, prefix="/api/v1/usage", tags=["usage"])
app.include_router(budgets_router, prefix="/api/v1/budgets", tags=["budgets"])
app.include_router(playground_router, prefix="/api/v1/playground", tags=["playground"])
app.include_router(voice_router, prefix="/api/v1/voice", tags=["voice"])


@app.get("/health")
async def health() -> dict[str, str]:
    """Liveness: cheap, no dependencies — must stay DB-free so a slow/down
    database never gets the process killed by a liveness probe."""
    return {"status": "ok", "service": "agentfleet-api"}


@app.get("/health/ready")
async def health_ready() -> JSONResponse:
    """Readiness (Phase 12 F2): can this replica serve real traffic?

    One `SELECT 1` through the async engine with a 2s budget. DB-only by
    design: embeddings (fastembed) are needed only for document
    upload/search, so a replica is 'ready' as soon as the DB answers — see
    _start_embeddings_prewarm above. Imports app.db at call time so tests
    can monkeypatch `db.engine`.
    """
    from app import db

    try:
        async with asyncio.timeout(2):
            async with db.engine.connect() as conn:
                await conn.execute(text("SELECT 1"))
    except Exception as exc:  # noqa: BLE001 — any failure means "not ready"
        reason = f"{type(exc).__name__}: {exc}"[:200]
        return JSONResponse({"status": "not ready", "reason": reason}, status_code=503)
    return JSONResponse({"status": "ready"})
