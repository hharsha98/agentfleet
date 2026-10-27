"""Concurrency tests for scripts/seed_agents.py.

Why this file exists: apps/api/docker-entrypoint.sh runs
`python -m scripts.seed_agents` on EVERY API container start, and
k8s/overlays/prod/kustomization.yaml runs the api Deployment at 2 replicas.
During a rolling update both replicas can boot close enough together that
their seeds overlap. Observed on a live kind cluster (Wave 3C): both pods
ran the seed, and one died with a duplicate-key IntegrityError on the
`ix_agents_slug` unique index — a crash-looping pod on every prod rollout,
self-healing only because the container restarted into an already-seeded
table.

The seed was idempotent across SEQUENTIAL runs but not safe under
concurrency, because it did a read-then-write per agent (SELECT the slug,
then INSERT if absent) and only committed at the very end: two sessions
both read "absent", both INSERT, and the second commit hits the unique
index.

These tests run two seeders against the SAME database at the same time,
each on its own session and therefore its own asyncpg connection, so the
two transactions are genuinely concurrent inside Postgres — not two
sequential runs dressed up as one test. They are in-process
`asyncio.gather` rather than two subprocesses on purpose: subprocess
start-up jitter makes the overlap window a coin flip, whereas gather
guarantees both transactions are open and have read before either commits,
which is exactly the interleaving that broke on the cluster.

Both directions of the prod rollout are covered: an EMPTY table (first
deploy / after a wipe — the insert-vs-insert race that actually crashed),
and an ALREADY-SEEDED table (every subsequent rollout — concurrent updates
of the same rows, which must neither raise nor deadlock).

Same single-event-loop / engine.dispose() discipline as
test_seed_demo_user.py: this suite's asyncpg connections are bound to
whichever event loop created them.
"""

import asyncio

from sqlalchemy import delete, func, select

from app.db import SessionLocal, engine
from app.models import Agent
from scripts.seed_agents import BUILTIN, SAFETY_PREAMBLE, main

# Matches k8s/overlays/prod/kustomization.yaml's api replica count — the
# number of seeders that can actually collide during a rollout.
CONCURRENT_SEEDERS = 2


async def _clear_agents() -> None:
    """Empty the agents table.

    tests/conftest.py's autouse fixture reseeds the full built-in roster
    before every test, so without this the "empty table" test would only
    ever exercise the update path and would pass even against the racy
    read-then-write version.
    """
    async with SessionLocal() as session:
        await session.execute(delete(Agent))
        await session.commit()


async def _assert_roster_is_intact() -> None:
    """Exactly one well-formed row per built-in slug — no duplicates, no
    rows lost to a swallowed error, and no safety preamble applied twice
    (a plausible way an upsert could go wrong that a bare row count would
    not catch)."""
    async with SessionLocal() as session:
        total = (await session.execute(select(func.count()).select_from(Agent))).scalar_one()
        rows = (await session.execute(select(Agent))).scalars().all()

    assert total == len(BUILTIN), f"expected {len(BUILTIN)} agents, found {total}"

    slugs = [row.slug for row in rows]
    assert sorted(slugs) == sorted(spec["slug"] for spec in BUILTIN)
    assert len(set(slugs)) == len(slugs), f"duplicate slugs seeded: {slugs}"

    by_slug = {row.slug: row for row in rows}
    for spec in BUILTIN:
        row = by_slug[spec["slug"]]
        assert row.is_builtin is True
        assert row.name == spec["name"]
        assert row.runtime == spec.get("runtime", "langgraph")
        assert row.tools == spec.get("tools", [])
        assert row.system_prompt.count(SAFETY_PREAMBLE) == 1
        assert row.system_prompt == SAFETY_PREAMBLE + spec["system_prompt"]
        assert row.model, "model must be populated on insert"


async def _seed_concurrently() -> None:
    """Run CONCURRENT_SEEDERS copies of the seed at once and fail loudly if
    any of them raised. return_exceptions=True so that ONE failure is
    reported as a readable assertion instead of gather re-raising the first
    exception and hiding whether the others also failed."""
    results = await asyncio.gather(
        *(main() for _ in range(CONCURRENT_SEEDERS)), return_exceptions=True
    )
    failures = [r for r in results if isinstance(r, BaseException)]
    assert not failures, (
        f"{len(failures)}/{CONCURRENT_SEEDERS} concurrent seeders raised: "
        + "; ".join(f"{type(f).__name__}: {f}" for f in failures)
    )


async def test_concurrent_seed_into_empty_table_does_not_raise() -> None:
    """The exact failure seen on the cluster: two replicas seeding a table
    that has no rows yet. Against the read-then-write version this fails
    with asyncpg UniqueViolationError / SQLAlchemy IntegrityError on
    ix_agents_slug."""
    await engine.dispose()
    await _clear_agents()

    await _seed_concurrently()
    await _assert_roster_is_intact()

    await engine.dispose()


async def test_concurrent_seed_over_existing_rows_does_not_raise() -> None:
    """Every rollout after the first: the rows already exist, so both
    seeders take the update path against the same rows at the same time.
    Must converge without raising and without deadlocking — both seeders
    touch the rows in the same (BUILTIN) order, so Postgres serialises
    them on the row locks rather than detecting a deadlock."""
    await engine.dispose()
    # conftest's autouse fixture already left a full roster in place; seed
    # once more first so this test states its own precondition rather than
    # depending on that fixture's internals.
    await main()

    await _seed_concurrently()
    await _assert_roster_is_intact()

    await engine.dispose()


async def test_seed_preserves_operator_edits_to_unmanaged_fields() -> None:
    """The seed's existing contract (module docstring: "existing slugs get
    their prompt/description refreshed, custom fields kept") must survive
    the concurrency fix: a re-seed refreshes the roster-owned fields but
    must not clobber fields an operator can change at runtime — `model`,
    `temperature`, `mcp_servers`.
    """
    await engine.dispose()
    slug = BUILTIN[0]["slug"]

    async with SessionLocal() as session:
        agent = (await session.execute(select(Agent).where(Agent.slug == slug))).scalar_one()
        agent.model = "operator-picked-model"
        agent.temperature = 0.123
        agent.mcp_servers = [{"name": "ops", "url": "https://mcp.example.test"}]
        agent.name = "Renamed by drift"
        await session.commit()

    await _seed_concurrently()

    async with SessionLocal() as session:
        agent = (await session.execute(select(Agent).where(Agent.slug == slug))).scalar_one()
    # Operator-owned fields survive...
    assert agent.model == "operator-picked-model"
    assert agent.temperature == 0.123
    assert agent.mcp_servers == [{"name": "ops", "url": "https://mcp.example.test"}]
    # ...roster-owned fields are refreshed back to the declared values.
    assert agent.name == BUILTIN[0]["name"]
    assert agent.system_prompt == SAFETY_PREAMBLE + BUILTIN[0]["system_prompt"]

    await engine.dispose()
