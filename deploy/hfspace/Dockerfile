# AgentFleet API — Hugging Face Spaces (Docker SDK) image.
#
# WHY A SECOND DOCKERFILE, rather than reusing apps/api/Dockerfile:
#   - Spaces run the container as UID 1000, not root, and anything written at
#     runtime must be owned by that user (HF docs, "Permissions").
#   - Spaces expose ONE port, 7860 by default, declared as `app_port` in the
#     Space README's YAML frontmatter. apps/api/Dockerfile hardcodes 8000.
#   - A Space is a SINGLE instance, so it is safe to run migrations at boot.
#     apps/api/docker-entrypoint.sh deliberately does NOT (see its header):
#     with >1 replica, every replica racing `alembic upgrade head` can
#     deadlock or double-apply, so compose/k8s use a one-shot migrate job.
#     That hazard does not exist here, and there is no one-shot job to lean
#     on, so migrations belong in the entrypoint on this platform only.
#   - The embedding model is baked in at BUILD time (see below).
#
# Free CPU Spaces give 2 vCPU / 16GB RAM. Measured footprint of this API:
# ~205MB imported, ~507MB once the fastembed model is resident. That is why
# this runs on Spaces and not on a 256MB-512MB free tier, where RAG would OOM.

FROM python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/

# Build-time OS deps only, installed while still root so the unprivileged
# user below never needs apt. git is here because this image builds by
# cloning the source repo — see the clone step below for why.
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl git \
    && rm -rf /var/lib/apt/lists/*

# HF Spaces runs as UID 1000. Create the user and switch BEFORE any COPY or
# download, so every file it must read — and every cache dir it must write —
# is owned correctly from the start. A recursive chown afterwards would
# duplicate every affected file into a new layer.
RUN useradd -m -u 1000 user
USER user
ENV HOME=/home/user \
    PATH=/home/user/.local/bin:$PATH
WORKDIR $HOME/app

# Source comes from a git clone, not from the build context.
#
# A Space repo contains only the two files that define the Space (this
# Dockerfile and the README that configures it), so there is no `apps/api/`
# in the build context to COPY from. Cloning keeps the Space repo tiny and
# keeps GitHub the single source of truth. The trade-off, stated plainly:
# the Space does not rebuild when you push to GitHub — trigger a Factory
# rebuild in Space settings, or bump SOURCE_REF, to pick up new commits.
#
# SOURCE_REF exists so a deploy can be pinned to a tag or commit rather than
# tracking main. Pin it before showing this to anyone who matters.
ARG SOURCE_REPO=https://github.com/hharsha98/agentfleet.git
ARG SOURCE_REF=main
RUN git clone --depth 1 --branch "$SOURCE_REF" "$SOURCE_REPO" /tmp/src

# Dependency manifests first, so `uv sync` stays cached unless deps change.
RUN cp /tmp/src/apps/api/pyproject.toml /tmp/src/apps/api/uv.lock ./
RUN uv sync --frozen --no-dev

ENV PATH="$HOME/app/.venv/bin:$PATH"

# Pre-download the embedding model at BUILD time.
#
# Without this, the first request touching retrieval pays a ~130MB download
# inside the request, on a container that has just cold-started from sleep —
# the worst possible moment, and the first thing a visitor would hit. Baking
# it in trades image size for a cold start that actually serves.
# FASTEMBED_CACHE_PATH is pinned under $HOME because that is writable for
# UID 1000; the default location is not guaranteed to be. Model name must
# match EMBED_MODEL in apps/api/app/services/ingest.py.
ENV FASTEMBED_CACHE_PATH=$HOME/.cache/fastembed \
    HF_HOME=$HOME/.cache/huggingface
RUN mkdir -p $FASTEMBED_CACHE_PATH && \
    python -c "from fastembed import TextEmbedding; TextEmbedding('BAAI/bge-small-en-v1.5')"

# Application code, from the clone above.
#
# Note on layer caching, so nobody assumes more than is true: because the
# clone brings the whole repo in one layer BEFORE `uv sync`, any new commit
# invalidates the dependency layer too, and `uv sync` re-runs on every
# rebuild. That is the cost of building from a clone instead of a build
# context. It is acceptable here because a Space rebuilds rarely and only on
# an explicit trigger; do not "optimise" the order without moving to a real
# build context, or the ordering will simply be misleading rather than slow.
RUN cp -r /tmp/src/apps/api/app        ./app        && \
    cp -r /tmp/src/apps/api/scripts    ./scripts    && \
    cp -r /tmp/src/apps/api/migrations ./migrations && \
    cp    /tmp/src/apps/api/alembic.ini ./alembic.ini && \
    cp    /tmp/src/deploy/hfspace/entrypoint.sh ./entrypoint.sh && \
    chmod +x ./entrypoint.sh && \
    rm -rf /tmp/src

# Spaces' default port. Overridable via `app_port` in the Space README
# frontmatter — if you change one, change both.
EXPOSE 7860

ENTRYPOINT ["./entrypoint.sh"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "7860"]
