#!/bin/sh
# Boot sequence for the AgentFleet API on Hugging Face Spaces.
#
# CONTRAST WITH apps/api/docker-entrypoint.sh, which deliberately does NOT
# run migrations: under compose/k8s there are multiple API replicas, and each
# one racing `alembic upgrade head` at boot can deadlock or double-apply, so a
# one-shot migrate job owns them there.
#
# A Space is a single container. There is no replica to race and no one-shot
# job to lean on, so migrations run here (via scripts.space_boot). If this
# Space is ever scaled beyond one instance, this has to move out again.
set -e

python -m scripts.space_boot
exec "$@"
