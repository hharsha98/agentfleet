"""Integration tests for the Publish pillar: per-agent API keys + the public
invoke endpoint's auth paths.

Same single-event-loop httpx.AsyncClient + ASGITransport pattern as
test_agent_builder.py (see that file's docstring for why — asyncpg
connections are bound to the event loop that created them).

Deliberately does NOT exercise a successful /invoke call with a valid key —
that would hit the real LLM provider. Only the non-LLM auth/CRUD paths are
covered here (401s happen before stream_chat is ever called).
"""

from httpx import ASGITransport, AsyncClient

from app.db import engine
from app.main import app
from scripts.seed_agents import main as seed


async def test_publish_api_keys_and_invoke_auth() -> None:
    # Earlier test files (e.g. test_agents.py) use a sync TestClient whose
    # internal event loop leaves connections in the shared app.db.engine
    # pool bound to a now-dead loop. Dispose first so every connection this
    # test's pool hands out is created fresh on THIS test's event loop —
    # same reasoning as test_agent_builder.py's module docstring.
    await engine.dispose()
    await seed()
    created_ids: list[str] = []

    try:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            # Create two agents: the target, and a second one to prove a key
            # cannot be used to invoke a *different* agent's slug.
            agent_res = await client.post(
                "/api/v1/agents",
                json={
                    "slug": "test-publish-agent",
                    "name": "Test Publish Agent",
                    "description": "Created by test_publish.py",
                    "system_prompt": "You are a test agent.",
                    "tools": [],
                },
            )
            assert agent_res.status_code == 201, agent_res.text
            agent = agent_res.json()
            created_ids.append(agent["id"])

            other_res = await client.post(
                "/api/v1/agents",
                json={
                    "slug": "test-publish-agent-other",
                    "name": "Test Publish Agent Other",
                    "description": "Created by test_publish.py",
                    "system_prompt": "You are another test agent.",
                    "tools": [],
                },
            )
            assert other_res.status_code == 201, other_res.text
            other_agent = other_res.json()
            created_ids.append(other_agent["id"])

            # --- create key ---
            create_key_res = await client.post(
                f"/api/v1/agents/{agent['id']}/keys",
                json={"name": "ci-key"},
            )
            assert create_key_res.status_code == 201, create_key_res.text
            key_body = create_key_res.json()
            assert key_body["name"] == "ci-key"
            full_key = key_body["key"]
            assert full_key.startswith("af_")
            assert key_body["prefix"] == full_key[:10]
            key_id = key_body["id"]

            # 404 for a nonexistent agent.
            missing_agent_res = await client.post(
                "/api/v1/agents/00000000-0000-0000-0000-000000000000/keys",
                json={"name": "nope"},
            )
            assert missing_agent_res.status_code == 404

            # --- list keys: full key/hash must NEVER appear ---
            list_res = await client.get(f"/api/v1/agents/{agent['id']}/keys")
            assert list_res.status_code == 200
            listed = list_res.json()
            assert any(k["id"] == key_id for k in listed)
            for k in listed:
                assert "key" not in k
                assert "key_hash" not in k
                assert full_key not in str(k)
                assert "prefix" in k and "created_at" in k

            # --- invoke: no auth header -> 401 ---
            no_auth_res = await client.post(
                f"/api/v1/public/agents/{agent['slug']}/invoke",
                json={"message": "hello"},
            )
            assert no_auth_res.status_code == 401

            # --- invoke: invalid key -> 401 ---
            bad_key_res = await client.post(
                f"/api/v1/public/agents/{agent['slug']}/invoke",
                json={"message": "hello"},
                headers={"Authorization": "Bearer af_not_a_real_key"},
            )
            assert bad_key_res.status_code == 401

            # --- invoke: valid key, WRONG slug -> 401 (same error either way) ---
            wrong_slug_res = await client.post(
                f"/api/v1/public/agents/{other_agent['slug']}/invoke",
                json={"message": "hello"},
                headers={"Authorization": f"Bearer {full_key}"},
            )
            assert wrong_slug_res.status_code == 401

            # --- revoke key ---
            revoke_res = await client.delete(f"/api/v1/agents/{agent['id']}/keys/{key_id}")
            assert revoke_res.status_code == 200
            assert revoke_res.json() == {"ok": True}

            # Revoking a key that doesn't belong to this agent (or doesn't
            # exist) -> 404.
            revoke_missing_res = await client.delete(
                f"/api/v1/agents/{agent['id']}/keys/{key_id}"
            )
            assert revoke_missing_res.status_code == 404

            # --- invoke with the now-revoked key -> 401 ---
            revoked_invoke_res = await client.post(
                f"/api/v1/public/agents/{agent['slug']}/invoke",
                json={"message": "hello"},
                headers={"Authorization": f"Bearer {full_key}"},
            )
            assert revoked_invoke_res.status_code == 401

            # Cleanup.
            for agent_id in list(created_ids):
                del_res = await client.delete(f"/api/v1/agents/{agent_id}")
                assert del_res.status_code == 200
                created_ids.remove(agent_id)
    finally:
        if created_ids:
            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test"
            ) as client:
                for agent_id in created_ids:
                    await client.delete(f"/api/v1/agents/{agent_id}")
        await engine.dispose()
