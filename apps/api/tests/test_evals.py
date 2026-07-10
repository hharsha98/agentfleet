"""Tests for the Eval Center: golden-case CRUD plus the pure check_case logic.

Same single-event-loop httpx.AsyncClient + ASGITransport pattern as
test_publish.py (see that file's docstring for why — asyncpg connections are
bound to the event loop that created them). Deliberately does NOT call
POST /run — that hits the real LLM provider.
"""

from httpx import ASGITransport, AsyncClient

from app.db import engine
from app.main import app
from app.services.evals import check_case
from scripts.seed_agents import main as seed


def test_check_case_present_missing_forbidden() -> None:
    reply = "The capital of France is Paris. It is not London."

    # All expected substrings present, no forbidden ones -> both True.
    assert check_case(reply, ["Paris", "capital"], []) == (True, True)

    # Case-insensitive matching.
    assert check_case(reply, ["PARIS"], []) == (True, True)

    # An expected substring that's missing -> contains_ok False.
    assert check_case(reply, ["Berlin"], []) == (False, True)

    # A forbidden substring that's present -> forbidden_ok False.
    assert check_case(reply, [], ["London"]) == (True, False)

    # Both broken at once.
    assert check_case(reply, ["Berlin"], ["London"]) == (False, False)

    # Empty expectations always pass their half.
    assert check_case(reply, [], []) == (True, True)


async def test_eval_case_crud() -> None:
    # Dispose first so every connection this test's pool hands out is
    # created fresh on THIS test's event loop — same reasoning as
    # test_publish.py's module docstring.
    await engine.dispose()
    await seed()
    created_ids: list[str] = []

    try:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            agent_res = await client.post(
                "/api/v1/agents",
                json={
                    "slug": "test-evals-agent",
                    "name": "Test Evals Agent",
                    "description": "Created by test_evals.py",
                    "system_prompt": "You are a test agent.",
                    "tools": [],
                },
            )
            assert agent_res.status_code == 201, agent_res.text
            agent = agent_res.json()
            created_ids.append(agent["id"])
            agent_id = agent["id"]

            # --- create case ---
            create_res = await client.post(
                f"/api/v1/agents/{agent_id}/evals/cases",
                json={
                    "input": "What is 2+2?",
                    "expected_contains": ["4"],
                    "forbidden_contains": ["I don't know"],
                    "judge_rubric": "",
                },
            )
            assert create_res.status_code == 201, create_res.text
            case = create_res.json()
            assert case["input"] == "What is 2+2?"
            assert case["expected_contains"] == ["4"]
            assert case["forbidden_contains"] == ["I don't know"]
            assert case["judge_rubric"] == ""
            case_id = case["id"]

            # 404 when the agent doesn't exist.
            missing_agent_res = await client.post(
                "/api/v1/agents/00000000-0000-0000-0000-000000000000/evals/cases",
                json={"input": "hi"},
            )
            assert missing_agent_res.status_code == 404

            # --- list shows it ---
            list_res = await client.get(f"/api/v1/agents/{agent_id}/evals/cases")
            assert list_res.status_code == 200
            listed = list_res.json()
            assert any(c["id"] == case_id for c in listed)

            # --- delete case ---
            delete_res = await client.delete(f"/api/v1/agents/{agent_id}/evals/cases/{case_id}")
            assert delete_res.status_code == 200
            assert delete_res.json() == {"ok": True}

            # --- gone from list ---
            list_after_res = await client.get(f"/api/v1/agents/{agent_id}/evals/cases")
            assert list_after_res.status_code == 200
            assert all(c["id"] != case_id for c in list_after_res.json())

            # Deleting again -> 404.
            delete_again_res = await client.delete(
                f"/api/v1/agents/{agent_id}/evals/cases/{case_id}"
            )
            assert delete_again_res.status_code == 404

            # Empty run history for a fresh agent.
            runs_res = await client.get(f"/api/v1/agents/{agent_id}/evals/runs")
            assert runs_res.status_code == 200
            assert runs_res.json() == []

            # Cleanup.
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
