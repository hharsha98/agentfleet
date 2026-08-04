"""Daily usage rollups and budget enforcement — the P7b cost dashboard's
data layer. Message rows (see models.py docstring) are the single source of
truth for tokens/cost; RunTask metering is a display copy and is never
counted here to avoid double counting.
"""

import uuid
from datetime import datetime, timezone

from sqlalchemy import func, select

from app.models import Budget, Conversation, Message


def _today_start_utc() -> datetime:
    now = datetime.now(timezone.utc)
    return now.replace(hour=0, minute=0, second=0, microsecond=0)


async def usage_today(session, agent_id: uuid.UUID | None) -> tuple[int, float]:
    """Sum tokens (in+out) and cost for assistant messages created today (UTC).

    When agent_id is given, scoped to that agent's conversations; otherwise
    across all agents.
    """
    query = (
        select(
            func.coalesce(func.sum(Message.tokens_in + Message.tokens_out), 0),
            func.coalesce(func.sum(Message.cost_usd), 0),
        )
        .select_from(Message)
        .join(Conversation, Conversation.id == Message.conversation_id)
        .where(Message.role == "assistant")
        .where(Message.created_at >= _today_start_utc())
    )
    if agent_id is not None:
        query = query.where(Conversation.agent_id == agent_id)

    tokens, cost = (await session.execute(query)).one()
    return int(tokens), float(cost)


# Appended to every violation message returned below. This is the ONLY
# place a budget rejection is worded (services/chat.py, graph_runtime.py,
# pydantic_runtime.py all `yield _sse({"type": "error", "message":
# violation})` verbatim, and orchestrator.py's self-heal loop logs it
# verbatim too) — so extending the copy here, rather than teaching each
# caller to recognize "is this a budget error" and re-word it, is what
# keeps this a single error channel instead of a parallel one. Written to
# read the same way whether the caller is a self-hosted operator who set
# their own cap, or a public-demo visitor: the cap is real, it is not a
# bug, and it goes away on its own at a known time.
_LEGIBLE_NOTE = "This is a real daily limit, not a broken demo — it resets at 00:00 UTC."


async def check_budget(session, agent_id: uuid.UUID) -> str | None:
    """Return a human-readable violation message if today's usage has
    crossed either the agent's own budget or the global budget, else None.
    Checks the agent-scoped row first, then the global (agent_id IS NULL) row.
    """
    agent_budget = (
        await session.execute(select(Budget).where(Budget.agent_id == agent_id))
    ).scalar_one_or_none()
    global_budget = (
        await session.execute(select(Budget).where(Budget.agent_id.is_(None)))
    ).scalar_one_or_none()

    for budget, scope_agent_id in ((agent_budget, agent_id), (global_budget, None)):
        if budget is None:
            continue
        if budget.daily_token_limit is None and budget.daily_usd_limit is None:
            continue
        tokens, cost = await usage_today(session, scope_agent_id)
        if budget.daily_token_limit is not None and tokens >= budget.daily_token_limit:
            return (
                f"Daily token budget exceeded ({tokens:,}/{budget.daily_token_limit:,}). "
                f"{_LEGIBLE_NOTE}"
            )
        if budget.daily_usd_limit is not None and cost >= float(budget.daily_usd_limit):
            return (
                f"Daily cost budget exceeded (${cost:,.4f}/${float(budget.daily_usd_limit):,.4f}). "
                f"{_LEGIBLE_NOTE}"
            )
    return None
