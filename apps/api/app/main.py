import logging
import time
import uuid

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.logging_config import request_id_var, setup_logging
from app.routes.agents import router as agents_router
from app.routes.budgets import router as budgets_router
from app.routes.chat import router as chat_router
from app.routes.documents import router as documents_router
from app.routes.evals import router as evals_router
from app.routes.guardrails import router as guardrails_router
from app.routes.hooks import router as hooks_router
from app.routes.keys import router as keys_router
from app.routes.public import router as public_router
from app.routes.runs import router as runs_router
from app.routes.schedules import router as schedules_router
from app.routes.templates import router as templates_router
from app.routes.usage import router as usage_router
from app.routes.webhooks import router as webhooks_router

setup_logging()
logger = logging.getLogger("app.request")

app = FastAPI(title="AgentFleet API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in get_settings().cors_origins.split(",") if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
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


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "agentfleet-api"}
