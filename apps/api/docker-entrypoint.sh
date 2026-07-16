#!/bin/sh
# Container boot sequence for the AgentFleet API:
#   1. wait for Postgres to accept connections (compose healthchecks already
#      gate this, but we double check since `depends_on: condition: service_started`
#      races can still slip through on some Docker versions)
#   2. seed the built-in agent roster (idempotent — see scripts/seed_agents.py)
#   3. exec the real CMD (uvicorn), so it becomes PID 1 and receives signals
#
# Migrations are deliberately NOT run here (Phase 12 F2): with >1 API
# replica, every replica racing `alembic upgrade head` at boot can deadlock
# or double-apply. A one-shot runner owns migrations instead — the `migrate`
# service in docker/compose.full.yaml (api/worker wait on
# service_completed_successfully) and k8s/migrate-job.yaml on Kubernetes.
# Local dev keeps using `uv run alembic upgrade head` directly.
# Seeding stays here: it's idempotent and needs the tables the migration
# runner has already created by the time this container is allowed to start.
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

echo "[entrypoint] seeding built-in agents..."
python -m scripts.seed_agents

echo "[entrypoint] starting app..."
exec "$@"
