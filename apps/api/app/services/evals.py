"""Eval Center: run an agent's golden test cases and score the replies.

Two layers of checking per case:
  1. Deterministic substring checks (expected_contains / forbidden_contains).
  2. Optional LLM-as-judge against a free-text rubric, when judge_rubric is set.

A case passes iff both deterministic checks pass AND (the judge passed OR no
rubric was given). Cases run sequentially — the free-tier provider this repo
targets has tight per-minute rate limits (see providers.py), and evals are
already a slow, occasional operation (CI gate / manual button), not a hot
path worth parallelizing at that cost.
"""

import json
import logging
import uuid

from sqlalchemy import select

from app.config import get_settings
from app.db import SessionLocal
from app.models import Agent, Conversation, EvalCase, EvalRun
from app.providers import get_llm_client
from app.services.chat import stream_chat

logger = logging.getLogger(__name__)

JUDGE_PROMPT = """You are grading an AI agent's reply against a rubric. Be strict but fair.

Rubric: {rubric}

User input: {input}

Agent reply: {reply}

Respond with ONLY a single strict JSON object, no other text:
{{"pass": true or false, "reason": "<one sentence explaining the verdict>"}}"""


async def run_agent_once(agent: Agent, input_text: str) -> str:
    """Run one turn through the chat runtime in a throwaway conversation."""
    async with SessionLocal() as session:
        conversation = Conversation(agent_id=agent.id, title=f"eval: {input_text[:50]}")
        session.add(conversation)
        await session.commit()
        conversation_id = conversation.id

    text = ""
    async for frame in stream_chat(conversation_id, input_text):
        event = json.loads(frame[6:])  # strip "data: " SSE framing
        if event["type"] == "token":
            text += event["content"]
    return text


def check_case(
    reply: str, expected_contains: list[str], forbidden_contains: list[str]
) -> tuple[bool, bool]:
    """Deterministic checks: (all expected substrings present, no forbidden present).

    Case-insensitive substring matching on the reply text.
    """
    reply_lower = reply.lower()
    contains_ok = all(s.lower() in reply_lower for s in expected_contains)
    forbidden_ok = not any(s.lower() in reply_lower for s in forbidden_contains)
    return contains_ok, forbidden_ok


async def judge(rubric: str, input_text: str, reply: str, model: str) -> tuple[bool, str]:
    """LLM-as-judge: ask the model to score the reply against a free-text rubric.

    Any parse or provider failure is treated as a fail with a diagnostic
    reason — a broken judge must not silently pass a case.
    """
    client = get_llm_client()
    try:
        response = await client.chat.completions.create(
            model=model,
            messages=[
                {
                    "role": "user",
                    "content": JUDGE_PROMPT.format(rubric=rubric, input=input_text, reply=reply),
                }
            ],
            temperature=0,
        )
        text = response.choices[0].message.content or ""
        start, end = text.find("{"), text.rfind("}")
        if start == -1 or end == -1:
            return False, "judge error: no JSON object in response"
        parsed = json.loads(text[start : end + 1])
        return bool(parsed.get("pass")), str(parsed.get("reason") or "")[:300]
    except Exception as exc:
        logger.warning("judge call failed", exc_info=True)
        return False, f"judge error: {type(exc).__name__}"


async def run_eval(session, agent_id: uuid.UUID) -> EvalRun:
    """Run every case for an agent, score it, persist and return the EvalRun."""
    agent = await session.get(Agent, agent_id)
    if agent is None:
        raise ValueError("agent not found")
    cases = (
        (await session.execute(select(EvalCase).where(EvalCase.agent_id == agent_id)))
        .scalars()
        .all()
    )
    settings = get_settings()
    judge_model = settings.planner_model or settings.default_model

    results: list[dict] = []
    passed_count = 0
    for case in cases:
        reply = await run_agent_once(agent, case.input)
        contains_ok, forbidden_ok = check_case(
            reply, case.expected_contains or [], case.forbidden_contains or []
        )
        judge_ok: bool | None = None
        judge_reason: str | None = None
        if case.judge_rubric:
            judge_ok, judge_reason = await judge(case.judge_rubric, case.input, reply, judge_model)

        case_passed = contains_ok and forbidden_ok and (judge_ok if case.judge_rubric else True)
        if case_passed:
            passed_count += 1

        results.append(
            {
                "case_id": str(case.id),
                "input": case.input,
                "passed": case_passed,
                "checks": {"contains": contains_ok, "forbidden": forbidden_ok, "judge": judge_ok},
                "judge_reason": judge_reason,
                "reply_preview": reply[:500],
            }
        )

    run = EvalRun(
        agent_id=agent_id,
        total=len(cases),
        passed=passed_count,
        results=results,
    )
    session.add(run)
    await session.commit()
    await session.refresh(run)
    return run
