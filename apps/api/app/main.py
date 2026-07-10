from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routes.agents import router as agents_router
from app.routes.chat import router as chat_router
from app.routes.documents import router as documents_router
from app.routes.runs import router as runs_router

app = FastAPI(title="AgentFleet API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3002"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


app.include_router(agents_router, prefix="/api/v1/agents", tags=["agents"])
app.include_router(chat_router, prefix="/api/v1/conversations", tags=["conversations"])
app.include_router(documents_router, prefix="/api/v1/documents", tags=["documents"])
app.include_router(runs_router, prefix="/api/v1/runs", tags=["runs"])


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "agentfleet-api"}
