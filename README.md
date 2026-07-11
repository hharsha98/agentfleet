# AgentFleet

**A multi-agent operations platform** — chat with a fleet of specialized AI agents, hand the orchestrator a goal and watch it decompose into a Kanban board of agent-executed tasks, build new agents at runtime, and run it all on AWS with production-grade evals, cost governance, and guardrails.

> 🚧 Under active development — currently in **Phase 1: Foundation**. See the [roadmap](#roadmap).

## Why this exists

Most agent demos die in a notebook. AgentFleet is built the way 2026 production teams build: every agent is traced, evaluated, budgeted, and guarded — and the whole platform deploys to AWS with Terraform in one command.

## Pillars

| Pillar | What it does |
|---|---|
| 🤖 Multi-agent chat | Real-time streaming chat with ~12 specialized agents, each with its own tools, model, and config |
| 🔍 Deep research | Self-hosted SearXNG meta-search + Crawl4AI scraping with cited answers |
| 📋 Kanban workflows | Orchestrator decomposes goals into a task DAG; agents execute on a live board |
| 🛠️ Runtime agent builder | Create and deploy new agents without redeploying; connect external MCP servers |
| 📄 Document intelligence | Upload PDFs → chunked, embedded (pgvector), retrieved with citations |
| 📊 Live observability | Langfuse traces, step-level timelines, token/cost breakdowns |

## The ops layer (what makes it different)

Versioned publishing with one-click rollback • publish any workflow as share-URL / embed / REST API / **MCP tool** • Eval Center with LLM-as-judge + agent simulation + CI regression gates • per-run cost metering with hard budget caps and model routing • prompt-injection screening, PII masking, tool allowlists, human-approval gates, audit log • webhooks + scheduled runs.

## Stack

Python 3.12 · FastAPI · LangGraph · Postgres + pgvector · Redis + arq · Next.js 15 · Tailwind + shadcn/ui · Langfuse · Docker · Terraform · AWS (ECS Fargate, RDS, ALB) · GitHub Actions

## Quick start (local)

**One command, full stack** (api + web + postgres + redis + searxng, all in Docker):

```bash
cp .env.example .env          # fill in your keys
docker compose -f docker/compose.full.yaml up --build
# open http://localhost:3002
```

The api container self-migrates and seeds the built-in agent roster on boot.

**Dev mode** (infra in Docker, api/web run locally with hot reload):

```bash
cp .env.example .env          # fill in your keys
docker compose -f docker/compose.yaml up -d
cd apps/api && uv sync && uv run uvicorn app.main:app --reload
cd apps/web && npm install && npm run dev
```

K8s manifests for a local kind/k3d/minikube cluster live in [k8s/](k8s/README.md).

## Roadmap

- [x] P1 Foundation — repo, compose stack, schema, auth, design tokens
- [x] P2 Agent runtime + streaming chat (hardened by adversarial review)
- [x] P2b Tools — web search via SearXNG, tool-call cards, agentic-loop salvage
- [x] P4 Document RAG + deep research (local pgvector embeddings)
- [x] P5 DAG orchestration + Kanban + HITL approvals
- [x] P6 Agent builder + publish (share/API/MCP) + templates + external MCP
- [x] P7 Ops layer: Eval Center + CI gate, cost budgets, guardrails + red-team, versioned rollback
- [x] Local prod packaging — full docker compose + K8s manifests
- [ ] P8 Full roster + landing page + polish + demo
- [ ] Cloud deploy on demand (ADR-007): AWS at interview time, GCP after

## Design

Dark-first, one accent color, Geist type, mono numbers everywhere. Full decisions in [ARCHITECTURE.md](ARCHITECTURE.md); original spec in [docs/specs](docs/specs/).
