"""Tool registry: python functions exposed to agents via OpenAI tool schemas.

Each entry pairs a spec (the JSON schema the model sees) with an async run()
(what actually executes). Agents opt in per tool via their `tools` column —
least privilege: an agent without "web_search" can never invoke it.
"""

import asyncio
import json

import httpx
from sqlalchemy import select

from app.config import get_settings
from app.db import SessionLocal
from app.models import Chunk, Document


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
