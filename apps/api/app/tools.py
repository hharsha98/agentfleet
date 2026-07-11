"""Tool registry: python functions exposed to agents via OpenAI tool schemas.

Each entry pairs a spec (the JSON schema the model sees) with an async run()
(what actually executes). Agents opt in per tool via their `tools` column —
least privilege: an agent without "web_search" can never invoke it.
"""

import asyncio
import ipaddress
import json
import re
import socket
from urllib.parse import urlparse

import httpx
import trafilatura
from sqlalchemy import select

from app.config import get_settings
from app.db import SessionLocal
from app.models import Chunk, Document

# ── web_search: pluggable provider with SearXNG fallback ────────────────────
#
# Whichever provider runs, the normalized return shape is always a JSON
# string encoding a list of {title, url, snippet} — nothing downstream (the
# prompt, the guardrail scanner, tests) needs to know which provider served
# a given call.

_SEARCH_TIMEOUT = 12.0


async def _search_tavily(query: str, k: int) -> list[dict]:
    settings = get_settings()
    async with httpx.AsyncClient(timeout=_SEARCH_TIMEOUT) as client:
        res = await client.post(
            "https://api.tavily.com/search",
            json={
                "api_key": settings.tavily_api_key,
                "query": query,
                "max_results": k,
                "search_depth": "basic",
            },
        )
        res.raise_for_status()
        results = res.json().get("results", [])[:k]
    return [
        {
            "title": r.get("title"),
            "url": r.get("url"),
            "snippet": (r.get("content") or "")[:300],
        }
        for r in results
    ]


async def _search_exa(query: str, k: int) -> list[dict]:
    settings = get_settings()
    async with httpx.AsyncClient(timeout=_SEARCH_TIMEOUT) as client:
        res = await client.post(
            "https://api.exa.ai/search",
            headers={"x-api-key": settings.exa_api_key},
            json={
                "query": query,
                "numResults": k,
                "contents": {"text": {"maxCharacters": 300}},
            },
        )
        res.raise_for_status()
        results = res.json().get("results", [])[:k]
    return [
        {
            "title": r.get("title"),
            "url": r.get("url"),
            "snippet": (r.get("text") or "")[:300],
        }
        for r in results
    ]


async def _search_searxng(query: str, k: int) -> list[dict]:
    settings = get_settings()
    async with httpx.AsyncClient(timeout=_SEARCH_TIMEOUT) as client:
        res = await client.get(
            f"{settings.searxng_url}/search",
            params={"q": query, "format": "json"},
        )
        res.raise_for_status()
        results = res.json().get("results", [])[:k]
    return [
        {
            "title": r.get("title"),
            "url": r.get("url"),
            "snippet": (r.get("content") or "")[:300],
        }
        for r in results
    ]


# provider name -> (search fn, Settings attr holding its API key)
_PROVIDERS = {
    "tavily": (_search_tavily, "tavily_api_key"),
    "exa": (_search_exa, "exa_api_key"),
}


async def web_search(query: str, max_results: int = 5) -> str:
    """Search the web via the configured provider, degrading gracefully.

    Routing: settings.web_search_provider picks tavily/exa/searxng. If the
    chosen provider has no API key configured, raises, or returns zero
    results, we fall back to SearXNG. If SearXNG also comes up empty, we
    say so in plain text rather than returning an empty JSON array — that
    keeps the "no results" case unambiguous for the model.
    """
    settings = get_settings()
    provider = (settings.web_search_provider or "searxng").strip().lower()

    results: list[dict] = []
    if provider in _PROVIDERS:
        search_fn, key_attr = _PROVIDERS[provider]
        if getattr(settings, key_attr, ""):
            try:
                results = await search_fn(query, max_results)
            except Exception:
                results = []  # one provider failing never crashes the tool

    if not results:
        try:
            results = await _search_searxng(query, max_results)
        except Exception:
            results = []

    if not results:
        return "No results found."
    return json.dumps(results, ensure_ascii=False)


async def search_documents(query: str, max_results: int = 5) -> str:
    # Lazy import: the embedding model only loads when a doc search happens.
    from app.services.ingest import embed_texts

    vector = (await asyncio.to_thread(embed_texts, [query]))[0]
    async with SessionLocal() as session:
        distance = Chunk.embedding.cosine_distance(vector)
        rows = (
            await session.execute(
                select(Chunk.text, Chunk.ordinal, Document.filename, distance.label("dist"))
                .join(Document, Chunk.document_id == Document.id)
                .order_by(distance)
                .limit(max_results)
            )
        ).all()
    if not rows:
        return "No documents have been uploaded yet."
    return json.dumps(
        [
            {
                "document": filename,
                "chunk": ordinal,
                "text": text[:400],
                "relevance": round(1 - dist, 3),
            }
            for text, ordinal, filename, dist in rows
        ],
        ensure_ascii=False,
    )


