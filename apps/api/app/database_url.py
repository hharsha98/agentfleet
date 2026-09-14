"""Normalize a Postgres DSN for the two drivers this app actually uses.

SQLAlchemy talks to Postgres via asyncpg (`postgresql+asyncpg://…`).
LangGraph's checkpointer talks via psycopg v3 (`postgresql://…`).

A pasted Neon URL is almost always:

    postgresql://user:pass@ep-….neon.tech/neondb?sslmode=require

asyncpg rejects the `sslmode` query parameter (it is a libpq-ism). Neon
also refuses non-TLS connections. The pooled hostname (`-pooler.` /
`.pooler.` / `pooler.supabase.com`) is PgBouncer, which cannot hold
asyncpg's prepared-statement cache.

`DATABASE_SSL=1` (Cloudflare / Supabase pooler) encrypts like libpq
`sslmode=require` — encrypt, do **not** verify CA or hostname.
`asyncpg ssl=True` is verify-full and fails against that pooler
(`SSLCertVerificationError` on the self-signed `Supabase Root 2021 CA`).

`DATABASE_SCHEMA` (default `public`) is applied as `search_path` so a
hosted deploy can keep tables out of someone else's `public` schema.

This module is the one place that translates "what a human pasted" into
"what each driver will actually accept". Callers must not re-implement
the rewrite.
"""

from __future__ import annotations

import ssl
from dataclasses import dataclass, field

from sqlalchemy.engine.url import make_url


_SSLMODE_ON = frozenset({"require", "verify-ca", "verify-full", "prefer"})
_SSL_ON = frozenset({"1", "true", "require", "yes"})
_STRIP_FOR_ASYNCPG = frozenset({"sslmode", "ssl", "channel_binding"})


@dataclass(frozen=True)
class PreparedDatabaseUrl:
    sqlalchemy_url: str
    psycopg_dsn: str
    asyncpg_dsn: str
    connect_args: dict = field(default_factory=dict)
    asyncpg_connect_args: dict = field(default_factory=dict)
    psycopg_connect_args: dict = field(default_factory=dict)
    requires_ssl: bool = False
    uses_pooler: bool = False
    ssl_require_style: bool = False
    schema: str = "public"
    search_path: str | None = None


def _query_dict(url) -> dict[str, str]:
    # SQLAlchemy may store a query value as a string or a sequence.
    out: dict[str, str] = {}
    for key, value in url.query.items():
        if isinstance(value, (list, tuple)):
            out[str(key)] = str(value[0]) if value else ""
        else:
            out[str(key)] = str(value)
    return out


def _is_pooler_host(host: str | None) -> bool:
    if not host:
        return False
    lowered = host.lower()
    return (
        "-pooler." in lowered
        or ".pooler." in lowered
        or lowered.startswith("pooler.")
        or "pooler.supabase.com" in lowered
    )


def _is_neon_host(host: str | None) -> bool:
    return bool(host) and "neon.tech" in host.lower()


def _is_supabase_host(host: str | None) -> bool:
    if not host:
        return False
    lowered = host.lower()
    return "supabase.co" in lowered or "supabase.com" in lowered


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
    return f"{name},extensions,public"


def asyncpg_ssl_require() -> ssl.SSLContext:
    """Match libpq sslmode=require: encrypt, do not verify CA or hostname.

    asyncpg `ssl=True` is verify-full. Observed against this project's
    Supabase session pooler: `ssl.SSLCertVerificationError: certificate
    verify failed: self-signed certificate in certificate chain`.
    """
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx


