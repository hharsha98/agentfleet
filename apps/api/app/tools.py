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
import uuid
from datetime import date, datetime
from decimal import Decimal
from urllib.parse import urlparse

import httpx
import trafilatura
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from app.config import get_settings
from app.db import SessionLocal
from app.db import engine as _app_engine
from app.models import Chunk, Document
from app.ownership import visibility_clause_for_id

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


async def search_documents(
    query: str, max_results: int = 5, user_id: uuid.UUID | None = None
) -> str:
    """Semantic search over uploaded document chunks.

    `user_id` is the calling conversation's owner, threaded through from
    run_tool (see its three call sites: services/graph_runtime.py,
    services/chat.py, services/pydantic_runtime.py — all three load
    `conversation` and pass `conversation.user_id`). Without this filter,
    ANY agent's search_documents call could retrieve ANY user's uploaded
    document chunks — the cross-tenant leak this parameter fixes.

    Applies the exact same visibility rule every other resource-listing
    route uses (see app/ownership.py): a Document is visible if it's owned
    by `user_id` OR has no owner at all (user_id IS NULL — legacy/global
    data, preserved exactly as ownership.py already treats it elsewhere,
    not tightened here).

    `user_id=None` (no caller identity — a scheduled run, a webhook-
    triggered run, or the public API-key invoke path used by mcp/server.py,
    none of which have a logged-in user attached to their conversation)
    resolves to "only unowned documents are visible" via that same clause
    (see visibility_clause_for_id's docstring) — never another user's
    private uploads, and never silently unfiltered.
    """
    # Lazy import: the embedding model only loads when a doc search happens.
    from app.services.ingest import embed_texts

    vector = (await asyncio.to_thread(embed_texts, [query]))[0]
    async with SessionLocal() as session:
        distance = Chunk.embedding.cosine_distance(vector)
        rows = (
            await session.execute(
                select(Chunk.text, Chunk.ordinal, Document.filename, distance.label("dist"))
                .join(Document, Chunk.document_id == Document.id)
                .where(visibility_clause_for_id(Document, user_id))
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


# ── sql_query: read-only, bounded SQL for the SQL Analytics agent ───────────
#
# Defense in depth: (1) validate the query text before it ever reaches the
# database — must start with SELECT/WITH, single statement only, no
# write/DDL keywords; (2) even a validated query only ever runs inside a
# Postgres READ ONLY transaction with a 5s statement timeout, so a bug in
# the validator still can't mutate data or hang the connection; (3) results
# are capped at 50 rows and connection details never leak into the tool's
# output, including on error.

_SQL_DENYLIST = re.compile(
    r"\b("
    r"insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|"
    r"merge|into|call|do|vacuum|comment|reindex|refresh"
    r")\b",
    re.IGNORECASE,
)

_analytics_engine: AsyncEngine | None = None


def _get_analytics_engine() -> AsyncEngine:
    """Dedicated engine for ANALYTICS_DATABASE_URL if set, else the app's own."""
    global _analytics_engine
    settings = get_settings()
    if not settings.analytics_database_url:
        return _app_engine
    if _analytics_engine is None:
        _analytics_engine = create_async_engine(settings.analytics_database_url, echo=False)
    return _analytics_engine


def _json_safe(value):
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return value


async def sql_query(query: str) -> str:
    q = query.strip()
    lowered = q.lower()

    if not (lowered.startswith("select") or lowered.startswith("with")):
        return "Refused: only SELECT/WITH (read-only) queries are allowed."

    # A single trailing semicolon is fine; anything past that is a second
    # statement (e.g. "SELECT 1; DELETE FROM ...") and gets refused.
    body = q[:-1] if q.endswith(";") else q
    if ";" in body:
        return "Refused: multiple statements are not allowed."

    if _SQL_DENYLIST.search(q):
        return "Refused: query contains a disallowed keyword."

    engine = _get_analytics_engine()
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SET TRANSACTION READ ONLY"))
            await conn.execute(text("SET LOCAL statement_timeout = '5s'"))
            result = await conn.execute(text(q))
            columns = list(result.keys())
            rows = result.fetchmany(50)
    except Exception as exc:
        # Short, generic reason only — never leak connection details/DSN.
        return f"Query error: {type(exc).__name__}"

    return json.dumps(
        {
            "columns": columns,
            "rows": [[_json_safe(v) for v in row] for row in rows],
            "row_count": len(rows),
            "truncated": len(rows) == 50,
        },
        ensure_ascii=False,
    )


# ── send_slack: post a short digest to the team Slack channel ───────────────
#
# Graceful degradation: with no SLACK_WEBHOOK_URL configured, the tool still
# "succeeds" from the agent's point of view — it returns a clear message
# showing what would have been sent, instead of erroring or crashing the
# turn. That lets agents like Competitor Monitor be built and evaluated
# before the user ever adds a Slack webhook.

_SLACK_TIMEOUT = 10.0


async def send_slack(message: str) -> str:
    settings = get_settings()
    if not settings.slack_webhook_url:
        return (
            "Slack is not configured (set SLACK_WEBHOOK_URL). Message that would "
            f"be sent:\n{message[:500]}"
        )
    try:
        async with httpx.AsyncClient(timeout=_SLACK_TIMEOUT) as client:
            res = await client.post(settings.slack_webhook_url, json={"text": message})
        if res.status_code == 200:
            return "Posted to Slack."
        return f"Slack post failed (status {res.status_code})"
    except Exception as exc:
        return f"Slack error: {type(exc).__name__}"


# ── push_to_crm: upsert a contact into HubSpot ───────────────────────────────
#
# Same graceful-degradation shape as send_slack: no HUBSPOT_ACCESS_TOKEN ->
# return what would have been upserted instead of failing the agent turn.

_CRM_TIMEOUT = 10.0


async def push_to_crm(contact_json: str) -> str:
    try:
        contact = json.loads(contact_json)
    except Exception:
        return "Invalid contact JSON"

    settings = get_settings()
    if not settings.hubspot_access_token:
        pretty = json.dumps(contact, indent=2, ensure_ascii=False)
        return (
            "CRM is not configured (set HUBSPOT_ACCESS_TOKEN). Contact that "
            f"would be upserted:\n{pretty}"
        )

    properties = {}
    if contact.get("email"):
        properties["email"] = contact["email"]
    if contact.get("name"):
        properties["firstname"] = contact["name"]
    if contact.get("company"):
        properties["company"] = contact["company"]
    notes_bits = [str(v) for k, v in (("notes", contact.get("notes")), ("next_steps", contact.get("next_steps"))) if v]
    if notes_bits:
        properties["hs_content_membership_notes"] = "\n".join(notes_bits)

    try:
        async with httpx.AsyncClient(timeout=_CRM_TIMEOUT) as client:
            res = await client.post(
                "https://api.hubapi.com/crm/v3/objects/contacts",
                headers={"Authorization": f"Bearer {settings.hubspot_access_token}"},
                json={"properties": properties},
            )
        if res.status_code in (200, 201):
            contact_id = res.json().get("id", "?")
            return f"Upserted contact to HubSpot (id {contact_id})"
        if res.status_code == 409:
            return "Contact already in CRM"
        return f"CRM post failed (status {res.status_code})"
    except Exception as exc:
        return f"CRM error: {type(exc).__name__}"


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
    "sql_query": {
        "spec": {
            "type": "function",
            "function": {
                "name": "sql_query",
                "description": (
                    "Run a READ-ONLY SQL SELECT against the analytics database and get rows "
                    "back. Tables: analytics_sales(region, product, quantity, unit_price, "
                    "sale_date), analytics_customers(region, plan, signup_date). SELECT/WITH "
                    "only — any write or multi-statement query is refused."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "A single read-only SQL SELECT (or WITH ... SELECT) statement",
                        },
                    },
                    "required": ["query"],
                },
            },
        },
        "run": sql_query,
    },
    "send_slack": {
        "spec": {
            "type": "function",
            "function": {
                "name": "send_slack",
                "description": "Send a short text message/digest to the team Slack channel.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "message": {
                            "type": "string",
                            "description": "The message text to post to Slack",
                        },
                    },
                    "required": ["message"],
                },
            },
        },
        "run": send_slack,
    },
    "push_to_crm": {
        "spec": {
            "type": "function",
            "function": {
                "name": "push_to_crm",
                "description": "Upsert a contact record (name/email/company/notes) into the CRM.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "contact_json": {
                            "type": "string",
                            "description": (
                                "JSON object string with contact fields, e.g. "
                                '{"name": "...", "email": "...", "company": "...", '
                                '"notes": "...", "next_steps": "..."}'
                            ),
                        },
                    },
                    "required": ["contact_json"],
                },
            },
        },
        "run": push_to_crm,
    },
}


def specs_for(names: list) -> list[dict]:
    return [TOOLS[n]["spec"] for n in names if n in TOOLS]


async def run_tool(name: str, arguments: dict, *, user_id: uuid.UUID | None = None) -> str:
    """Dispatch a model-requested tool call.

    `user_id` is the caller's identity (the chat turn's Conversation.user_id
    — see the three call sites in services/graph_runtime.py, services/
    chat.py, services/pydantic_runtime.py), optional with a None default so
    existing callers/tests that never pass it are unaffected. `arguments`
    comes straight from the model, so we never blanket-forward **kwargs
    plus user_id into every tool's run() — a model-supplied argument name
    could collide with it. Only search_documents needs caller identity (for
    its ownership filter; see its docstring), so injection is explicit and
    scoped to that one tool.
    """
    if name not in TOOLS:
        return f"Unknown tool: {name}"
    try:
        if name == "search_documents":
            return await TOOLS[name]["run"](**arguments, user_id=user_id)
        return await TOOLS[name]["run"](**arguments)
    except Exception as exc:  # tool failures go back to the model, not the user
        return f"Tool error: {type(exc).__name__}"
