"""Offline tests for app.db_connect — no Postgres, no network."""

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


def test_asyncpg_connect_args_ssl_and_schema() -> None:
    args = asyncpg_connect_args(schema="agentfleet", ssl=True)
    assert args["ssl"] is True
    assert args["server_settings"]["search_path"] == "agentfleet,extensions,public"


def test_psycopg_connect_kwargs_default_autocommit_only() -> None:
    assert psycopg_connect_kwargs() == {"autocommit": True}


def test_psycopg_connect_kwargs_ssl_and_schema() -> None:
    kwargs = psycopg_connect_kwargs(schema="agentfleet", ssl=True)
    assert kwargs["autocommit"] is True
    assert kwargs["sslmode"] == "require"
    assert kwargs["options"] == "-csearch_path=agentfleet,extensions,public"
    assert " " not in kwargs["options"]
