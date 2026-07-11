import asyncio

from app.tools import TOOLS, run_tool, specs_for


def test_specs_for_filters_unknown_names() -> None:
    assert specs_for(["web_search", "not_a_tool"]) == [TOOLS["web_search"]["spec"]]
    assert specs_for([]) == []


def test_specs_for_includes_fetch_url_and_search_documents() -> None:
    names = ["web_search", "fetch_url", "search_documents", "not_a_tool"]
    specs = specs_for(names)
    assert specs == [
        TOOLS["web_search"]["spec"],
        TOOLS["fetch_url"]["spec"],
        TOOLS["search_documents"]["spec"],
    ]


def test_run_tool_unknown_name_is_safe() -> None:
    result = asyncio.run(run_tool("not_a_tool", {}))
    assert "Unknown tool" in result


def test_web_search_against_local_searxng() -> None:
    """Integration: requires the SearXNG container from docker compose."""
    result = asyncio.run(run_tool("web_search", {"query": "python"}))
    # Cold instances may return no results — both outcomes prove the plumbing.
    assert isinstance(result, str) and len(result) > 0


def test_fetch_url_rejects_non_http_scheme() -> None:
    result = asyncio.run(run_tool("fetch_url", {"url": "not-a-url"}))
    assert result == "Invalid URL"

    result = asyncio.run(run_tool("fetch_url", {"url": "ftp://example.com/file"}))
    assert result == "Invalid URL"


def test_fetch_url_blocks_loopback_address() -> None:
    """SSRF guard: an agent must never be able to reach internal services."""
    result = asyncio.run(run_tool("fetch_url", {"url": "http://127.0.0.1:8000/health"}))
    assert result == "Blocked: refusing to fetch internal address"


def test_fetch_url_blocks_localhost_hostname() -> None:
    result = asyncio.run(run_tool("fetch_url", {"url": "http://localhost/"}))
    assert result == "Blocked: refusing to fetch internal address"
