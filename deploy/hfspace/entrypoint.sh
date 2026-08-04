#!/bin/sh
# Boot sequence for the AgentFleet API on Hugging Face Spaces.
#
# CONTRAST WITH apps/api/docker-entrypoint.sh, which deliberately does NOT
# run migrations: under compose/k8s there are multiple API replicas, and each
# one racing `alembic upgrade head` at boot can deadlock or double-apply, so a
# one-shot migrate job owns them there.
#
# A Space is a single container. There is no replica to race and no one-shot
# job to lean on, so migrations run here. If this Space is ever scaled beyond
# one instance, this has to move out again.
set -e

echo "[boot] waiting for the database..."
python3 - <<'PYEOF'
import os, socket, sys, time
from urllib.parse import urlparse

url = os.environ.get("DATABASE_URL")
if not url:
    sys.exit("[boot] DATABASE_URL is not set. Add it as a Space secret.")

parsed = urlparse(url.replace("postgresql+asyncpg://", "postgresql://"))
host, port = parsed.hostname or "localhost", parsed.port or 5432

# Managed Postgres (Neon and friends) scales to zero and can take a few
# seconds to accept the first connection. Wait rather than crash-loop the
# Space against a sleeping database. Only host:port is printed — never the DSN.
for _ in range(60):
    try:
        with socket.create_connection((host, port), timeout=3):
            print(f"[boot] database reachable at {host}:{port}")
            break
    except OSError:
        time.sleep(2)
else:
    sys.exit(f"[boot] database unreachable at {host}:{port} after 120s")
PYEOF

# pgvector is an extension, not a table, so Alembic revisions cannot rely on
# it existing. This is idempotent, so it is safe every boot, and non-fatal if
# the role lacks CREATE EXTENSION (Neon grants it; some providers do not).
echo "[boot] ensuring pgvector extension..."
python3 - <<'PYEOF' || echo "[boot] pgvector step skipped (already present, or not permitted)"
import asyncio, os
import asyncpg

async def main():
    dsn = os.environ["DATABASE_URL"].replace("postgresql+asyncpg://", "postgresql://")
    conn = await asyncpg.connect(dsn)
    try:
        await conn.execute("CREATE EXTENSION IF NOT EXISTS vector")
        print("[boot] pgvector ready")
    finally:
        await conn.close()

asyncio.run(main())
PYEOF

echo "[boot] applying migrations..."
alembic upgrade head

echo "[boot] seeding built-in agents..."
python -m scripts.seed_agents

# Gated so a private deployment never grows a demo account by accident. The
# same flag gates the credentials provider in apps/web/auth.ts. Non-fatal:
# the API must still start if the demo seed is unavailable.
if [ "$DEMO_LOGIN_ENABLED" = "1" ]; then
  echo "[boot] seeding demo user and budget caps..."
  python -m scripts.seed_demo_user || echo "[boot] demo user seed skipped"
fi

# Optional demo content, so a public Space is never an empty shell.
if [ "$SEED_DEMO_DATA" = "1" ]; then
  echo "[boot] seeding demo dataset..."
  python -m scripts.seed_demo --seed || echo "[boot] demo data seed skipped"
fi

echo "[boot] starting API..."
exec "$@"
