---
title: AgentFleet API
emoji: 🛠️
colorFrom: indigo
colorTo: gray
sdk: docker
app_port: 7860
pinned: false
---

# AgentFleet API

Backend for [AgentFleet](https://github.com/hharsha98/agentfleet) — a self-hostable
multi-agent operations platform: specialist agents, a DAG orchestrator with
self-healing and human approval gates, document RAG over pgvector, evals with an
LLM judge, guardrails, budgets and cost metering.

This Space runs **only the API**. The web UI deploys separately (Vercel) and points
at this Space's URL.

## This file is the Space's config, not documentation

The YAML block above is what Hugging Face reads: `sdk: docker` selects the Docker
SDK, and `app_port: 7860` must match the port the container listens on. Change one
without the other and the Space fails to serve.

## The Space repo holds two files

`README.md` (this file) and `Dockerfile`. The Dockerfile clones the source from
GitHub at build time rather than expecting it in the build context, so the Space
repo stays small and GitHub remains the single source of truth.

**Consequence worth knowing:** pushing to GitHub does *not* rebuild this Space.
Trigger a Factory rebuild in Space settings, or bump the `SOURCE_REF` build
argument, to pick up new commits.

## Required secrets

Set these in **Space settings → Variables and secrets**; they are injected as
environment variables at runtime.

| Name | Kind | Purpose |
|---|---|---|
| `DATABASE_URL` | secret | Neon Postgres DSN, `postgresql+asyncpg://…` |
| `AUTH_SECRET` | secret | **Must byte-match** the web app's `AUTH_SECRET` — the API verifies the same HS256 JWT the Next.js app mints |
| `FREE_LLM_BASE_URL` | secret | OpenAI-compatible provider endpoint |
| `FREE_LLM_KEY` | secret | Provider key |
| `CORS_ORIGINS` | variable | The deployed web origin, e.g. `https://agentfleet.vercel.app` |
| `DEFAULT_MODEL` | variable | e.g. `openai/gpt-oss-120b` |
| `ORCHESTRATOR_MODE` | variable | `inprocess` — no Redis on the free tier |
| `DEMO_LOGIN_ENABLED` | variable | `1` to allow the public demo login |
| `SEED_DEMO_DATA` | variable | `1` to seed demo content on first boot |

`AUTH_SECRET` is the one that breaks things quietly: mismatch it and the UI signs
in fine while every API call returns 401. `apps/api/app/auth.py` fails closed with
503 on a *blank* secret, so a missing value is loud — but a **wrong** value is not.

## Why this runs on Spaces

Measured footprint: ~205 MB with the API imported, ~507 MB once the fastembed
embedding model is resident. A 256 MB or 512 MB free tier cannot hold that — RAG
would OOM. Free CPU Spaces give 2 vCPU / 16 GB, so the model is baked into the
image at build time and the first retrieval request does not pay a ~130 MB
download on a container that has just woken from sleep.

The Space sleeps after prolonged inactivity and takes a few seconds to wake. The
web UI says so rather than showing a broken screen.
