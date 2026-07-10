"""Integration tests for the runtime agent builder CRUD endpoints.

Against the local dev Postgres (docker compose must be up).

Deliberately NOT the sync-TestClient + asyncio.run() pattern from
test_agents.py: asyncpg connections are bound to the event loop that created
them, and once a *second* test in the suite uses that pattern, the shared
`app.db.engine` pool ends up with connections from two different (one of
them already-dead) event loops — asyncpg then raises "cannot perform
operation: another operation is in progress" nondeterministically depending
on GC timing. Running this whole test — seed, requests, and the final
dispose — inside a single event loop (an async test function + httpx
AsyncClient) sidesteps that entirely: every connection the pool ever hands
out here is created and closed on the same loop.
"""

from httpx import ASGITransport, AsyncClient

from app.db import engine
from app.main import app
from scripts.seed_agents import main as seed


async def test_agent_builder_crud() -> None:
    await seed()
    created_ids: list[str] = []

    try:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            # Create + appears in list.
            create_res = await client.post(
                "/api/v1/agents",
                json={
                    "slug": "test-builder-agent",
                    "name": "Test Builder Agent",
                    "description": "Created by test_agent_builder.py",
                    "system_prompt": "You are a test agent.",
                    "tools": [],
                },
            )
            assert create_res.status_code == 201, create_res.text
            agent = create_res.json()
            created_ids.append(agent["id"])
            assert agent["slug"] == "test-builder-agent"
            assert agent["is_builtin"] is False
            assert agent["temperature"] == 0.7

            list_res = await client.get("/api/v1/agents")
            assert list_res.status_code == 200
            assert any(a["slug"] == "test-builder-agent" for a in list_res.json())

            # Duplicate slug -> 409.
            dup_res = await client.post(
                "/api/v1/agents",
                json={
                    "slug": "test-builder-agent",
                    "name": "Duplicate",
                    "system_prompt": "Dup.",
                },
            )
            assert dup_res.status_code == 409

            # Unknown tool -> 422.
            bad_tool_res = await client.post(
                "/api/v1/agents",
                json={
                    "slug": "test-builder-bad-tool",
                    "name": "Bad Tool Agent",
                    "system_prompt": "Has a bad tool.",
                    "tools": ["not_a_real_tool"],
                },
            )
            assert bad_tool_res.status_code == 422

            # PATCH temperature works.
            patch_res = await client.patch(
                f"/api/v1/agents/{agent['id']}",
                json={"temperature": 1.2},
            )
            assert patch_res.status_code == 200, patch_res.text
            assert patch_res.json()["temperature"] == 1.2

            # DELETE a builtin -> 409.
            builtin_res = await client.get("/api/v1/agents")
            builtin = next(a for a in builtin_res.json() if a["is_builtin"])
            delete_builtin_res = await client.delete(f"/api/v1/agents/{builtin['id']}")
            assert delete_builtin_res.status_code == 409

            # DELETE the created agent -> ok.
            delete_res = await client.delete(f"/api/v1/agents/{agent['id']}")
            assert delete_res.status_code == 200
            assert delete_res.json() == {"ok": True}
            created_ids.remove(agent["id"])
    finally:
        # Clean up any agents left over from a failed assertion so reruns stay green.
        if created_ids:
            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test"
            ) as client:
                for agent_id in created_ids:
                    await client.delete(f"/api/v1/agents/{agent_id}")
        # Release pooled connections while still on this test's event loop —
        # see module docstring for why this matters.
        await engine.dispose()
