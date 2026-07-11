"""Integration tests for inbound webhooks (Automation platform pillar):
management CRUD (app/routes/webhooks.py) + the public trigger endpoint
(app/routes/hooks.py).

Same single-event-loop httpx.AsyncClient + ASGITransport pattern as
test_publish.py / test_scheduler.py (see those files' docstrings for why —
asyncpg connections are bound to the event loop that created them).

Deliberately does NOT assert on run completion/status beyond "a Run row was
created with the right (templated) goal" — dispatch_plan schedules the real
plan_and_execute as a fire-and-forget asyncio task (same as
test_scheduler.py's poll_due_schedules test), which may hit a real LLM
provider in the background; that's out of scope here.
"""

import uuid

from httpx import ASGITransport, AsyncClient

from app.db import SessionLocal, engine
from app.main import app
from app.models import Run, Webhook


async def test_webhook_crud_and_trigger_auth() -> None:
    await engine.dispose()
    created_webhook_ids: list[str] = []
    created_run_ids: list[str] = []

    try:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            # --- create ---
            create_res = await client.post(
                "/api/v1/webhooks",
                json={
                    "name": "test-webhook",
                    "goal_template": "Handle: {payload}",
                },
            )
            assert create_res.status_code == 201, create_res.text
            webhook = create_res.json()
            created_webhook_ids.append(webhook["id"])

            full_secret = webhook["secret"]
            assert full_secret.startswith("whk_")
            assert webhook["trigger_path"] == f"/api/v1/hooks/{webhook['id']}"
            assert webhook["goal_template"] == "Handle: {payload}"
            assert webhook["name"] == "test-webhook"

            # --- list: full secret / hash must NEVER appear ---
            list_res = await client.get("/api/v1/webhooks")
            assert list_res.status_code == 200
            listed = list_res.json()
            assert any(w["id"] == webhook["id"] for w in listed)
            for w in listed:
                assert "secret" not in w
                assert "secret_hash" not in w
                assert full_secret not in str(w)
                assert "secret_prefix" in w
            listed_webhook = next(w for w in listed if w["id"] == webhook["id"])
            assert listed_webhook["secret_prefix"] == full_secret[:12]
            assert listed_webhook["last_triggered_at"] is None

            # --- trigger: nonexistent webhook id -> 404 ---
            missing_res = await client.post(
                "/api/v1/hooks/00000000-0000-0000-0000-000000000000",
                content=b'{"x":1}',
                headers={"Authorization": "Bearer whk_not_real"},
            )
            assert missing_res.status_code == 404

            # --- trigger: wrong secret -> 401, no run created ---
            before_wrong_res = await client.get("/api/v1/runs")
            before_wrong_count = len(before_wrong_res.json())

            wrong_secret_res = await client.post(
                f"/api/v1/hooks/{webhook['id']}",
                content=b'{"x":1}',
                headers={"Authorization": "Bearer whk_definitely_wrong_secret"},
            )
            assert wrong_secret_res.status_code == 401

            after_wrong_res = await client.get("/api/v1/runs")
            assert len(after_wrong_res.json()) == before_wrong_count

            # --- trigger: missing auth header -> 401 ---
            no_auth_res = await client.post(
                f"/api/v1/hooks/{webhook['id']}",
                content=b'{"x":1}',
            )
            assert no_auth_res.status_code == 401

            # --- trigger: correct secret -> 200, run created with
            # templated goal ({payload} substitution) ---
            body = b'{"x":1}'
            trigger_res = await client.post(
                f"/api/v1/hooks/{webhook['id']}",
                content=body,
                headers={"Authorization": f"Bearer {full_secret}"},
            )
            assert trigger_res.status_code == 200, trigger_res.text
            trigger_body = trigger_res.json()
            assert trigger_body["status"] == "queued"
            run_id = trigger_body["run_id"]
            created_run_ids.append(run_id)

            async with SessionLocal() as session:
                run = await session.get(Run, uuid.UUID(run_id))
                assert run is not None
                assert run.goal == 'Handle: {"x":1}'

                webhook_row = await session.get(Webhook, uuid.UUID(webhook["id"]))
                assert webhook_row is not None
                assert webhook_row.last_triggered_at is not None

            # --- delete ---
            delete_res = await client.delete(f"/api/v1/webhooks/{webhook['id']}")
            assert delete_res.status_code == 200
            assert delete_res.json() == {"ok": True}
            created_webhook_ids.remove(webhook["id"])

            delete_again_res = await client.delete(f"/api/v1/webhooks/{webhook['id']}")
            assert delete_again_res.status_code == 404
    finally:
        async with SessionLocal() as session:
            for rid in created_run_ids:
                run = await session.get(Run, uuid.UUID(rid))
                if run:
                    await session.delete(run)
            for wid in created_webhook_ids:
                webhook_row = await session.get(Webhook, uuid.UUID(wid))
                if webhook_row:
                    await session.delete(webhook_row)
            await session.commit()
        await engine.dispose()


async def test_webhook_body_over_64kb_is_rejected() -> None:
    await engine.dispose()
    created_webhook_ids: list[str] = []
    created_run_ids: list[str] = []

    try:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            create_res = await client.post(
                "/api/v1/webhooks",
                json={"name": "test-webhook-size", "goal_template": "Handle: {payload}"},
            )
            assert create_res.status_code == 201, create_res.text
            webhook = create_res.json()
            created_webhook_ids.append(webhook["id"])
            full_secret = webhook["secret"]

            too_big_res = await client.post(
                f"/api/v1/hooks/{webhook['id']}",
                content=b"x" * (64 * 1024 + 1),
                headers={"Authorization": f"Bearer {full_secret}"},
            )
            assert too_big_res.status_code == 413

            list_res = await client.get("/api/v1/runs")
            for r in list_res.json():
                assert r["goal"] != "Handle: {payload}"
    finally:
        async with SessionLocal() as session:
            for rid in created_run_ids:
                run = await session.get(Run, uuid.UUID(rid))
                if run:
                    await session.delete(run)
            for wid in created_webhook_ids:
                webhook_row = await session.get(Webhook, uuid.UUID(wid))
                if webhook_row:
                    await session.delete(webhook_row)
            await session.commit()
        await engine.dispose()
