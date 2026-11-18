"""Process-wide LangGraph checkpointer: durable Postgres by default, with a
graceful in-memory fallback.

Why a singleton at all: graph_runtime.py compiles a fresh StateGraph per
chat turn (the model and MCP toolbox are per-request), but the checkpointer
underneath it must NOT be recreated per turn — opening a fresh connection
pool per HTTP request would exhaust Postgres connections and defeats the
whole point of a durable, shared saver. One pool, reused across every
request and every replica-local process.

Fallback behavior: if Settings.checkpointer == "memory", or if Postgres
pool creation / saver.setup() raises or takes longer than
Settings.checkpointer_setup_timeout_seconds, we log a warning and fall back
to LangGraph's built-in MemorySaver so the app still runs — just without
cross-restart durability. Chat history never depends on this: it lives in
the messages table either way.

WHY SETUP RUNS AT STARTUP, IN ITS OWN TASK (the first-chat deadlock):
AsyncPostgresSaver.setup() runs `CREATE INDEX CONCURRENTLY` on a fresh
database. Postgres makes that statement wait until every transaction that
was already open has finished. It used to run lazily inside the first chat
request — while that same request (and its streaming generator) held an
open transaction. Each side waited on the other, so on a fresh deploy the
first chats hung with an empty reply until the visitor gave up; the
cancellation then aborted setup half-way, and the next visitor hit the
same wall. Now:
  * app.main's lifespan calls start_checkpointer_init() at boot, before any
    request exists, so setup normally completes with nothing to wait on;
  * the work runs in ONE shared task that callers await through
    asyncio.shield, so a visitor disconnecting can no longer cancel setup
    for everyone else;
  * setup has a time limit, after which we fall back instead of hanging.

Import safety: importing this module never opens a DB connection. Pool
creation and saver.setup() only happen once start_checkpointer_init() or
get_checkpointer() is awaited, so `import app.main` and the unit test suite
stay offline-safe.
"""

import asyncio
import logging

from langgraph.checkpoint.memory import MemorySaver

from app.config import get_settings
from app.database_url import prepare_database_url

logger = logging.getLogger(__name__)

_saver = None  # cached singleton: AsyncPostgresSaver or MemorySaver
_pool = None  # the psycopg pool behind a Postgres saver, closed on shutdown
_init_task: asyncio.Task | None = None


def _psycopg_dsn(database_url: str) -> str:
    """Convert a SQLAlchemy-style database URL into a psycopg v3 DSN.

    langgraph-checkpoint-postgres talks to Postgres via psycopg (v3), not
    the asyncpg driver our SQLAlchemy engine uses. Neon TLS and the pooled
    endpoint are handled in app.database_url — this wrapper keeps the
    existing call sites and unit tests stable.
    """
    settings = get_settings()
    return prepare_database_url(
        database_url,
        schema=settings.database_schema,
        ssl=True if settings.database_ssl else None,
    ).psycopg_dsn


async def _open_postgres_saver(settings):
    """Open the pool and run the saver's idempotent schema setup. Returns
    (saver, pool). Raises on any failure; the caller owns the fallback."""
    # Imported lazily (inside the caller's try) rather than at module scope
    # so that if psycopg/psycopg_pool aren't installed in some minimal
    # environment, import of this module still succeeds and only the
    # Postgres path fails over to MemorySaver.
    from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
    from psycopg_pool import AsyncConnectionPool

    prepared = prepare_database_url(
        settings.database_url,
        schema=settings.database_schema,
        ssl=True if settings.database_ssl else None,
    )
    pool = AsyncConnectionPool(
        prepared.psycopg_dsn,
        open=False,
        kwargs=prepared.psycopg_connect_args,
    )
    try:
        await pool.open()
        saver = AsyncPostgresSaver(pool)
        # Idempotent: creates the checkpoint tables if they don't exist yet.
        # No Alembic migration for these tables — AsyncPostgresSaver.setup()
        # owns its own schema and versioning.
        await saver.setup()
    except BaseException:
        await _close_quietly(pool)
        raise
    return saver, pool


async def _close_quietly(pool) -> None:
    try:
        await pool.close()
    except Exception:  # noqa: BLE001 — best effort during fallback/shutdown
        logger.debug("checkpointer: pool close failed", exc_info=True)


async def _initialize() -> object:
    global _saver, _pool
    settings = get_settings()

    if settings.checkpointer == "memory":
        logger.info("checkpointer: CHECKPOINTER=memory — using in-process MemorySaver")
        _saver = MemorySaver()
        return _saver

    timeout = settings.checkpointer_setup_timeout_seconds
    try:
        async with asyncio.timeout(timeout):
            saver, pool = await _open_postgres_saver(settings)
    except TimeoutError:
        logger.warning(
            "checkpointer: Postgres setup did not finish within %.0fs; "
            "falling back to in-process MemorySaver (no cross-restart durability). "
            "Something held a long transaction open during setup.",
            timeout,
        )
        _saver = MemorySaver()
        return _saver
    except Exception:
        logger.warning(
            "checkpointer: failed to initialize AsyncPostgresSaver; "
            "falling back to in-process MemorySaver (no cross-restart durability)",
            exc_info=True,
        )
        _saver = MemorySaver()
        return _saver

    logger.info("checkpointer: AsyncPostgresSaver ready (Postgres-backed)")
    _saver, _pool = saver, pool
    return _saver


def start_checkpointer_init() -> asyncio.Task:
    """Start (or return the already-running) shared initialization task.
    Called from app.main's lifespan at boot; safe to call repeatedly."""
    global _init_task
    loop = asyncio.get_running_loop()
    if _init_task is None or (_init_task.done() and _saver is None) or _init_task.get_loop() is not loop:
        _init_task = loop.create_task(_initialize(), name="checkpointer-init")
    return _init_task


async def get_checkpointer():
    """Return the process-wide checkpointer, creating it on first call.

    Every caller awaits the SAME task through asyncio.shield: concurrent
    first callers share one initialization, and a caller that is cancelled
    (a visitor closing the tab mid-wait) only stops waiting — it can't
    cancel setup for everyone else.
    """
    if _saver is not None:
        return _saver
    return await asyncio.shield(start_checkpointer_init())


async def close_checkpointer() -> None:
    """Close the Postgres pool, if one was opened. Called on shutdown."""
    global _saver, _pool, _init_task
    task = _init_task
    if task is not None and not task.done():
        task.cancel()
        try:
            await task
        except BaseException:  # noqa: BLE001 — cancelled on purpose
            pass
    if _pool is not None:
        await _close_quietly(_pool)
    _saver, _pool, _init_task = None, None, None
