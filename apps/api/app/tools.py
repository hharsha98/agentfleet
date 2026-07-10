"""Tool registry: python functions exposed to agents via OpenAI tool schemas.

Each entry pairs a spec (the JSON schema the model sees) with an async run()
(what actually executes). Agents opt in per tool via their `tools` column —
least privilege: an agent without "web_search" can never invoke it.
"""

import json

import httpx

from app.config import get_settings


async def web_search(query: str, max_results: int = 5) -> str:
    settings = get_settings()
    async with httpx.AsyncClient(timeout=10) as client:
        res = await client.get(
            f"{settings.searxng_url}/search",
            params={"q": query, "format": "json"},
        )
        res.raise_for_status()
        results = res.json().get("results", [])[:max_results]
    if not results:
        return "No results found."
    return json.dumps(
        [
            {
                "title": r.get("title"),
                "url": r.get("url"),
                "snippet": (r.get("content") or "")[:300],
            }
            for r in results
        ],
        ensure_ascii=False,
    )


TOOLS: dict[str, dict] = {
    "web_search": {
        "spec": {
            "type": "function",
            "function": {
                "name": "web_search",
                "description": (
                    "Search the live web via the private SearXNG metasearch engine. "
                    "Returns a JSON list of {title, url, snippet}."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string", "description": "The search query"},
                    },
                    "required": ["query"],
                },
            },
        },
        "run": web_search,
    },
}


def specs_for(names: list) -> list[dict]:
    return [TOOLS[n]["spec"] for n in names if n in TOOLS]


async def run_tool(name: str, arguments: dict) -> str:
    if name not in TOOLS:
        return f"Unknown tool: {name}"
    try:
        return await TOOLS[name]["run"](**arguments)
    except Exception as exc:  # tool failures go back to the model, not the user
        return f"Tool error: {type(exc).__name__}"
