# AgentFleet API container.
# Base: python:3.12-slim — matches requires-python = ">=3.12" in pyproject.toml.
# uv is installed via the official distroless image (COPY --from), which is
# faster and more reproducible than `pip install uv`.
FROM python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/

WORKDIR /app

# Install OS deps needed to build any C-extension wheels (e.g. asyncpg) and
# to give the entrypoint a `python3` on PATH for the DB-wait check.
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy dependency manifests first so `uv sync` is cached unless deps change.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

# Copy the application code.
COPY app/ ./app/
COPY scripts/ ./scripts/
COPY migrations/ ./migrations/
COPY alembic.ini ./alembic.ini

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENV PATH="/app/.venv/bin:$PATH"

EXPOSE 8000

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
