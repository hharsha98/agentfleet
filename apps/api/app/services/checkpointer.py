"""Process-wide LangGraph checkpointer: durable Postgres by default, with a
graceful in-memory fallback.

Why a singleton at all: graph_runtime.py compiles a fresh StateGraph per
chat turn (the model and MCP toolbox are per-request), but the checkpointer
underneath it must NOT be recreated per turn — opening a fresh connection
pool per HTTP request would exhaust Postgres connections and defeats the
whole point of a durable, shared saver. One pool, reused across every
request and every replica-local process.

Fallback behavior: if Settings.checkpointer == "memory", or if Postgres
pool creation / saver.setup() raises (e.g. no DB running in a dev laptop
without docker up), we log a warning and fall back to LangGraph's built-in
MemorySaver so the app still runs — just without cross-restart durability.

Import safety: importing this module never opens a DB connection. Pool
creation and saver.setup() only happen inside get_checkpointer() on first
call, so `import app.main` and the unit test suite stay offline-safe.
"""

import asyncio
import logging

from langgraph.checkpoint.memory import MemorySaver

from app.config import get_settings
from app.db_connect import psycopg_connect_kwargs

logger = logging.getLogger(__name__)

_lock = asyncio.Lock()
_saver = None  # cached singleton: AsyncPostgresSaver or MemorySaver


def _psycopg_dsn(database_url: str) -> str:
    """Convert a SQLAlchemy-style database URL into a psycopg v3 DSN.

    langgraph-checkpoint-postgres talks to Postgres via psycopg (v3), not
    the asyncpg driver our SQLAlchemy engine uses, so the `+asyncpg` driver
    tag has to come out. A plain `postgresql://...` URL (no driver tag)
    passes through unchanged.
    """
    if database_url.startswith("postgresql+asyncpg://"):
        return "postgresql://" + database_url[len("postgresql+asyncpg://") :]
    return database_url


async def get_checkpointer():
    """Return the process-wide checkpointer, creating it on first call.

    An asyncio.Lock guards initialization so concurrent first-callers (e.g.
    two requests landing before the pool exists) don't race to open two
    pools — only one wins, the rest await the same cached result.
    """
    global _saver
    if _saver is not None:
        return _saver

    async with _lock:
        if _saver is not None:  # re-check: another caller may have won the race
            return _saver

        settings = get_settings()

        if settings.checkpointer == "memory":
            logger.info("checkpointer: CHECKPOINTER=memory — using in-process MemorySaver")
            _saver = MemorySaver()
            return _saver

        try:
            # Imported lazily (inside the try) rather than at module scope so
            # that if psycopg/psycopg_pool aren't installed in some minimal
            # environment, import of this module still succeeds and only
            # get_checkpointer() fails over to MemorySaver.
            from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
            from psycopg_pool import AsyncConnectionPool

            dsn = _psycopg_dsn(settings.database_url)
            pool = AsyncConnectionPool(
                dsn,
                open=False,
                kwargs=psycopg_connect_kwargs(settings.database_schema, settings.database_ssl),
            )
            await pool.open()
            saver = AsyncPostgresSaver(pool)
            # Idempotent: creates the checkpoint tables if they don't exist
            # yet. Safe to call every process start. No Alembic migration
            # for these tables — AsyncPostgresSaver.setup() owns its own
            # schema and versioning.
            await saver.setup()
            logger.info("checkpointer: AsyncPostgresSaver ready (Postgres-backed)")
            _saver = saver
        except Exception:
            logger.warning(
                "checkpointer: failed to initialize AsyncPostgresSaver; "
                "falling back to in-process MemorySaver (no cross-restart durability)",
                exc_info=True,
            )
            _saver = MemorySaver()

        return _saver
