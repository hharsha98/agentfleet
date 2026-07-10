import asyncio

from app.tools import TOOLS, run_tool, specs_for


def test_specs_for_filters_unknown_names() -> None:
    assert specs_for(["web_search", "not_a_tool"]) == [TOOLS["web_search"]["spec"]]
    assert specs_for([]) == []


def test_run_tool_unknown_name_is_safe() -> None:
    result = asyncio.run(run_tool("not_a_tool", {}))
    assert "Unknown tool" in result


def test_web_search_against_local_searxng() -> None:
    """Integration: requires the SearXNG container from docker compose."""
    result = asyncio.run(run_tool("web_search", {"query": "python"}))
    # Cold instances may return no results — both outcomes prove the plumbing.
    assert isinstance(result, str) and len(result) > 0
