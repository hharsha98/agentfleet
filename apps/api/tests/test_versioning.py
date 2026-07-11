"""Tests for agent config versioning: publish, history, and rollback.

Same single-event-loop httpx.AsyncClient + ASGITransport pattern as
test_agent_builder.py (see that file's docstring for why — asyncpg
connections are bound to the event loop that created them).
"""

from httpx import ASGITransport, AsyncClient

from app.db import engine
from app.main import app
from app.models import Agent
from app.services.versioning import CONFIG_FIELDS, snapshot_config
from scripts.seed_agents import main as seed


def test_snapshot_config_shape() -> None:
    agent = Agent(
        slug="snap-agent",
        name="Snap Agent",
        description="desc",
        system_prompt="prompt",
        model="gpt-4o-mini",
        temperature=0.5,
        tools=["web_search"],
        mcp_servers=[{"name": "x", "url": "https://x"}],
        is_builtin=False,
    )
    snapshot = snapshot_config(agent)
    assert set(snapshot.keys()) == set(CONFIG_FIELDS)
    assert snapshot == {
        "name": "Snap Agent",
        "description": "desc",
        "system_prompt": "prompt",
        "model": "gpt-4o-mini",
        "temperature": 0.5,
        "tools": ["web_search"],
        "mcp_servers": [{"name": "x", "url": "https://x"}],
    }


async def test_publish_rollback_flow() -> None:
    # Dispose first so every connection this test's pool hands out is
    # created fresh on THIS test's event loop — same reasoning as
    # test_agent_builder.py's module docstring.
    await engine.dispose()
    await seed()
    created_ids: list[str] = []

    try:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            # --- create -> exactly one version, v1 "Initial version" ---
            create_res = await client.post(
                "/api/v1/agents",
                json={
                    "slug": "test-versioning-agent",
                    "name": "Test Versioning Agent",
                    "description": "Created by test_versioning.py",
                    "system_prompt": "You are a test agent.",
                    "temperature": 0.7,
                    "tools": [],
                },
            )
            assert create_res.status_code == 201, create_res.text
            agent = create_res.json()
            created_ids.append(agent["id"])
            agent_id = agent["id"]

            versions_res = await client.get(f"/api/v1/agents/{agent_id}/versions")
            assert versions_res.status_code == 200
            versions = versions_res.json()
            assert len(versions) == 1
            assert versions[0]["version"] == 1
            assert versions[0]["note"] == "Initial version"
            v1_id = versions[0]["id"]

            v1_detail_res = await client.get(f"/api/v1/agents/{agent_id}/versions/{v1_id}")
            assert v1_detail_res.status_code == 200
            v1_temperature = v1_detail_res.json()["config"]["temperature"]
            assert v1_temperature == 0.7

            # --- PATCH temperature -> does NOT create a new version ---
            patch_res = await client.patch(
                f"/api/v1/agents/{agent_id}", json={"temperature": 0.1}
            )
            assert patch_res.status_code == 200, patch_res.text
            assert patch_res.json()["temperature"] == 0.1

            still_one_res = await client.get(f"/api/v1/agents/{agent_id}/versions")
            assert len(still_one_res.json()) == 1

            # --- publish -> v2 "tuned" ---
            publish_res = await client.post(
                f"/api/v1/agents/{agent_id}/publish", json={"note": "tuned"}
            )
            assert publish_res.status_code == 201, publish_res.text
            v2 = publish_res.json()
            assert v2["version"] == 2
            assert v2["note"] == "tuned"

            # 404 publishing against a nonexistent agent.
            missing_publish_res = await client.post(
                "/api/v1/agents/00000000-0000-0000-0000-000000000000/publish",
                json={"note": "nope"},
            )
            assert missing_publish_res.status_code == 404

            # --- versions list: 2, newest-first ---
            versions_res2 = await client.get(f"/api/v1/agents/{agent_id}/versions")
            assert versions_res2.status_code == 200
            versions2 = versions_res2.json()
            assert len(versions2) == 2
            assert [v["version"] for v in versions2] == [2, 1]

            # --- edit temperature again, then roll back to v1 ---
            patch2_res = await client.patch(
                f"/api/v1/agents/{agent_id}", json={"temperature": 1.9}
            )
            assert patch2_res.status_code == 200, patch2_res.text
            assert patch2_res.json()["temperature"] == 1.9

            rollback_res = await client.post(
                f"/api/v1/agents/{agent_id}/versions/{v1_id}/rollback"
            )
            assert rollback_res.status_code == 200, rollback_res.text
            rolled_back_agent = rollback_res.json()
            assert rolled_back_agent["temperature"] == v1_temperature

            # rollback creates a new v3 noting the rollback; history is
            # append-only (v1 and v2 still present).
            versions_res3 = await client.get(f"/api/v1/agents/{agent_id}/versions")
            assert versions_res3.status_code == 200
            versions3 = versions_res3.json()
            assert len(versions3) == 3
            assert versions3[0]["version"] == 3
            assert versions3[0]["note"] == "Rolled back to v1"

            # 404 rolling back to a version belonging to another agent.
            other_res = await client.post(
                "/api/v1/agents",
                json={
                    "slug": "test-versioning-other-agent",
                    "name": "Other Agent",
                    "system_prompt": "You are another test agent.",
                },
            )
            assert other_res.status_code == 201, other_res.text
            other_agent = other_res.json()
            created_ids.append(other_agent["id"])
            cross_agent_res = await client.post(
                f"/api/v1/agents/{other_agent['id']}/versions/{v1_id}/rollback"
            )
            assert cross_agent_res.status_code == 404

            # Cleanup (delete agent -> cascades to agent_versions).
            for agent_id_to_delete in list(created_ids):
                del_res = await client.delete(f"/api/v1/agents/{agent_id_to_delete}")
                assert del_res.status_code == 200
                created_ids.remove(agent_id_to_delete)
    finally:
        if created_ids:
            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test"
            ) as client:
                for agent_id_to_delete in created_ids:
                    await client.delete(f"/api/v1/agents/{agent_id_to_delete}")
        await engine.dispose()
