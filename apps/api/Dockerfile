# AgentFleet API container.
# Base: python:3.12.14-slim — matches requires-python = ">=3.12" in
# pyproject.toml, pinned to a specific patch tag for reproducible builds.
# TODO(follow-up): pin by @sha256 digest too. Not done here because this
# environment has no Docker/registry access to resolve a real digest
# offline, and inventing one would be worse than a tag pin — see
# deploy/hfspace/Dockerfile, which has the same open item.
#
# uv is installed via the official distroless image (COPY --from), which is
# faster and more reproducible than `pip install uv`.
#
# Multi-stage: the builder stage runs `uv sync` to produce /app/.venv; the
# runtime stage copies only that venv plus app code, so uv itself and the
# apt cache never ship in the final image. Runtime behavior (entrypoint,
# CMD, port) is unchanged from the previous single-stage version.

# ---- Stage 1: builder ------------------------------------------------------
FROM python:3.12.14-slim AS builder

# Pinned, not :latest — a floating tag here silently changes the resolver
# that produces uv.lock's install plan, which is the opposite of what
# `uv sync --frozen` is for. Matches the uv version used locally (0.8.14).
COPY --from=ghcr.io/astral-sh/uv:0.8.14 /uv /uvx /usr/local/bin/

WORKDIR /app

# Install OS deps needed to build any C-extension wheels (e.g. asyncpg).
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy dependency manifests first so `uv sync` is cached unless deps change.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

# ---- Stage 2: runtime -------------------------------------------------
FROM python:3.12.14-slim AS runtime

# Non-root user the process runs as. UID/GID 1000 is a fixed contract with
# the Kubernetes manifests (k8s/) being written in parallel — do not change
# either value without updating those manifests too, or pods will
# crash-loop on permission errors.
RUN groupadd -g 1000 app && useradd -m -u 1000 -g 1000 app

# No apt layer in the runtime stage on purpose. The HEALTHCHECK below uses
# the interpreter that already ships in this image rather than installing
# curl for it — adding a package to an image whose whole point is a reduced
# attack surface is a bad trade, and it measurably grew the sibling web
# image by ~25MB before this was fixed.

WORKDIR /app

# Bring in the venv built above, owned by the runtime user.
COPY --from=builder --chown=app:app /app/.venv /app/.venv

# Copy the application code, owned by the runtime user.
COPY --chown=app:app app/ ./app/
COPY --chown=app:app scripts/ ./scripts/
COPY --chown=app:app migrations/ ./migrations/
COPY --chown=app:app alembic.ini ./alembic.ini

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENV PATH="/app/.venv/bin:$PATH"

# fastembed (app/services/ingest.py) downloads its embedding model on first
# use, and huggingface_hub (its transitive dep) follows HF_HOME for its own
# cache — both need a location UID 1000 can write. Pin both under $HOME and
# create+chown them here, before USER switches away from root, so there is
# no root-owned default cache dir left for the process to fail against.
# Mirrors the proven pattern in deploy/hfspace/Dockerfile.
ENV HOME=/home/app \
    FASTEMBED_CACHE_PATH=/home/app/.cache/fastembed \
    HF_HOME=/home/app/.cache/huggingface
RUN mkdir -p "$FASTEMBED_CACHE_PATH" "$HF_HOME" && \
    chown -R app:app /home/app/.cache

USER app

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD ["python", "-c", "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://localhost:8000/health', timeout=2).status == 200 else 1)"]

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