def prepare_database_url(
    raw: str,
    *,
    schema: str = "public",
    ssl: bool | None = None,
) -> PreparedDatabaseUrl:
    """Parse `raw` and return driver-specific URLs + connect_args.

    `ssl=True` is `DATABASE_SSL=1`: force libpq-require style TLS.
    `ssl=None` (default) auto-detects Neon / Supabase / `sslmode` in the DSN.
    Never logs the URL — callers that print a DSN are the ones leaking it.
    """
    url = make_url(raw)
    host = url.host
    query = _query_dict(url)
    query_lower = {k.lower(): (k, v) for k, v in query.items()}

    sslmode = query_lower.get("sslmode", ("sslmode", ""))[1].lower()
    ssl_flag = query_lower.get("ssl", ("ssl", ""))[1].lower()
    auto_ssl = (
        _is_neon_host(host)
        or _is_supabase_host(host)
        or sslmode in _SSLMODE_ON
        or ssl_flag in _SSL_ON
    )
    ssl_require_style = ssl is True
    requires_ssl = True if ssl is True else auto_ssl
    uses_pooler = _is_pooler_host(host)
    schema_name = (schema or "public").strip() or "public"
    search_path = postgres_search_path(schema_name)

    asyncpg_query = {k: v for k, v in query.items() if k.lower() not in _STRIP_FOR_ASYNCPG}
    sqlalchemy = url.set(drivername="postgresql+asyncpg", query=asyncpg_query)
    sqlalchemy_url = sqlalchemy.render_as_string(hide_password=False)

    psycopg_query = {k: v for k, v in query.items() if k.lower() != "ssl"}
    has_sslmode = any(k.lower() == "sslmode" for k in psycopg_query)
    if requires_ssl and not has_sslmode:
        psycopg_query["sslmode"] = "require"
    psycopg = url.set(drivername="postgresql", query=psycopg_query)
    psycopg_dsn = psycopg.render_as_string(hide_password=False)

    asyncpg_plain = url.set(drivername="postgresql", query=asyncpg_query)
    asyncpg_dsn = asyncpg_plain.render_as_string(hide_password=False)

    connect_args: dict = {}
    if requires_ssl:
        connect_args["ssl"] = asyncpg_ssl_require() if ssl_require_style else True
    if uses_pooler:
        connect_args["statement_cache_size"] = 0
    if search_path:
        connect_args["server_settings"] = {"search_path": search_path}

    psycopg_connect_args: dict = {"autocommit": True}
    if uses_pooler:
        psycopg_connect_args["prepare_threshold"] = None
    if search_path:
        psycopg_connect_args["options"] = f"-csearch_path={search_path}"

    return PreparedDatabaseUrl(
        sqlalchemy_url=sqlalchemy_url,
        psycopg_dsn=psycopg_dsn,
        asyncpg_dsn=asyncpg_dsn,
        connect_args=connect_args,
        asyncpg_connect_args=dict(connect_args),
        psycopg_connect_args=psycopg_connect_args,
        requires_ssl=requires_ssl,
        uses_pooler=uses_pooler,
        ssl_require_style=ssl_require_style,
        schema=schema_name,
        search_path=search_path,
    )


def settings_prepared_url():
    """Prepare DATABASE_URL using Settings (schema + DATABASE_SSL)."""
    from app.config import get_settings

    settings = get_settings()
    return prepare_database_url(
        settings.database_url,
        schema=settings.database_schema,
        ssl=True if settings.database_ssl else None,
    )


def safe_summary(raw: str, *, schema: str = "public", ssl: bool | None = None) -> str:
    """Host/ssl/pooler/schema only — never the userinfo. For CLI and boot logs."""
    prepared = prepare_database_url(raw, schema=schema, ssl=ssl)
    parsed = make_url(prepared.sqlalchemy_url)
    return (
        f"host={parsed.host} port={parsed.port or 5432} "
        f"ssl={prepared.requires_ssl} pooler={prepared.uses_pooler} "
        f"schema={prepared.schema}"
    )


if __name__ == "__main__":
    import sys

    if len(sys.argv) != 2:
        sys.stderr.write("usage: python -m app.database_url <postgres-dsn>\n")
        sys.exit(2)
    sys.stdout.write(safe_summary(sys.argv[1]) + "\n")
