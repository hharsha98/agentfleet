"""Session-wide test setup (Phase 12 B): every route now requires a valid
Bearer JWT except /health, /api/v1/hooks/{id}, and /api/v1/public/* (see
app/auth.py). Existing tests predate auth and call the API with no token at
all — rather than touch every one of ~20 test files individually, this
conftest does four things:

1. Sets AUTH_SECRET in os.environ BEFORE anything imports app.config.
   app.config.get_settings() is @lru_cache'd, so whichever test module
   happens to import app.main first "locks in" the settings for the whole
   session. pytest always fully imports conftest.py before collecting/
   importing sibling test_*.py files in the same directory, so this line
   runs first regardless of test order or which file imports app.main
   first.

2. Monkeypatches httpx.AsyncClient and fastapi.testclient.TestClient (the
   two client classes every existing test constructs directly — there is
   no shared fixture/factory to hook into) so every new instance defaults
   to Authorization: Bearer <valid test JWT> unless the caller already
   passed its own `headers=` (per-call headers always win over client
   defaults in httpx's merge, so e.g. test_webhooks.py's hooks-trigger
   calls — which pass their own webhook-secret Authorization header —
   are unaffected).

Both patches are plain module-attribute reassignment (not a pytest
fixture), because they must be visible to `from httpx import AsyncClient`
/ `from fastapi.testclient import TestClient` statements inside test
modules that haven't been imported yet when conftest.py runs. This has no
effect on production code — nothing under app/ imports httpx.AsyncClient
or TestClient this way.

3. Sets RATE_LIMIT_DISABLED=1 in os.environ (same "before any app.* import"
   requirement as AUTH_SECRET above — app.ratelimit builds its module-level
   `limiter` singleton with `enabled=not settings.rate_limit_disabled` at
   import time). Every existing test predates rate limiting and reuses the
   same DEFAULT_TEST_EMAIL across dozens of calls to chat send / document
   upload / public invoke within one pytest session — without this, the
   suite would trip real limits (30/min chat, 10/min upload, 60/min
   public) well before finishing. tests/test_ratelimit.py is the only file
   that needs limiting actually ON; it re-enables it per-test via
   `monkeypatch.setattr(app.ratelimit.limiter, "enabled", True)`.

4. Points DATABASE_URL at a dedicated `agentfleet_test` database instead of
   whatever the developer's shell/.env has configured for dev (same
   "before any app.* import" requirement as AUTH_SECRET above — app.db
   builds its engine from get_settings().database_url at import time).
   This conftest also creates that database if it doesn't exist yet, runs
   the real Alembic migration chain against it, and — via the
   `_isolated_test_db` autouse fixture at the bottom of this file —
   truncates every app table and reseeds the built-in agents before each
   test. None of this ever reads or writes the dev `agentfleet` database,
   and the whole suite is safe to run repeatedly / concurrently with the
   dev stack running.
"""

import asyncio
import datetime as _dt
import os

# Must happen before ANY app.* import in this process — see module
# docstring points 1 and 3.
os.environ.setdefault("AUTH_SECRET", "test-secret-for-ci")
os.environ.setdefault("RATE_LIMIT_DISABLED", "1")
# Phase 12 F2: never download the ~130MB fastembed model during tests. Belt
# and braces — the pre-warm runs from the app lifespan, which starlette only
# triggers inside a `with TestClient(app)` / lifespan-aware ASGI run, and no
# existing test does that; this env guard keeps it off even if one ever does.
os.environ.setdefault("EMBEDDINGS_PREWARM", "0")

# --- Point tests at their own database, never the dev one -----------------
# Must happen before ANY app.* import in this process too — see point 4
# above (app.db builds `engine` from get_settings().database_url at import
# time). Overridden unconditionally (not setdefault): the suite must stay
# isolated even if DATABASE_URL is already exported in the shell for dev
# work — that's the whole point of this change.
#
# TEST_DATABASE_URL lets CI point this at an entirely different Postgres
# instance; by default we reuse the dev host/user/password (so a laptop
# with the dev stack already running needs no extra config) and swap only
# the database name.
_DEV_DATABASE_URL = os.environ.get(
    "DATABASE_URL", "postgresql+asyncpg://agentfleet:agentfleet@localhost:5432/agentfleet"
)
_TEST_DB_NAME = os.environ.get("TEST_DB_NAME", "agentfleet_test")
TEST_DATABASE_URL = os.environ.get(
    "TEST_DATABASE_URL", _DEV_DATABASE_URL.rsplit("/", 1)[0] + f"/{_TEST_DB_NAME}"
)
os.environ["DATABASE_URL"] = TEST_DATABASE_URL


