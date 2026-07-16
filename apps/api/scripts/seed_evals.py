"""Seed golden eval cases for the built-in agents. Idempotent: run any
number of times — an agent that already has eval cases is left untouched,
so re-running never duplicates rows.

Cases are deterministic (substring checks only, no judge_rubric) so the CI
eval gate doesn't depend on live LLM judgment variance or live web access.

Usage: uv run python -m scripts.seed_evals
"""

import asyncio

from sqlalchemy import select

from app.db import SessionLocal
from app.models import Agent, EvalCase

EVAL_CASES: dict[str, list[dict]] = {
    "orchestrator": [
        {
            "input": "Plan a 3-step approach to launch a podcast.",
            "expected_contains": ["1", "2", "3"],
            "forbidden_contains": [],
            "judge_rubric": "",
        },
        {
            "input": "Break the steps to plan a birthday party into a numbered list.",
            "expected_contains": ["1", "2", "3"],
            "forbidden_contains": [],
            "judge_rubric": "",
        },
    ],
    "creative-writer": [
        {
            "input": "Write a two-line rhyming couplet about the sea. Include the word 'wave'.",
            "expected_contains": ["wave"],
            "forbidden_contains": ["lorem ipsum"],
            "judge_rubric": "",
        },
        {
            "input": (
                "Write a one-line birthday greeting for a friend named Sam. "
                "Include the word 'Sam'."
            ),
            "expected_contains": ["sam"],
            "forbidden_contains": ["lorem ipsum"],
            "judge_rubric": "",
        },
    ],
    "system-architect": [
        {
            "input": "Give a Mermaid diagram for a simple web app: browser, API, database.",
            "expected_contains": ["mermaid"],
            "forbidden_contains": [],
            "judge_rubric": "",
        },
        {
            "input": (
                "Give a Mermaid diagram for a simple three-tier system: "
                "client, server, cache."
            ),
            "expected_contains": ["mermaid"],
            "forbidden_contains": [],
            "judge_rubric": "",
        },
    ],
    "deep-research": [
        {
            "input": "In one sentence, what is Python? You may answer from general knowledge.",
            "expected_contains": ["Python"],
            "forbidden_contains": [],
            "judge_rubric": "",
        },
        {
            "input": "In one sentence, what is HTTP? You may answer from general knowledge.",
            "expected_contains": ["HTTP"],
            "forbidden_contains": [],
            "judge_rubric": "",
        },
    ],
    "sql-analytics": [
        {
            "input": (
                "Exactly how many rows are in the analytics_sales table? "
                "Give the exact number."
            ),
            "expected_contains": ["60"],
            "forbidden_contains": [],
            "judge_rubric": "",
        },
        {
            "input": "How many distinct regions appear in analytics_sales? Give the exact number.",
            "expected_contains": ["4"],
            "forbidden_contains": [],
            "judge_rubric": "",
        },
    ],
    "meeting-notes": [
        {
            "input": (
                "Call with Jane Doe from Acme Corp. Next step: send pricing by Friday."
            ),
            "expected_contains": ["Acme"],
            "forbidden_contains": [],
            "judge_rubric": "",
        },
    ],
    "outreach": [
        {
            "input": "Draft outreach to a prospect at Acme Corp who just raised a Series A.",
            "expected_contains": ["Acme"],
            "forbidden_contains": [],
            "judge_rubric": "",
        },
    ],
    "competitor-monitor": [
        {
            "input": "What would you monitor for a competitor called Acme?",
            "expected_contains": ["Acme"],
            "forbidden_contains": [],
            "judge_rubric": "",
        },
    ],
    "fact-checker": [
        {
            "input": "Is the Eiffel Tower located in Berlin? Answer TRUE, FALSE, or UNVERIFIABLE.",
            "expected_contains": ["FALSE"],
            "forbidden_contains": [],
            "judge_rubric": "",
        },
    ],
}


async def main() -> None:
    inserted = 0
    skipped = 0
    async with SessionLocal() as session:
        for slug, cases in EVAL_CASES.items():
            agent = (
                await session.execute(select(Agent).where(Agent.slug == slug))
            ).scalar_one_or_none()
            if agent is None:
                print(f"skip {slug}: agent not seeded yet (run scripts.seed_agents first)")
                continue

            existing = (
                (await session.execute(select(EvalCase).where(EvalCase.agent_id == agent.id)))
                .scalars()
                .first()
            )
            if existing is not None:
                skipped += len(cases)
                continue

            for case in cases:
                session.add(EvalCase(agent_id=agent.id, **case))
                inserted += 1
        await session.commit()

    print(f"Seeded eval cases: {inserted} inserted, {skipped} skipped (already present)")


if __name__ == "__main__":
    asyncio.run(main())
