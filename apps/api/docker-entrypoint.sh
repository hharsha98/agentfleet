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
#
# Single-instance hosts (Hugging Face Spaces, Cloudflare Containers) have
# no migrate Job and no replica to race. The live Worker `agentfleet-api`
# already sets RUN_MIGRATIONS_ON_BOOT=1. Honor it here — otherwise chat
# tables from a partial schema can look "alive" while missions / evals /
# documents 500 on missing relations. Compose/k8s leave the flag unset.
set -e

if [ "${RUN_MIGRATIONS_ON_BOOT:-}" = "1" ]; then
  # Wait + pgvector + schema + alembic + seed agents + optional demo seed.
  python -m scripts.space_boot
else
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

  echo "[entrypoint] seeding built-in agents..."
  python -m scripts.seed_agents
fi

echo "[entrypoint] starting app..."
exec "$@"
