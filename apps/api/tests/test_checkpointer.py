"""Unit tests for services/checkpointer.py's pure DSN-conversion helper.

Deliberately does NOT exercise get_checkpointer() against a live Postgres —
that's covered by the manual smoke test, not CI. This file only proves
_psycopg_dsn() converts URLs correctly, offline, with no DB or network I/O.
"""

from app.services.checkpointer import _psycopg_dsn


def test_psycopg_dsn_strips_asyncpg_driver() -> None:
    url = "postgresql+asyncpg://agentfleet:agentfleet@localhost:5432/agentfleet"
    assert _psycopg_dsn(url) == "postgresql://agentfleet:agentfleet@localhost:5432/agentfleet"


def test_psycopg_dsn_passes_through_plain_postgresql_url() -> None:
    url = "postgresql://agentfleet:agentfleet@localhost:5432/agentfleet"
    assert _psycopg_dsn(url) == url


def test_psycopg_dsn_preserves_query_params() -> None:
    url = "postgresql+asyncpg://user:pw@host:5432/db?sslmode=require"
    assert _psycopg_dsn(url) == "postgresql://user:pw@host:5432/db?sslmode=require"


def test_importing_graph_runtime_does_not_touch_the_database() -> None:
    # Regression guard for import safety: importing graph_runtime (which
    # imports checkpointer) must never open a pool or hit the network. If
    # it did, this import would hang or raise in a sandboxed test run with
    # no Postgres reachable.
    import app.services.graph_runtime  # noqa: F401