def _create_test_database_if_missing(test_db_url: str) -> None:
    """Create the test database if it doesn't exist yet, by connecting to
    Postgres's own `postgres` maintenance database. Uses a raw asyncpg
    connection rather than SQLAlchemy's engine because CREATE DATABASE
    cannot run inside a transaction block, and a bare asyncpg connection
    runs each statement outside an implicit transaction unless one is
    explicitly opened."""
    import asyncpg
    from sqlalchemy.engine import make_url

    url = make_url(test_db_url)
    db_name = url.database

    async def _create() -> None:
        conn = await asyncpg.connect(
            user=url.username,
            password=url.password,
            host=url.host,
            port=url.port or 5432,
            database="postgres",
        )
        try:
            exists = await conn.fetchval(
                "SELECT 1 FROM pg_database WHERE datname = $1", db_name
            )
            if not exists:
                # Identifier, not a bind parameter — CREATE DATABASE can't
                # take $1 for a name. Safe to interpolate: db_name only ever
                # comes from TEST_DATABASE_URL/TEST_DB_NAME above, never
                # from user input.
                await conn.execute(f'CREATE DATABASE "{db_name}"')
        finally:
            await conn.close()

    asyncio.run(_create())


def _run_migrations() -> None:
    """Run the real Alembic chain (not Base.metadata.create_all) against
    DATABASE_URL — already pointed at the test db above — in a subprocess.
    A subprocess gets its own fresh Settings()/event loop, so it can never
    be confused with this process's app.db.engine, and it exercises the
    exact schema (including `CREATE EXTENSION IF NOT EXISTS vector` from
    migration b374b4179d73) that migrations/ deploys everywhere else.
    Idempotent: a no-op (just an alembic_version check) once the test db is
    already at head, so repeated runs stay fast."""
    import subprocess
    import sys
    from pathlib import Path

    api_root = Path(__file__).resolve().parent.parent
    subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=api_root,
        env=os.environ,
        check=True,
    )


_create_test_database_if_missing(TEST_DATABASE_URL)
_run_migrations()

import fastapi.testclient
import httpx
import jwt

TEST_AUTH_SECRET = os.environ["AUTH_SECRET"]
DEFAULT_TEST_EMAIL = "test-user@agentfleet.test"


def mint_token(
    email: str = DEFAULT_TEST_EMAIL,
    *,
    secret: str = TEST_AUTH_SECRET,
    name: str | None = None,
    exp_delta: _dt.timedelta = _dt.timedelta(hours=1),
    algorithm: str = "HS256",
) -> str:
    """Mint a JWT with the claims shape app/auth.py expects:
    {sub, email, [name], iat, exp}. Used both by the default-header
    monkeypatch below and directly by tests/test_auth.py (pass a negative
    exp_delta for an already-expired token, or a different secret for a
    bad-signature token).
    """
    now = _dt.datetime.now(_dt.timezone.utc)
    payload: dict = {
        "sub": email,
        "email": email,
        "iat": int(now.timestamp()),
        "exp": int((now + exp_delta).timestamp()),
    }
    if name is not None:
        payload["name"] = name
    return jwt.encode(payload, secret, algorithm=algorithm)


_DEFAULT_TOKEN = mint_token()
_DEFAULT_AUTH_HEADER = {"Authorization": f"Bearer {_DEFAULT_TOKEN}"}

_OriginalAsyncClient = httpx.AsyncClient
_OriginalTestClient = fastapi.testclient.TestClient

# Public alias for tests/test_auth.py: the real (unpatched) httpx.AsyncClient,
# for the few tests that need to send NO Authorization header at all (or a
# deliberately bad one) — the patched default-header client below always
# adds one, and there's no reliable way to "unset" a client-level default
# header per-request, so those tests construct this instead.
RawAsyncClient = _OriginalAsyncClient