# ── fetch_url: read a page's clean main text ─────────────────────────────────
#
# This is what makes citations trustworthy: web_search returns snippets,
# fetch_url lets the agent actually read the source before quoting it.

_FETCH_TIMEOUT = 15.0
_FETCH_MAX_BYTES = 2 * 1024 * 1024  # 2MB — guard against huge/streamed bodies
_FETCH_TRUNCATE_CHARS = 6000
_FETCH_USER_AGENT = "Mozilla/5.0 (compatible; AgentFleetBot/1.0; +https://agentfleet.local)"


def _resolves_to_private_ip(host: str) -> bool:
    """True if ANY address `host` resolves to is private/loopback/link-local.

    Covers 127.0.0.0/8, 10/8, 172.16/12, 192.168/16, 169.254/16, ::1,
    fc00::/7, and other IANA special-purpose ranges via ipaddress's
    is_private/is_loopback/is_link_local/is_reserved/is_multicast.
    Raises socket.gaierror if `host` can't be resolved at all — that's a
    fetch failure, not necessarily a block, so callers handle it separately.
    """
    for info in socket.getaddrinfo(host, None):
        ip = ipaddress.ip_address(info[4][0])
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_reserved
            or ip.is_multicast
            or ip.is_unspecified
        ):
            return True
    return False


class _BlockedHost(Exception):
    """Internal signal: a request (initial or redirect hop) targets a private IP."""


async def _reject_private_redirects(request: httpx.Request) -> None:
    """httpx per-request hook: re-check every hop, including redirects.

    A pre-fetch check alone doesn't stop a public URL from 302-redirecting
    to an internal address — this hook re-validates each hop httpx actually
    sends, closing that bypass.
    """
    host = request.url.host
    try:
        blocked = await asyncio.to_thread(_resolves_to_private_ip, host)
    except socket.gaierror:
        return  # unresolvable host -> let the request fail naturally
    if blocked:
        raise _BlockedHost(host)


async def fetch_url(url: str) -> str:
    if not (url.startswith("http://") or url.startswith("https://")):
        return "Invalid URL"

    host = urlparse(url).hostname
    if not host:
        return "Invalid URL"

    try:
        blocked = await asyncio.to_thread(_resolves_to_private_ip, host)
    except socket.gaierror:
        return "Could not read page: could not resolve host"
    if blocked:
        return "Blocked: refusing to fetch internal address"

    try:
        async with httpx.AsyncClient(
            timeout=_FETCH_TIMEOUT,
            follow_redirects=True,
            event_hooks={"request": [_reject_private_redirects]},
        ) as client:
            async with client.stream(
                "GET", url, headers={"User-Agent": _FETCH_USER_AGENT}
            ) as resp:
                resp.raise_for_status()
                chunks: list[bytes] = []
                size = 0
                async for chunk in resp.aiter_bytes():
                    size += len(chunk)
                    if size > _FETCH_MAX_BYTES:
                        break
                    chunks.append(chunk)
                html = b"".join(chunks).decode(resp.encoding or "utf-8", errors="ignore")
    except _BlockedHost:
        return "Blocked: refusing to fetch internal address"
    except Exception as exc:
        return f"Could not read page: {type(exc).__name__}"

    text = trafilatura.extract(html, include_links=False, favor_recall=True)
    if not text:
        text = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html)).strip()
    if not text:
        return "Could not read page: no extractable text"
    return text[:_FETCH_TRUNCATE_CHARS]


TOOLS: dict[str, dict] = {
    "web_search": {
        "spec": {
            "type": "function",
            "function": {
                "name": "web_search",
                "description": (
                    "Search the live web (Tavily, Exa, or the private SearXNG metasearch "
                    "engine, depending on configuration, with automatic fallback). Returns "
                    "a JSON list of {title, url, snippet}."
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
    "fetch_url": {
        "spec": {
            "type": "function",
            "function": {
                "name": "fetch_url",
                "description": (
                    "Fetch a web page and return its clean main text. Use after web_search "
                    "to read a source before citing it."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "url": {
                            "type": "string",
                            "description": "The http(s) URL to fetch, e.g. a web_search result",
                        },
                    },
                    "required": ["url"],
                },
            },
        },
        "run": fetch_url,
    },
    "search_documents": {
        "spec": {
            "type": "function",
            "function": {
                "name": "search_documents",
                "description": (
                    "Semantic search over the user's uploaded documents (knowledge base). "
                    "Returns a JSON list of {document, chunk, text, relevance}."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string", "description": "What to look for"},
                    },
                    "required": ["query"],
                },
            },
        },
        "run": search_documents,
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
