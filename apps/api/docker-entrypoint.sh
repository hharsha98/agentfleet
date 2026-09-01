#!/bin/sh
# Container boot sequence for the AgentFleet API:
#   1. wait for Postgres to accept connections (compose healthchecks already
#      gate this, but we double check since `depends_on: condition: service_started`
#      races can still slip through on some Docker versions)
#   2. seed the built-in agent roster (idempotent — see scripts/seed_agents.py)
#   3. exec the real CMD (uvicorn), so it becomes PID 1 and receives signals
#
# Migrations are deliberately NOT run here by default (Phase 12 F2): with
# >1 API replica, every replica racing `alembic upgrade head` at boot can
# deadlock or double-apply. A one-shot runner owns migrations instead — the
# `migrate` service in docker/compose.full.yaml (api/worker wait on
# service_completed_successfully) and k8s/migrate-job.yaml on Kubernetes.
# Local dev keeps using `uv run alembic upgrade head` directly.
# Seeding stays here: it's idempotent and needs the tables the migration
# runner has already created by the time this container is allowed to start.
#
# Single-instance hosts (Hugging Face Spaces, Cloudflare Containers) have
# no migrate Job and no replica to race. Set RUN_MIGRATIONS_ON_BOOT=1 there
# so this entrypoint also creates pgvector, applies Alembic, and optionally
# seeds the public demo — same sequence as deploy/hfspace/entrypoint.sh.
set -e

python3 - <<'PYEOF'
import os
import socket
import time
from urllib.parse import urlparse

url = os.environ.get(
    "DATABASE_URL",
    "postgresql+asyncpg://agentfleet:agentfleet@localhost:5432/agentfleet",
)
parsed = urlparse(url.replace("postgresql+asyncpg://", "postgresql://"))
host = parsed.hostname or "localhost"
port = parsed.port or 5432

print(f"[entrypoint] waiting for postgres at {host}:{port} ...")
for attempt in range(60):
    try:
        with socket.create_connection((host, port), timeout=2):
            print("[entrypoint] postgres is accepting connections")
            break
    except OSError:
        time.sleep(1)
else:
    raise SystemExit(f"[entrypoint] postgres not reachable at {host}:{port} after 60s")
PYEOF

# Single-instance platforms only. Compose/k8s leave this unset so replicas
# never race alembic. The CREATE EXTENSION is idempotent and non-fatal if
# the role cannot create extensions (Neon grants it; Supabase already has
# `vector` in the `extensions` schema). A dedicated schema (DATABASE_SCHEMA,
# default public) is created first so tables never land in someone else's
# public schema.
if [ "${RUN_MIGRATIONS_ON_BOOT:-}" = "1" ]; then
  echo "[entrypoint] ensuring pgvector extension and schema..."
  python3 - <<'PYEOF' || echo "[entrypoint] pgvector/schema step skipped (already present, or not permitted)"
import asyncio, os, re
import asyncpg

async def main():
    dsn = os.environ["DATABASE_URL"].replace("postgresql+asyncpg://", "postgresql://")
    schema = (os.environ.get("DATABASE_SCHEMA") or "public").strip() or "public"
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", schema):
        raise SystemExit(f"[entrypoint] invalid DATABASE_SCHEMA: {schema!r}")
    ssl = os.environ.get("DATABASE_SSL", "").lower() in ("1", "true", "yes")
    conn = await asyncpg.connect(dsn, ssl=True if ssl else None)
    try:
        if schema != "public":
            await conn.execute(f'CREATE SCHEMA IF NOT EXISTS "{schema}"')
            print(f"[entrypoint] schema {schema} ready")
        await conn.execute("CREATE EXTENSION IF NOT EXISTS vector")
        print("[entrypoint] pgvector ready")
    finally:
        await conn.close()

asyncio.run(main())
PYEOF

  echo "[entrypoint] applying migrations..."
  alembic upgrade head
fi

echo "[entrypoint] seeding built-in agents..."
python -m scripts.seed_agents

# Gated so a private deployment never grows a demo account by accident.
# Same flags as deploy/hfspace/entrypoint.sh. Non-fatal: the API must still
# start if the demo seed is unavailable.
if [ "${DEMO_LOGIN_ENABLED:-}" = "1" ]; then
  echo "[entrypoint] seeding demo user and budget caps..."
  python -m scripts.seed_demo_user || echo "[entrypoint] demo user seed skipped"
fi

if [ "${SEED_DEMO_DATA:-}" = "1" ]; then
  echo "[entrypoint] seeding demo dataset..."
  python -m scripts.seed_demo --seed || echo "[entrypoint] demo data seed skipped"
fi

echo "[entrypoint] starting app..."
exec "$@"