class _AuthDefaultAsyncClient(_OriginalAsyncClient):
    """httpx.AsyncClient that defaults Authorization to a valid test JWT.
    Caller-supplied headers (e.g. client.post(..., headers={...})) win —
    httpx merges client-level default headers under per-request headers,
    and here we also let an explicit `headers=` kwarg on construction
    override our default for the same reason."""

    def __init__(self, *args, **kwargs):
        headers = {**_DEFAULT_AUTH_HEADER, **(kwargs.pop("headers", None) or {})}
        kwargs["headers"] = headers
        super().__init__(*args, **kwargs)


class _AuthDefaultTestClient(_OriginalTestClient):
    def __init__(self, *args, **kwargs):
        headers = {**_DEFAULT_AUTH_HEADER, **(kwargs.pop("headers", None) or {})}
        kwargs["headers"] = headers
        super().__init__(*args, **kwargs)


httpx.AsyncClient = _AuthDefaultAsyncClient
fastapi.testclient.TestClient = _AuthDefaultTestClient

import pytest
from sqlalchemy import text


@pytest.fixture(autouse=True)
async def _isolated_test_db():
    """Truncate every app table and reseed the built-in agents before each
    test (see module docstring point 4). 9 test files depend on that seeded
    roster — tests/test_agents.py, test_agent_builder.py, test_evals.py,
    test_auth.py, test_mcp_client.py, test_templates.py, test_publish.py,
    test_seed_evals.py, test_versioning.py — so every test must start from
    the same known-good state, not just an empty database.

    Disposes app.db.engine both before AND after the truncate/reseed:
    asyncpg connections are bound to the asyncio event loop that opened
    them. pytest-asyncio hands this fixture (and any async test) a
    function-scoped loop, but several tests in this suite are plain sync
    functions that drive the SAME shared engine through their own
    `asyncio.run(...)` call — a different loop each time (see e.g.
    test_sql_tool.py's docstring for the identical reasoning). Disposing
    before our own DB work discards anything left pooled by the previous
    test's loop; disposing again right before `yield` leaves the pool
    empty, so whichever loop the upcoming test happens to use gets an
    entirely fresh connection instead of one bound to this fixture's loop.

    Reseeds with a bulk Core insert built from scripts.seed_agents' own
    BUILTIN list + _harden() (the single source of truth for the roster and
    the safety-preamble text), in the SAME connection/transaction as the
    TRUNCATE, rather than calling scripts.seed_agents.main() itself: main()
    (a) does an existence SELECT per agent before deciding insert-vs-update
    — pure overhead here since TRUNCATE just guaranteed the table is empty —
    and (b) opens a second connection via SessionLocal. Skipping both saves
    18 round-trips on every one of the ~140 tests.
    """
    from app.config import get_settings
    from app.db import engine
    from app.models import Agent, Base
    from scripts.seed_agents import BUILTIN, _harden

    await engine.dispose()
    default_model = get_settings().default_model
    table_names = ", ".join(f'"{name}"' for name in Base.metadata.tables)
    # Build every row with the SAME set of keys (some BUILTIN entries omit
    # "tools"/"runtime" and rely on the model's column default) — a Core
    # executemany insert needs uniform keys across the batch; heterogeneous
    # dicts are the one thing that trips it up, unlike the ORM's per-object
    # Agent(**spec) construction we replaced.
    agent_rows = [
        {
            "slug": spec["slug"],
            "name": spec["name"],
            "description": spec.get("description", ""),
            "system_prompt": spec["system_prompt"],
            "model": default_model,
            "tools": spec.get("tools", []),
            "mcp_servers": spec.get("mcp_servers", []),
            "is_builtin": True,
            "runtime": spec.get("runtime", "langgraph"),
        }
        for spec in _harden(BUILTIN)
    ]
    async with engine.begin() as conn:
        await conn.execute(text(f"TRUNCATE TABLE {table_names} RESTART IDENTITY CASCADE"))
        await conn.execute(Agent.__table__.insert(), agent_rows)
    await engine.dispose()
    yield
