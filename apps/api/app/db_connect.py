"""Pure helpers for Postgres connect options (schema + TLS).

Kept off app.db so checkpointer.py and migrations/env.py can share them
without importing the process-wide engine (app.db builds that engine at
import time from Settings).
"""

import ssl


def postgres_search_path(schema: str) -> str | None:
    """Return a search_path, or None to leave the server default.

    `public` (local compose / tests) returns None so behaviour is unchanged.
    Any other schema is listed first, then `extensions` (where Supabase
    installs pgvector) so an unqualified `vector` type still resolves.
    """
    name = (schema or "public").strip()
    if not name or name == "public":
        return None
    # No spaces: psycopg's `options` string is space-split (`-csearch_path=...`).
    # asyncpg `server_settings` accepts either form; keep one value for both.
    return f"{name},extensions,public"


def asyncpg_ssl_require() -> ssl.SSLContext:
    """Match libpq sslmode=require: encrypt, do not verify CA or hostname.

    asyncpg `ssl=True` is verify-full. Observed against this project's
    Supabase session pooler: `ssl.SSLCertVerificationError: certificate
    verify failed: self-signed certificate in certificate chain` (chain
    rooted at self-signed `Supabase Root 2021 CA`). Bundling the official
    Supabase CA then failed with `CA cert does not include key usage
    extension`. psycopg already uses `sslmode=require` and that path works.
    """
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx


def asyncpg_connect_args(schema: str = "public", ssl: bool = False) -> dict:
    """kwargs for SQLAlchemy create_async_engine(..., connect_args=).

    asyncpg rejects `?sslmode=require` on the DSN. `ssl=True` here means
    DATABASE_SSL=1: encrypt like libpq require, not verify-full.
    """
    args: dict = {}
    if ssl:
        args["ssl"] = asyncpg_ssl_require()
    search_path = postgres_search_path(schema)
    if search_path:
        args["server_settings"] = {"search_path": search_path}
    return args


def psycopg_connect_kwargs(schema: str = "public", ssl: bool = False) -> dict:
    """kwargs for psycopg_pool.AsyncConnectionPool (LangGraph checkpointer)."""
    kwargs: dict = {"autocommit": True}
    if ssl:
        kwargs["sslmode"] = "require"
    search_path = postgres_search_path(schema)
    if search_path:
        kwargs["options"] = f"-csearch_path={search_path}"
    return kwargs
