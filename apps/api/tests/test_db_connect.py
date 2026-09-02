"""Offline tests for app.db_connect — no Postgres, no network."""

import ssl

from app.db_connect import asyncpg_connect_args, postgres_search_path, psycopg_connect_kwargs


def test_search_path_none_for_public_and_blank() -> None:
    assert postgres_search_path("public") is None
    assert postgres_search_path("") is None
    assert postgres_search_path("  public  ") is None


def test_search_path_agentfleet_puts_extensions_second() -> None:
    path = postgres_search_path("agentfleet")
    assert path == "agentfleet,extensions,public"
    assert " " not in path


def test_asyncpg_connect_args_default_is_empty() -> None:
    assert asyncpg_connect_args() == {}


def test_asyncpg_connect_args_ssl_matches_libpq_require() -> None:
    """DATABASE_SSL=1 must encrypt without CA/hostname verify.

    asyncpg ssl=True is verify-full. Observed against this project's
    Supabase session pooler: SSLCertVerificationError (self-signed
    Supabase Root 2021 CA). Bundling the official Supabase CA then
    failed with "CA cert does not include key usage extension".
    psycopg sslmode=require already works; match that.
    """
    args = asyncpg_connect_args(schema="agentfleet", ssl=True)
    ctx = args["ssl"]
    assert ctx is not True
    assert isinstance(ctx, ssl.SSLContext)
    assert ctx.verify_mode == ssl.CERT_NONE
    assert ctx.check_hostname is False
    assert args["server_settings"]["search_path"] == "agentfleet,extensions,public"


def test_psycopg_connect_kwargs_default_autocommit_only() -> None:
    assert psycopg_connect_kwargs() == {"autocommit": True}


def test_psycopg_connect_kwargs_ssl_and_schema() -> None:
    kwargs = psycopg_connect_kwargs(schema="agentfleet", ssl=True)
    assert kwargs["autocommit"] is True
    assert kwargs["sslmode"] == "require"
    assert kwargs["options"] == "-csearch_path=agentfleet,extensions,public"
    assert " " not in kwargs["options"]
