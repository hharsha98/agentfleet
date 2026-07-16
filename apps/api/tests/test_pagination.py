"""Tests for Phase 11 pagination: limit/offset on list endpoints, plain-array
response shape preserved, X-Total-Count header for out-of-band counts.

Same single-event-loop httpx.AsyncClient + ASGITransport pattern as
test_evals.py / test_publish.py (see those files' docstrings for why —
asyncpg connections are bound to the event loop that created them).

Covers three representative endpoints with different characteristics:
  - GET /agents/{id}/evals/runs  — agent-scoped (exact total), desc order,
    default cap of 10 (smallest default in the API, cheap to exceed by
    inserting rows directly instead of running real evals).
  - GET /agents/{id}/evals/cases — agent-scoped (exact total), ASC order
    (declared ordering kept as-is, just paginated).
  - GET /playground/experiments  — global (not agent-scoped) desc order,
    default cap of 50 (MAX_EXPERIMENTS_LISTED, unchanged from before).

Row insertion for the eval-runs case uses explicit, strictly increasing
created_at timestamps (bypassing the server_default) so ordering is
deterministic even when rows are created faster than DB clock resolution —
critical for the "2nd row" assertion, which would otherwise be flaky on
ties broken only by a random UUID tiebreaker.
"""

import uuid
from datetime import datetime, timedelta, timezone

from httpx import ASGITransport, AsyncClient

from app.db import SessionLocal, engine
from app.main import app
from app.models import EvalRun


async def test_eval_runs_pagination_cap_total_and_offset() -> None:
    await engine.dispose()
    created_agent_ids: list[str] = []

    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            agent_res = await client.post(
                "/api/v1/agents",
                json={
                    "slug": "test-pagination-eval-runs",
                    "name": "Test Pagination Eval Runs",
                    "description": "Created by test_pagination.py",
                    "system_prompt": "You are a test agent.",
                    "tools": [],
                },
            )
            assert agent_res.status_code == 201, agent_res.text
            agent = agent_res.json()
            created_agent_ids.append(agent["id"])
            agent_id = uuid.UUID(agent["id"])

            # 12 rows, explicit strictly-increasing created_at (1s apart) so
            # the desc order + "2nd row" assertion below is unambiguous.
            base = datetime(2025, 1, 1, tzinfo=timezone.utc)
            async with SessionLocal() as session:
                for i in range(12):
                    session.add(
                        EvalRun(
                            agent_id=agent_id,
                            total=1,
                            passed=1,
                            results=[],
                            created_at=base + timedelta(seconds=i),
                        )
                    )
                await session.commit()

            # --- default cap (10) honored: no ?limit given ---
            default_res = await client.get(f"/api/v1/agents/{agent_id}/evals/runs")
            assert default_res.status_code == 200
            default_body = default_res.json()
            assert len(default_body) == 10

            # --- X-Total-Count is exact (agent-scoped, nothing else in this row set) ---
            assert default_res.headers["X-Total-Count"] == "12"

            # --- ?limit=1&offset=1 returns the 2nd row per desc(created_at) ---
            # i=11 is the newest (offset 0), i=10 is 2nd newest (offset 1).
            page_res = await client.get(
                f"/api/v1/agents/{agent_id}/evals/runs", params={"limit": 1, "offset": 1}
            )
            assert page_res.status_code == 200
            page_body = page_res.json()
            assert len(page_body) == 1
            expected_second = (base + timedelta(seconds=10)).isoformat()
            actual_created_at = page_body[0]["created_at"].replace("Z", "+00:00")
            assert actual_created_at.startswith(expected_second[:19])
            assert page_res.headers["X-Total-Count"] == "12"

            # --- limit=0 and limit=999 rejected (422) ---
            zero_res = await client.get(
                f"/api/v1/agents/{agent_id}/evals/runs", params={"limit": 0}
            )
            assert zero_res.status_code == 422
            too_big_res = await client.get(
                f"/api/v1/agents/{agent_id}/evals/runs", params={"limit": 999}
            )
            assert too_big_res.status_code == 422

            # Cleanup.
            del_res = await client.delete(f"/api/v1/agents/{agent_id}")
            assert del_res.status_code == 200
            created_agent_ids.remove(str(agent_id))
    finally:
        if created_agent_ids:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                for aid in created_agent_ids:
                    await client.delete(f"/api/v1/agents/{aid}")
        await engine.dispose()


