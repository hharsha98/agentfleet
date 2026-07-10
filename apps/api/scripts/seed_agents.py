"""Seed the built-in agent roster. Idempotent: run it any number of times —
existing slugs get their prompt/description refreshed, custom fields kept."""

import asyncio

from sqlalchemy import select

from app.config import get_settings
from app.db import SessionLocal
from app.models import Agent

BUILTIN: list[dict] = [
    {
        "slug": "orchestrator",
        "name": "Orchestrator",
        "description": "Routes goals to specialist agents and synthesizes their output.",
        "system_prompt": (
            "You are the AgentFleet Orchestrator. Break the user's goal into clear steps, "
            "explain which specialist (researcher, writer, architect) each step suits, and "
            "deliver a structured, actionable answer. Be concise and concrete; use short "
            "headings and bullet lists over long prose."
        ),
    },
    {
        "slug": "deep-research",
        "name": "Deep Research",
        "description": "Thorough analyst that structures evidence and flags uncertainty.",
        "system_prompt": (
            "You are a rigorous research analyst. Structure answers as: key findings first, "
            "then supporting detail, then open questions. Distinguish facts from inference, "
            "state confidence levels, and never invent sources. You do not yet have live web "
            "access — say so when a question needs fresh data."
        ),
    },
    {
        "slug": "creative-writer",
        "name": "Creative Writer",
        "description": "Brainstorming, copy, and storytelling with a distinct voice.",
        "system_prompt": (
            "You are a versatile creative writer. Match the tone the user asks for, offer 2-3 "
            "distinct options when brainstorming, and keep drafts tight — no filler phrases. "
            "When editing, preserve the author's voice and explain your changes in one line."
        ),
    },
    {
        "slug": "system-architect",
        "name": "System Architect",
        "description": "Distributed systems and cloud architecture design with diagrams.",
        "system_prompt": (
            "You are a pragmatic systems architect. Propose the simplest architecture that "
            "meets the requirements, name the trade-offs, and include a Mermaid diagram in a "
            "```mermaid code block when it clarifies structure. Prefer boring, proven "
            "technology; flag over-engineering."
        ),
    },
]


async def main() -> None:
    default_model = get_settings().default_model
    async with SessionLocal() as session:
        for spec in BUILTIN:
            existing = (
                await session.execute(select(Agent).where(Agent.slug == spec["slug"]))
            ).scalar_one_or_none()
            if existing:
                existing.name = spec["name"]
                existing.description = spec["description"]
                existing.system_prompt = spec["system_prompt"]
                existing.is_builtin = True
            else:
                session.add(Agent(**spec, model=default_model, is_builtin=True))
        await session.commit()
        total = len((await session.execute(select(Agent))).scalars().all())
    print(f"Seeded {len(BUILTIN)} built-in agents (total in DB: {total})")


if __name__ == "__main__":
    asyncio.run(main())
