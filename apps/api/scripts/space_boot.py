"""Hugging Face Space / Cloudflare Container boot: wait, migrate, seed.

A Space or a Cloudflare Container is a single process with no one-shot
migrate Job, so this module owns the sequence that
apps/api/docker-entrypoint.sh skips by default (multi-replica race).

Called from:
  - deploy/hfspace/entrypoint.sh (always)
  - apps/api/docker-entrypoint.sh when RUN_MIGRATIONS_ON_BOOT=1
    (the live Worker `agentfleet-api` already sets this)

DATABASE_URL is rewritten in-process via app.database_url so a pasted Neon
or Supabase string (sslmode=require, pooler hostname, DATABASE_SCHEMA)
actually connects. If the original DSN required TLS, DATABASE_SSL=1 is
exported so child processes (alembic, seed) do not lose it after sslmode
is stripped for asyncpg.
"""

from __future__ import annotations

import asyncio
import os
import socket
import subprocess
import sys
import time

from app.database_url import prepare_database_url, safe_summary, validated_schema_name

# Stable advisory-lock key so two Container instances cannot race Alembic.
# Cloudflare wrangler pins max_instances: 2.
_MIGRATE_LOCK_KEY = 0xA6E17F1E


def _schema_name() -> str:
    try:
        return validated_schema_name(os.environ.get("DATABASE_SCHEMA") or "public")
    except ValueError as exc:
        sys.exit(f"[boot] {exc}")


def _ssl_flag() -> bool | None:
    raw = (os.environ.get("DATABASE_SSL") or "").strip().lower()
    if raw in ("1", "true", "yes"):
        return True
    return None


def _prepared():
    raw = os.environ.get("DATABASE_URL")
    if not raw:
        sys.exit("[boot] DATABASE_URL is not set. Add it as a secret.")
    return prepare_database_url(raw, schema=_schema_name(), ssl=_ssl_flag())


def _export_normalized_database_url() -> None:
    prepared = _prepared()
    os.environ["DATABASE_URL"] = prepared.sqlalchemy_url
    if prepared.requires_ssl:
        # sslmode was stripped for asyncpg. Keep TLS on for alembic/seed.
        os.environ["DATABASE_SSL"] = "1"
    print(
        f"[boot] database DSN normalized "
        f"({safe_summary(os.environ['DATABASE_URL'], schema=_schema_name(), ssl=_ssl_flag())})"
    )


def _wait_for_database(timeout_seconds: int = 120) -> None:
    from sqlalchemy.engine.url import make_url

    parsed = make_url(os.environ["DATABASE_URL"])
    host, port = parsed.host or "localhost", parsed.port or 5432
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        try:
            with socket.create_connection((host, port), timeout=3):
                print(f"[boot] database reachable at {host}:{port}")
                return
        except OSError:
            time.sleep(2)
    sys.exit(f"[boot] database unreachable at {host}:{port} after {timeout_seconds}s")


def _open_lock_connection():
    """Hold a session-level advisory lock for the duration of migrate+schema."""
    import psycopg

    prepared = _prepared()
    conn = psycopg.connect(prepared.psycopg_dsn, **prepared.psycopg_connect_args)
    conn.execute("SELECT pg_advisory_lock(%s)", (_MIGRATE_LOCK_KEY,))
    print("[boot] acquired migrate advisory lock")
    return conn


def _release_lock(conn) -> None:
    try:
        conn.execute("SELECT pg_advisory_unlock(%s)", (_MIGRATE_LOCK_KEY,))
    finally:
        conn.close()


async def _ensure_schema_and_pgvector() -> None:
    import asyncpg

    schema = _schema_name()
    prepared = _prepared()
    conn = await asyncpg.connect(prepared.asyncpg_dsn, **prepared.asyncpg_connect_args)
    try:
        if schema != "public":
            await conn.execute(f'CREATE SCHEMA IF NOT EXISTS "{schema}"')
            print(f"[boot] schema {schema} ready")
        try:
            await conn.execute("CREATE EXTENSION IF NOT EXISTS vector")
            print("[boot] pgvector ready")
        except asyncpg.InsufficientPrivilegeError:
            print("[boot] pgvector CREATE EXTENSION skipped (insufficient privilege)")
        except Exception as exc:  # noqa: BLE001 — extension may already live in `extensions`
            print(f"[boot] pgvector CREATE EXTENSION skipped ({type(exc).__name__}: {exc})")
    finally:
        await conn.close()


def _run(module_or_args: list[str], *, required: bool) -> None:
    result = subprocess.run([sys.executable, *module_or_args], check=False)
    if result.returncode != 0 and required:
        sys.exit(result.returncode)
    if result.returncode != 0:
        print(f"[boot] optional step skipped (exit {result.returncode}): {' '.join(module_or_args)}")


def main() -> None:
    _export_normalized_database_url()
    print("[boot] waiting for the database...")
    _wait_for_database()

    lock_conn = _open_lock_connection()
    try:
        print("[boot] ensuring schema + pgvector extension...")
        asyncio.run(_ensure_schema_and_pgvector())

        print("[boot] applying migrations...")
        _run(["-m", "alembic", "upgrade", "head"], required=True)
    finally:
        _release_lock(lock_conn)

    print("[boot] seeding built-in agents...")
    _run(["-m", "scripts.seed_agents"], required=True)

    if os.environ.get("DEMO_LOGIN_ENABLED") == "1":
        print("[boot] seeding demo user, budget caps, and sandbox agent...")
        _run(["-m", "scripts.seed_demo_user"], required=True)

    if os.environ.get("SEED_DEMO_DATA") == "1":
        print("[boot] seeding demo dataset...")
        _run(["-m", "scripts.seed_demo", "--seed"], required=True)

    print("[boot] complete (migrations + seed). Caller starts the API process.")


if __name__ == "__main__":
    main()
