"""Tests for the Prompt Playground (Phase 10 L): the stateless /run + /models
endpoints and the /experiments CRUD.

Same single-event-loop httpx.AsyncClient + ASGITransport pattern as
test_webhooks.py / test_budgets.py (see those files' docstrings for why —
asyncpg connections are bound to the event loop that created them).

Both /run paths (happy + provider-error) use a monkeypatched client — CI has
no LLM proxy, so a live call would make the suite fail anywhere the proxy
isn't running. Live behavior is verified manually in the browser instead.
"""

import uuid
from types import SimpleNamespace

import httpx
import openai
from httpx import ASGITransport, AsyncClient

from app.db import SessionLocal, engine
from app.main import app
from app.models import PlaygroundExperiment


async def test_playground_models_never_throws() -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.get("/api/v1/playground/models")
        assert res.status_code == 200, res.text
        body = res.json()
        assert isinstance(body["models"], list)
        assert all(isinstance(m, str) for m in body["models"])


async def test_playground_run_happy_path(monkeypatch) -> None:
    """Happy path with a canned completion shaped like the OpenAI SDK's
    (choices[0].message.content + usage.prompt/completion_tokens) — exactly
    the fields the route reads."""
    # Phase 12 B: current_user now touches the DB (users lookup/create) on
    # every route, including this one — same cross-event-loop dispose this
    # file's other DB-touching tests already need (see module docstring).
    await engine.dispose()

    fake_completion = SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content="OK"))],
        usage=SimpleNamespace(prompt_tokens=12, completion_tokens=3),
    )

    class _FakeCompletions:
        async def create(self, **kwargs):
            return fake_completion

    class _FakeChat:
        completions = _FakeCompletions()

    class _FakeClient:
        chat = _FakeChat()

    monkeypatch.setattr("app.routes.playground.get_llm_client", lambda: _FakeClient())

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.post(
            "/api/v1/playground/run",
            json={
                "system_prompt": "Reply with exactly one word.",
                "user_message": "Say OK.",
                "model": "openai/gpt-oss-120b",
                "temperature": 0.2,
            },
        )
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["output"] == "OK"
        usage = body["usage"]
        assert usage["tokens_in"] == 12
        assert usage["tokens_out"] == 3
        assert usage["cost_usd"] >= 0
        assert usage["latency_ms"] >= 0


async def test_playground_run_provider_error_returns_502(monkeypatch) -> None:
    # Phase 12 B: see test_playground_run_happy_path — current_user's DB
    # lookup needs a fresh pool bound to this test's event loop.
    await engine.dispose()

    class _FakeCompletions:
        async def create(self, **kwargs):
            raise openai.APIConnectionError(
                message="boom", request=httpx.Request("POST", "http://localhost:3001/v1")
            )

    class _FakeChat:
        completions = _FakeCompletions()

    class _FakeClient:
        chat = _FakeChat()

    monkeypatch.setattr("app.routes.playground.get_llm_client", lambda: _FakeClient())

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.post(
            "/api/v1/playground/run",
            json={
                "user_message": "hello",
                "model": "some/broken-model",
            },
        )
        assert res.status_code == 502, res.text
        assert "detail" in res.json()


async def test_playground_experiments_crud() -> None:
    await engine.dispose()
    created_ids: list[str] = []

    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            variant_a = {
                "model": "model-a",
                "temperature": 0.2,
                "output": "Output A",
                "usage": {"tokens_in": 10, "tokens_out": 5, "cost_usd": 0.0, "latency_ms": 100},
            }
            variant_b = {
                "model": "model-b",
                "temperature": 0.9,
                "output": "Output B",
                "usage": {"tokens_in": 12, "tokens_out": 8, "cost_usd": 0.0, "latency_ms": 150},
            }

            create_res = await client.post(
                "/api/v1/playground/experiments",
                json={
                    "title": "test-experiment",
                    "system_prompt": "You are terse.",
                    "user_message": "Say hi",
                    "variant_a": variant_a,
                    "variant_b": variant_b,
                },
            )
            assert create_res.status_code == 201, create_res.text
            experiment = create_res.json()
            created_ids.append(experiment["id"])
            assert experiment["title"] == "test-experiment"
            assert experiment["variant_a"]["model"] == "model-a"
            assert experiment["variant_b"]["model"] == "model-b"

            # --- list: lightweight summary only ---
            list_res = await client.get("/api/v1/playground/experiments")
            assert list_res.status_code == 200
            listed = list_res.json()
            entry = next(e for e in listed if e["id"] == experiment["id"])
            assert entry["title"] == "test-experiment"
            assert entry["models"] == ["model-a", "model-b"]
            assert "variant_a" not in entry
            assert "user_message" not in entry

            # --- get: full row ---
            get_res = await client.get(f"/api/v1/playground/experiments/{experiment['id']}")
            assert get_res.status_code == 200
            full = get_res.json()
            assert full["user_message"] == "Say hi"
            assert full["variant_a"]["output"] == "Output A"

            # --- get: missing id -> 404 ---
            missing_res = await client.get(f"/api/v1/playground/experiments/{uuid.uuid4()}")
            assert missing_res.status_code == 404
    finally:
        async with SessionLocal() as session:
            for eid in created_ids:
                row = await session.get(PlaygroundExperiment, uuid.UUID(eid))
                if row:
                    await session.delete(row)
            await session.commit()
        await engine.dispose()
