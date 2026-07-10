"""Integration tests for the template gallery (install-to-agent flow).

Same single-event-loop httpx.AsyncClient + ASGITransport pattern as
test_agent_builder.py / test_publish.py — see test_agent_builder.py's module
docstring for why (asyncpg connections are bound to the event loop that
created them).
"""

from httpx import ASGITransport, AsyncClient

from app.db import engine
from app.main import app
from scripts.seed_agents import main as seed


async def test_templates_gallery_and_install() -> None:
    await engine.dispose()
    await seed()
    created_ids: list[str] = []

    try:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            # --- catalog ---
            list_res = await client.get("/api/v1/templates")
            assert list_res.status_code == 200, list_res.text
            catalog = list_res.json()
            assert len(catalog) == 6
            slugs = {t["slug"] for t in catalog}
            assert slugs == {
                "seo-auditor",
                "meeting-summarizer",
                "bug-triager",
                "cold-email-writer",
                "sql-explainer",
                "competitor-snapshot",
            }
            for t in catalog:
                assert set(t.keys()) == {
                    "slug",
                    "name",
                    "description",
                    "system_prompt",
                    "tools",
                    "category",
                }

            # --- install seo-auditor -> 201 + appears in /api/v1/agents ---
            install_res = await client.post("/api/v1/templates/seo-auditor/install")
            assert install_res.status_code == 201, install_res.text
            installed = install_res.json()
            created_ids.append(installed["id"])
            assert installed["slug"] == "seo-auditor"
            assert installed["is_builtin"] is False
            assert installed["tools"] == ["web_search"]

            agents_res = await client.get("/api/v1/agents")
            assert agents_res.status_code == 200
            assert any(a["slug"] == "seo-auditor" for a in agents_res.json())

            # --- second install -> 409 ---
            dup_res = await client.post("/api/v1/templates/seo-auditor/install")
            assert dup_res.status_code == 409

            # --- unknown template -> 404 ---
            missing_res = await client.post("/api/v1/templates/not-a-real-template/install")
            assert missing_res.status_code == 404

            # --- cleanup ---
            del_res = await client.delete(f"/api/v1/agents/{installed['id']}")
            assert del_res.status_code == 200
            created_ids.remove(installed["id"])
    finally:
        if created_ids:
            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test"
            ) as client:
                for agent_id in created_ids:
                    await client.delete(f"/api/v1/agents/{agent_id}")
        await engine.dispose()