async def test_eval_cases_pagination_total_and_offset() -> None:
    await engine.dispose()
    created_agent_ids: list[str] = []

    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            agent_res = await client.post(
                "/api/v1/agents",
                json={
                    "slug": "test-pagination-eval-cases",
                    "name": "Test Pagination Eval Cases",
                    "description": "Created by test_pagination.py",
                    "system_prompt": "You are a test agent.",
                    "tools": [],
                },
            )
            assert agent_res.status_code == 201, agent_res.text
            agent = agent_res.json()
            created_agent_ids.append(agent["id"])
            agent_id = agent["id"]

            # Declared ordering here is ascending created_at (kept as-is) —
            # create 3 cases sequentially via the API so insertion order ==
            # creation order == expected ascending order.
            case_ids: list[str] = []
            for i in range(3):
                case_res = await client.post(
                    f"/api/v1/agents/{agent_id}/evals/cases",
                    json={"input": f"case-{i}", "expected_contains": [], "forbidden_contains": []},
                )
                assert case_res.status_code == 201, case_res.text
                case_ids.append(case_res.json()["id"])

            # --- X-Total-Count exact (agent-scoped) ---
            all_res = await client.get(f"/api/v1/agents/{agent_id}/evals/cases")
            assert all_res.status_code == 200
            assert all_res.headers["X-Total-Count"] == "3"
            all_body = all_res.json()
            assert [c["id"] for c in all_body] == case_ids  # ascending, unchanged order

            # --- ?limit=1&offset=1 returns the 2nd row per the declared (ASC) ordering ---
            page_res = await client.get(
                f"/api/v1/agents/{agent_id}/evals/cases", params={"limit": 1, "offset": 1}
            )
            assert page_res.status_code == 200
            page_body = page_res.json()
            assert len(page_body) == 1
            assert page_body[0]["id"] == case_ids[1]
            assert page_res.headers["X-Total-Count"] == "3"

            # --- limit=0 and limit=999 rejected (422) ---
            zero_res = await client.get(
                f"/api/v1/agents/{agent_id}/evals/cases", params={"limit": 0}
            )
            assert zero_res.status_code == 422
            too_big_res = await client.get(
                f"/api/v1/agents/{agent_id}/evals/cases", params={"limit": 999}
            )
            assert too_big_res.status_code == 422

            # Cleanup.
            del_res = await client.delete(f"/api/v1/agents/{agent_id}")
            assert del_res.status_code == 200
            created_agent_ids.remove(agent_id)
    finally:
        if created_agent_ids:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                for aid in created_agent_ids:
                    await client.delete(f"/api/v1/agents/{aid}")
        await engine.dispose()


async def test_playground_experiments_pagination_shape_and_offset() -> None:
    """Global (non-agent-scoped) list — can't assert an exact total (other
    tests/fixtures may have rows), so this checks response-shape invariants
    instead: default cap <= 50, headers present, and that limit=1&offset=1
    matches the 2nd entry of a full (limit=200) fetch of the same declared
    ordering (desc created_at, id tiebreak) — self-consistent regardless of
    how many other rows exist.
    """
    await engine.dispose()
    created_ids: list[str] = []

    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            variant = {
                "model": "model-a",
                "temperature": 0.2,
                "output": "Output",
                "usage": {"tokens_in": 1, "tokens_out": 1, "cost_usd": 0.0, "latency_ms": 1},
            }
            for i in range(3):
                create_res = await client.post(
                    "/api/v1/playground/experiments",
                    json={
                        "title": f"pagination-test-{i}",
                        "system_prompt": "sys",
                        "user_message": "msg",
                        "variant_a": variant,
                        "variant_b": variant,
                    },
                )
                assert create_res.status_code == 201, create_res.text
                created_ids.append(create_res.json()["id"])

            # --- default cap honored: response never exceeds 50 (MAX_EXPERIMENTS_LISTED) ---
            default_res = await client.get("/api/v1/playground/experiments")
            assert default_res.status_code == 200
            assert len(default_res.json()) <= 50
            assert "X-Total-Count" in default_res.headers
            total = int(default_res.headers["X-Total-Count"])
            assert total >= 3

            # --- full fetch (bounded by le=200) establishes the canonical order ---
            full_res = await client.get("/api/v1/playground/experiments", params={"limit": 200})
            assert full_res.status_code == 200
            full_body = full_res.json()
            assert len(full_body) == min(total, 200)

            # --- ?limit=1&offset=1 matches the 2nd entry of that canonical order ---
            page_res = await client.get(
                "/api/v1/playground/experiments", params={"limit": 1, "offset": 1}
            )
            assert page_res.status_code == 200
            page_body = page_res.json()
            assert len(page_body) == 1
            assert page_body[0]["id"] == full_body[1]["id"]
            assert page_res.headers["X-Total-Count"] == str(total)

            # --- limit=0 and limit=999 rejected (422) ---
            zero_res = await client.get(
                "/api/v1/playground/experiments", params={"limit": 0}
            )
            assert zero_res.status_code == 422
            too_big_res = await client.get(
                "/api/v1/playground/experiments", params={"limit": 999}
            )
            assert too_big_res.status_code == 422
    finally:
        async with SessionLocal() as session:
            from app.models import PlaygroundExperiment

            for eid in created_ids:
                row = await session.get(PlaygroundExperiment, uuid.UUID(eid))
                if row:
                    await session.delete(row)
            await session.commit()
        await engine.dispose()
