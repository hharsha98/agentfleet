"""Seed (idempotently) the fixed public-demo identity + its budget caps.

WHY THIS EXISTS: apps/web/auth.ts's optional Credentials provider
(DEMO_LOGIN_ENABLED=1) lets a visitor sign in as one fixed identity,
demo@agentfleet.local, so a recruiter can actually press Run without an
OAuth consent wall. The API's `current_user` dependency already creates a
`users` row for any email it has never seen (app/auth.py::
_get_or_create_user) — so strictly speaking nothing here is REQUIRED for
the identity to exist. This script exists for the two things that lazy
creation cannot give us:

  1. A deterministic, known-in-advance id for the demo user (see
     DEMO_USER_ID below), same reasoning as scripts/seed_demo.py's
     DEMO_NS/demo_id() — so this script (and anything else that needs to
     reference the identity later) doesn't have to make an API call first
     to learn what id got assigned.
  2. Tight daily budget caps seeded BEFORE the first real visitor shows
     up. Waiting for `_get_or_create_user` to create the row on first
     login would leave a window — however small — where the identity is
     signed in with no cap at all.

Ownership note (see app/ownership.py's module docstring): `user_id IS
NULL` is treated as legacy/dev data, visible to EVERY user — not "unowned
demo data". Anything the demo identity creates once signed in (documents,
conversations, missions, ...) is owned by its real user_id via the normal
app code paths; nothing here writes a NULL owner.

BUDGET SHAPE — read app/services/budget.py and app/routes/budgets.py
before touching this: the `budgets` table has NO user_id column. A row is
scoped either to one agent (Budget.agent_id) or GLOBAL (agent_id IS NULL);
check_budget() checks the agent-scoped row first, then GLOBAL. There is no
per-user budget concept in this codebase, and adding one (a schema
migration) is out of scope for a demo safety net — the task is to use the
existing shape, not invent a new one. Since the public demo is a
single-tenant deployment where every visitor shares this one identity, the
GLOBAL row is the correct lever: it bounds the COMBINED usage of every
demo visitor across every agent for the day, which in this deployment is
exactly "the demo user's budget." (Trade-off worth naming: if the real
owner also signs in via Google on the same public instance to check on
things, their usage counts against this same global cap. Acceptable for a
demo instance; would need a real per-user budget column for anything
bigger.)

CAPS CHOSEN — see DEMO_DAILY_TOKEN_LIMIT / DEMO_DAILY_USD_LIMIT below:
  - 200,000 tokens/day. A mission (orchestrator decomposition + a handful
    of tasks, each up to graph_runtime's MAX_TOOL_ROUNDS=5 model rounds
    through MAX_HISTORY_MESSAGES=30 of replayed history) runs roughly in
    the 15k-40k token range end to end; ad-hoc chat exploration adds more
    on top. 200k covers a couple of full missions plus real chat headroom
    for one visitor (or a few sharing the identity the same day) without
    leaving so much slack that a stuck self-heal retry loop, or someone
    scripting the public endpoint, runs up an unbounded bill.
  - $2.00/day. cost_usd() (app/costs.py) prices every message at the
    underlying model's PUBLIC LIST price even when routed through the free
    proxy (so the budget cap and cost dashboard have something real to
    exercise) — meaning real spend on the free-proxy default is $0 and the
    token cap is what actually binds day to day. The dollar cap is the
    second line of defense: if this deployment's DEFAULT_MODEL is ever
    pointed at a paid provider instead, $2/day still bounds real spend
    independently of the token count.

Idempotent + safe to run repeatedly: looks the user up by EMAIL (not id —
see DEMO_USER_ID's docstring for why) and the budget up by the GLOBAL
(agent_id IS NULL) row before writing; re-running always converges the
caps to the two constants above rather than skipping if already present,
so tightening/loosening the caps later is just editing this file and
re-running it. No --clear: removing the demo identity or its cap isn't
part of "is this bounded correctly", and the identity is meant to persist
for the life of the demo deployment.

Safe against the test suite: tests/conftest.py repoints DATABASE_URL at
the separate `agentfleet_test` database at import time; nothing in tests/
imports this module at collection time, only tests/test_seed_demo_user.py
calls `_seed()` directly against that same isolated test database.

Usage:
    uv run python -m scripts.seed_demo_user
"""

import asyncio
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import SessionLocal
from app.models import Budget, User

# --- Identity ---------------------------------------------------------

DEMO_EMAIL = "demo@agentfleet.local"
DEMO_NAME = "Demo Visitor"

#: Deterministic id so a fresh seed of an EMPTY database is reproducible
#: (same derivation style as scripts/seed_demo.py's DEMO_NS/demo_id()).
#: Not load-bearing if `_get_or_create_user` already created this email
#: with a random uuid4 id before this script ever ran (e.g. a visitor hit
#: the API before an operator ran this script) — `_seed()` below looks the
#: row up BY EMAIL, so it keeps whatever id already exists rather than
#: fighting the unique-email constraint to force this one.
DEMO_USER_NS = uuid.uuid5(uuid.NAMESPACE_DNS, "demo-user.agentfleet.local")
DEMO_USER_ID = uuid.uuid5(DEMO_USER_NS, DEMO_EMAIL)

# --- Budget caps — see module docstring "CAPS CHOSEN" ------------------

DEMO_DAILY_TOKEN_LIMIT = 200_000
DEMO_DAILY_USD_LIMIT = 2.00


async def _seed(session: AsyncSession) -> dict[str, bool]:
    """Upsert the demo user + its GLOBAL budget row. Returns which of the
    two rows were newly INSERTed this call (both False on a repeat run
    that only refreshed values in place)."""
    created = {"user": False, "budget": False}

    user = (
        await session.execute(select(User).where(User.email == DEMO_EMAIL))
    ).scalar_one_or_none()
    if user is None:
        user = User(id=DEMO_USER_ID, email=DEMO_EMAIL, name=DEMO_NAME)
        session.add(user)
        created["user"] = True
    elif user.name != DEMO_NAME:
        user.name = DEMO_NAME

    # GLOBAL budget row (agent_id IS NULL) — see module docstring "BUDGET
    # SHAPE" for why this, not a per-agent row, is the right lever here.
    budget = (
        await session.execute(select(Budget).where(Budget.agent_id.is_(None)))
    ).scalar_one_or_none()
    if budget is None:
        budget = Budget(
            agent_id=None,
            daily_token_limit=DEMO_DAILY_TOKEN_LIMIT,
            daily_usd_limit=DEMO_DAILY_USD_LIMIT,
        )
        session.add(budget)
        created["budget"] = True
    else:
        budget.daily_token_limit = DEMO_DAILY_TOKEN_LIMIT
        budget.daily_usd_limit = DEMO_DAILY_USD_LIMIT

    await session.commit()
    await session.refresh(user)
    return created


async def main() -> None:
    async with SessionLocal() as session:
        created = await _seed(session)

    if created["user"] or created["budget"]:
        parts = [name for name, was_created in created.items() if was_created]
        print(f"Seeded demo identity — newly created: {', '.join(parts)}")
    else:
        print("Demo identity already present — caps refreshed in place (idempotent).")
    print(f"  user:          {DEMO_EMAIL}")
    print(
        f"  global budget: {DEMO_DAILY_TOKEN_LIMIT:,} tokens/day, "
        f"${DEMO_DAILY_USD_LIMIT:.2f}/day"
    )


if __name__ == "__main__":
    asyncio.run(main())
