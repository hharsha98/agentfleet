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
actually connects.
"""

from __future__ import annotations

import asyncio
import os
import re
import socket
import subprocess
import sys
import time

from app.database_url import prepare_database_url, safe_summary


def _schema_name() -> str:
    name = (os.environ.get("DATABASE_SCHEMA") or "public").strip() or "public"
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", name):
        sys.exit(f"[boot] invalid DATABASE_SCHEMA: {name!r}")
    return name


def _ssl_flag() -> bool | None:
    raw = (os.environ.get("DATABASE_SSL") or "").strip().lower()
    if raw in ("1", "true", "yes"):
        return True
    return None


def _export_normalized_database_url() -> None:
    raw = os.environ.get("DATABASE_URL")
    if not raw:
        sys.exit("[boot] DATABASE_URL is not set. Add it as a secret.")
    schema = _schema_name()
    ssl = _ssl_flag()
    prepared = prepare_database_url(raw, schema=schema, ssl=ssl)
    os.environ["DATABASE_URL"] = prepared.sqlalchemy_url
    print(f"[boot] database DSN normalized ({safe_summary(raw, schema=schema, ssl=ssl)})")


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


async def _ensure_schema_and_pgvector() -> None:
    import asyncpg

    schema = _schema_name()
    prepared = prepare_database_url(os.environ["DATABASE_URL"], schema=schema, ssl=_ssl_flag())
    conn = await asyncpg.connect(prepared.asyncpg_dsn, **prepared.asyncpg_connect_args)
    try:
        if schema != "public":
            await conn.execute(f'CREATE SCHEMA IF NOT EXISTS "{schema}"')
            print(f"[boot] schema {schema} ready")
        await conn.execute("CREATE EXTENSION IF NOT EXISTS vector")
        print("[boot] pgvector ready")
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

    print("[boot] ensuring schema + pgvector extension...")
    try:
        asyncio.run(_ensure_schema_and_pgvector())
    except Exception as exc:  # noqa: BLE001 — boot must continue if the role lacks CREATE
        print(f"[boot] pgvector/schema step skipped ({type(exc).__name__})")

    print("[boot] applying migrations...")
    _run(["-m", "alembic", "upgrade", "head"], required=True)

    print("[boot] seeding built-in agents...")
    _run(["-m", "scripts.seed_agents"], required=True)

    if os.environ.get("DEMO_LOGIN_ENABLED") == "1":
        print("[boot] seeding demo user, budget caps, and sandbox agent...")
        _run(["-m", "scripts.seed_demo_user"], required=False)

    if os.environ.get("SEED_DEMO_DATA") == "1":
        print("[boot] seeding demo dataset...")
        _run(["-m", "scripts.seed_demo", "--seed"], required=False)

    print("[boot] complete (migrations + seed). Caller starts the API process.")


if __name__ == "__main__":
    main()
