"""Unit tests for the MCP toolbox pure helpers (no network) plus an
integration check of the mcp_servers validation added to the agent builder
CRUD endpoints. Same single-event-loop httpx.AsyncClient + ASGITransport
pattern as test_agent_builder.py for the validation part.
"""

from httpx import ASGITransport, AsyncClient

from app.db import engine
from app.main import app
from app.services.mcp_client import split_tool_name, to_openai_spec
from scripts.seed_agents import main as seed


def test_to_openai_spec_shape() -> None:
    spec = to_openai_spec(
        "search",
        "lookup",
        "Look things up",
        {"type": "object", "properties": {"q": {"type": "string"}}},
    )
    assert spec == {
        "type": "function",
        "function": {
            "name": "mcp_search_lookup",
            "description": "Look things up",
            "parameters": {"type": "object", "properties": {"q": {"type": "string"}}},
        },
    }


def test_to_openai_spec_empty_schema_fallback() -> None:
    spec = to_openai_spec("search", "lookup", "", None)
    assert spec["function"]["name"] == "mcp_search_lookup"
    assert spec["function"]["description"] == ""
    assert spec["function"]["parameters"] == {"type": "object", "properties": {}}


def test_split_tool_name_overlapping_server_names() -> None:
    # "a" and "a-b" both prefix-match "mcp_a-b_tool" textually, but only
    # "a-b" produces a valid "mcp_{server}_" prefix (the "-" after "a"
    # doesn't match the literal "_" the naming scheme requires).
    assert split_tool_name("mcp_a-b_tool", ["a", "a-b"]) == ("a-b", "tool")


def test_split_tool_name_longest_prefix_wins() -> None:
    # Both "a" and "a_b" produce valid "mcp_{server}_" prefixes here —
    # the longest (most specific) server name must win.
    assert split_tool_name("mcp_a_b_tool", ["a", "a_b"]) == ("a_b", "tool")


def test_split_tool_name_no_match() -> None:
    assert split_tool_name("mcp_unknown_tool", ["a", "a-b"]) is None


async def test_agent_mcp_servers_validation() -> None:
    await engine.dispose()
    await seed()
    created_ids: list[str] = []

    try:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            # --- bad url -> 422 ---
            bad_res = await client.post(
                "/api/v1/agents",
                json={
                    "slug": "test-mcp-bad-agent",
                    "name": "Test MCP Bad Agent",
                    "system_prompt": "You are a test agent.",
                    "mcp_servers": [{"name": "search", "url": "not-a-url"}],
                },
            )
            assert bad_res.status_code == 422

            # --- valid entry -> 201 ---
            ok_res = await client.post(
                "/api/v1/agents",
                json={
                    "slug": "test-mcp-ok-agent",
                    "name": "Test MCP OK Agent",
                    "system_prompt": "You are a test agent.",
                    "mcp_servers": [{"name": "search", "url": "https://example.com/mcp"}],
                },
            )
            assert ok_res.status_code == 201, ok_res.text
            agent = ok_res.json()
            created_ids.append(agent["id"])
            assert agent["mcp_servers"] == [{"name": "search", "url": "https://example.com/mcp"}]

            # cleanup
            del_res = await client.delete(f"/api/v1/agents/{agent['id']}")
            assert del_res.status_code == 200
            created_ids.remove(agent["id"])
    finally:
        if created_ids:
            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test"
            ) as client:
                for agent_id in created_ids:
                    await client.delete(f"/api/v1/agents/{agent_id}")
        await engine.dispose()
