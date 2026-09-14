"""Neon / asyncpg DSN normalization — the public-demo boot path.

A pasted Neon connection string is `postgresql://…?sslmode=require` (and
sometimes the `-pooler.` hostname). asyncpg rejects `sslmode` as a query
parameter; SQLAlchemy+asyncpg needs `ssl=True` in connect_args instead.
PgBouncer (the pooled Neon endpoint) additionally cannot use asyncpg's
prepared-statement cache.

These tests are pure string/flag checks — no network, no database.
"""

from app.database_url import prepare_database_url, safe_summary


NEON_DIRECT = (
    "postgresql://user:secret@ep-cool-name-123.us-east-1.aws.neon.tech/"
    "neondb?sslmode=require"
)
NEON_POOLER = (
    "postgresql://user:secret@ep-cool-name-123-pooler.us-east-1.aws.neon.tech/"
    "neondb?sslmode=require"
)
LOCAL = "postgresql+asyncpg://agentfleet:agentfleet@localhost:5432/agentfleet"


def test_local_url_does_not_force_ssl_or_disable_statement_cache() -> None:
    prepared = prepare_database_url(LOCAL)
    assert prepared.requires_ssl is False
    assert prepared.uses_pooler is False
    assert prepared.connect_args == {}
    assert prepared.sqlalchemy_url.startswith("postgresql+asyncpg://")
    assert prepared.psycopg_dsn.startswith("postgresql://")
    assert "+asyncpg" not in prepared.psycopg_dsn


def test_neon_direct_url_strips_sslmode_and_requires_tls() -> None:
    prepared = prepare_database_url(NEON_DIRECT)
    assert prepared.requires_ssl is True
    assert prepared.uses_pooler is False
    assert "sslmode" not in prepared.sqlalchemy_url
    assert prepared.connect_args.get("ssl") is True
    assert "statement_cache_size" not in prepared.connect_args
    assert prepared.sqlalchemy_url.startswith("postgresql+asyncpg://")
    assert "sslmode=require" in prepared.psycopg_dsn
    assert prepared.asyncpg_dsn.startswith("postgresql://")
    assert "sslmode" not in prepared.asyncpg_dsn
    assert prepared.asyncpg_connect_args.get("ssl") is True


def test_neon_pooler_disables_prepared_statement_cache() -> None:
    prepared = prepare_database_url(NEON_POOLER)
    assert prepared.uses_pooler is True
    assert prepared.requires_ssl is True
    assert prepared.connect_args.get("statement_cache_size") == 0
    assert prepared.psycopg_connect_args.get("prepare_threshold") is None


def test_already_rewritten_asyncpg_neon_url_still_gets_ssl() -> None:
    """DEPLOY.md used to tell humans to rewrite the scheme by hand and drop
    sslmode. That form must still negotiate TLS — Neon rejects plaintext."""
    raw = "postgresql+asyncpg://user:secret@ep-cool-name-123.us-east-1.aws.neon.tech/neondb"
    prepared = prepare_database_url(raw)
    assert prepared.requires_ssl is True
    assert prepared.connect_args.get("ssl") is True
    assert "sslmode=require" in prepared.psycopg_dsn


def test_sslmode_on_non_neon_host_still_strips_for_asyncpg() -> None:
    raw = "postgresql+asyncpg://user:pw@host:5432/db?sslmode=require"
    prepared = prepare_database_url(raw)
    assert "sslmode" not in prepared.sqlalchemy_url
    assert prepared.requires_ssl is True
    assert prepared.psycopg_dsn == "postgresql://user:pw@host:5432/db?sslmode=require"


def test_safe_summary_never_includes_userinfo() -> None:
    summary = safe_summary(NEON_DIRECT)
    assert "secret" not in summary
    assert "user:" not in summary
    assert "ssl=True" in summary
    assert "pooler=False" in summary
    assert "schema=public" in summary
    assert "ep-cool-name-123.us-east-1.aws.neon.tech" in summary


SUPABASE_POOLER = (
    "postgresql+asyncpg://agentfleet_cf.ref:secret@aws-1-eu-west-1.pooler.supabase.com:5432/postgres"
)


def test_supabase_pooler_is_pooler_and_requires_tls() -> None:
    prepared = prepare_database_url(SUPABASE_POOLER)
    assert prepared.uses_pooler is True
    assert prepared.requires_ssl is True
    assert prepared.connect_args.get("statement_cache_size") == 0
    assert prepared.connect_args.get("ssl") is True


def test_database_ssl_flag_uses_libpq_require_style_context() -> None:
    import ssl as sslmod

    prepared = prepare_database_url(SUPABASE_POOLER, ssl=True, schema="agentfleet")
    assert prepared.ssl_require_style is True
    ctx = prepared.connect_args["ssl"]
    assert isinstance(ctx, sslmod.SSLContext)
    assert ctx.verify_mode == sslmod.CERT_NONE
    assert ctx.check_hostname is False
    assert prepared.search_path == "agentfleet,extensions,public"
    assert prepared.connect_args["server_settings"]["search_path"] == prepared.search_path
    assert "-csearch_path=agentfleet,extensions,public" in prepared.psycopg_connect_args["options"]


def test_public_schema_does_not_set_search_path() -> None:
    prepared = prepare_database_url(LOCAL, schema="public")
    assert prepared.search_path is None
    assert "server_settings" not in prepared.connect_args

