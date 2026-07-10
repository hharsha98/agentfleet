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

```bash
cp .env.example .env          # fill in your keys
docker compose -f docker/compose.yaml up -d
cd apps/api && uv sync && uv run uvicorn app.main:app --reload
```

## Roadmap

- [x] P1 Foundation — repo, compose stack, schema, auth, design tokens
- [ ] P2 Agent runtime + streaming chat
- [ ] P3 AWS MVP deploy + landing page
- [ ] P4 Document RAG + deep research
- [ ] P5 DAG orchestration + Kanban + HITL
- [ ] P6 Agent builder + publish (share/embed/API/MCP)
- [ ] P7 Ops layer: evals, red-team CI, versioning, cost governance
- [ ] P8 Full roster + polish + demo

## Design

Dark-first, one accent color, Geist type, mono numbers everywhere. Full decisions in [ARCHITECTURE.md](ARCHITECTURE.md); original spec in [docs/specs](docs/specs/).
