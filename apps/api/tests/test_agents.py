"""Integration test against the local dev Postgres (docker compose must be up)."""

import asyncio

from fastapi.testclient import TestClient

from app.db import engine
from app.main import app
from scripts.seed_agents import main as seed


async def _seed_and_release_pool() -> None:
    await seed()
    # Connections created in this event loop must not leak into the
    # TestClient's loop — dispose returns them all.
    await engine.dispose()


def test_list_agents_after_seed() -> None:
    asyncio.run(_seed_and_release_pool())
    response = TestClient(app).get("/api/v1/agents")
    assert response.status_code == 200
    slugs = {a["slug"] for a in response.json()}
    assert {"orchestrator", "deep-research", "creative-writer", "system-architect"} <= slugs
