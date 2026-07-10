# AgentFleet — Design Spec (approved 2026-07-10)

This is the approved project design, copied verbatim from the planning session. It is the source of truth for scope; deviations get an ADR in ARCHITECTURE.md.

## Context

Harsha (final-semester MSc, targeting AI Engineer roles in Germany) is building a flagship GitHub portfolio project: everything his friend's platform (useful-agents.com) does, made **premium in looks and features**, with **AWS deployment as the centerpiece** and near-zero dev cost via his free multi-provider LLM key. Name: **AgentFleet**. Sequencing: deploy-early, phased (live MVP on AWS ~week 4; full platform weeks 10–12).

Backed by two rounds of live web research (2026-07-09): 7 real German job postings + fresh July-2026 sweep of job boards, a 10-platform feature matrix (Dify, Langflow, Flowise, n8n, LangSmith, Vellum, CrewAI AMP, Sim, Botpress, Relevance AI), premium-UI research, and free-LLM capability tests.

## Fresh job-market signals (July 2026) baked into this plan

- **Claude Agent SDK / Pydantic AI / OpenAI Agents SDK** now top job-tags beyond LangGraph → ARCHITECTURE.md decision record compares them; stretch: one roster agent built on a 2nd SDK to show breadth
- **Authoring MCP servers** (not just consuming) is the stated differentiator → we publish workflows as MCP tools
- **"Context engineering"** named in German postings → docs page on our per-agent context strategy
- **Agent memory architecture** is a standard interview question → lightweight long-term memory (facts extracted per workspace)
- **AI security/red-teaming** rising sharply (EU AI Act enforcement Aug 2, 2026) → promptfoo-style adversarial suite in CI
- **Agent simulation for evals** (simulated users testing agents) → part of Eval Center
- **Voice agents** are the strongest new demand theme (LiveKit/Vapi/Pipecat) → scoped voice agent as the P8 "wow" feature
- **Forward-Deployed Engineer** is 2026's breakout role (201 FDE jobs in Germany) → README tells a POC-to-production story
- **Durable execution** (Temporal) appearing in agent stacks → ADR trade-off note (arq + Postgres checkpoints vs Temporal); Temporal = stretch

## Free-LLM strategy

The `freellmapi` proxy exposes an **OpenAI-compatible endpoint** (`http://localhost:3001/v1`, unified key in env var `FREE_LLM_KEY` — keys are never printed, committed, or hardcoded) with a 22-model cascade across 11 providers, quota fallthrough, and privacy blocks.

- **Dev/testing**: provider abstraction points at the proxy. Primary tool-calling model: **Groq `openai/gpt-oss-120b`** (strict JSON-schema outputs, parallel tool calls, ~1,000 req/day, does NOT train on data). Fallbacks: NVIDIA NIM (~40 RPM, no daily cap), Gemini 2.5 Flash. Bulk tasks: Mistral free / Gemini Flash-Lite — **synthetic data only** (both train on free-tier inputs)
- **Avoid**: GitHub Models (retiring), HuggingFace free (tiny credits), Cerebras free for agent loops (5 RPM, 8K context)
- **Demos**: paid Anthropic key (€10–20 total) or AWS Bedrock — free tiers throw 429s mid-demo; the dual-path is an interview-worthy cost-engineering story
- **On AWS**: env-switchable — direct provider keys via Secrets Manager, or Anthropic/Bedrock

## Feature parity with friend's site (all 6 pillars)

Multi-agent SSE chat (~12 agents) • Deep web research (SearXNG + Crawl4AI, cited) • Kanban DAG workflows (orchestrator decomposes → agents auto-execute, re-run/intervene) • Runtime agent builder (+ connect external MCP servers) • Document intelligence (pgvector RAG, citations) • Live observability (Langfuse + OTel + in-app step-level trace timeline) • Google login (Auth.js). Deployment: **AWS** (Terraform: ECR, ECS Fargate, RDS Postgres/pgvector, ALB, Secrets Manager, CloudWatch; GitHub Actions OIDC CI/CD) + one-command `docker compose up` self-hosting.

## The "better-than" layer (research-ranked)

**Tier 1:** versioned publishing + rollback + release notes (draft-vs-published) • publish trio+1 (share URL, embed widget, REST API with per-app keys, MCP tool) • templates gallery • Eval Center (golden datasets, LLM-as-judge, simulation tests, CI regression gate) • usage & cost dashboards (budgets, hard caps, model routing) • step-level trace timeline • guardrails & governance (injection screening, PII masking, tool allowlists, HITL checkpoints, kill switch, audit log — OWASP LLM Top 10 + EU AI Act mapping) • webhooks + scheduled runs • red-team suite in CI • artifacts side panel

**Tier 2:** prompt playground with versioning (A/B stretch) • RBAC-lite • agent memory • provider abstraction (freellmapi / Anthropic / Bedrock)

**Cut deliberately:** community marketplace, full dev/staging/prod environments, native telephony, SSO/SAML.

## Agent roster (~12 built-in + stretch)

Core: Orchestrator, Deep Research, Agent Builder, Creative Writer, System Architect (Mermaid), Code Reviewer (GitHub API), Data Analyst (Vega-Lite specs), Fact Checker, Market Intelligence (yfinance), Resume Builder.
New: **SQL Analytics** (NL→SQL, semantic layer, read-only role) • **Competitor Monitor** (scheduled scrape+diff+digest) • **Meeting-Notes→CRM** (Whisper → HubSpot) • **Outreach Personalization** (research → draft → HITL approval).
Stretch: Voice receptionist (Vapi/Retell), Browser-use agent (Playwright), Compliance Checker.

## Premium design system

Dark-first: tinted near-black `#0A0A0A`, zinc-100/400 text, hairline `border-white/10`, exactly one accent (`#5E6AD2`). Geist Sans (`tracking-tight`, `font-medium` headings) + Geist Mono for all numbers. Landing: blueprint-grid hero + one radial glow, live product embed as hero, bento features, dual CTAs. Chat UX: streaming cursor, Stop button, collapsible tool-call cards, expandable reasoning, artifacts panel, Perplexity-style citations. Motion (`motion` lib): springs 400/17, `layoutId` tabs, stagger 0.08, <300ms, `useReducedMotion`. Polish: ⌘K palette (cmdk), shimmer skeletons, designed empty states, changelog, shadcn/Recharts with gradient fills + mono numbers.

## Architecture

`apps/web` Next.js 15 + TS + Tailwind + shadcn/ui • `apps/api` FastAPI + Pydantic v2, LangGraph runtime, tool registry (built-ins + MCP client), RAG service, guardrails middleware, cost metering, provider abstraction • `apps/worker` arq DAG executor (Redis pub/sub → SSE) • `mcp/` expose workflows as MCP server • `evals/` datasets, judges, simulation, red-team, CI runner • `infra/terraform` AWS • `docker/` compose (postgres+pgvector, redis, searxng). One Postgres for everything; Alembic migrations; Redis as Fargate container.

## Phases (10–12 weeks part-time)

1. **P1 (W1–2) Foundation** — monorepo, compose stack, schema+migrations, Google auth, design tokens from day 1
2. **P2 (W2–3) Agent runtime + chat** — config-driven agents, tool registry, SSE chat with tool-call cards + citations + artifacts panel, Langfuse, cost metering, freellmapi provider; seed 4 agents
3. **P3 (W4) AWS MVP deploy + landing v1** — Terraform, CI/CD, live URL, blueprint-grid hero
4. **P4 (W5) Knowledge** — doc-upload RAG with citations; Deep Research agent
5. **P5 (W6–7) Orchestration** — DAG engine + worker, Kanban UI, trace timeline, HITL approvals
6. **P6 (W8) Builder + publish** — runtime agent builder, external MCP connect, publish trio+MCP, templates gallery, per-app API keys
7. **P7 (W9–10) Ops layer** — Eval Center (+simulation), red-team CI, versioned publishing+rollback, cost dashboards+budgets+routing, guardrails+PII masking, audit log, webhooks+schedules, RBAC-lite, agent memory
8. **P8 (W11–12) Roster + wow + polish** — new roster agents; ⌘K, empty states, changelog; README + diagram + demo video. Stretch: voice agent, browser agent, Bedrock, Temporal, 2nd-SDK agent, prompt A/B

## Definition of done

- Local: `docker compose up` → Google login → streaming chat with tool-call cards → upload PDF, cited answers → Orchestrator goal → Kanban executes → approve HITL gate → inspect traces → publish an app → roll back a version
- Deployed: same demo on live AWS URL; `terraform destroy` tears down cleanly
- CI: pytest + eval regression + red-team suite green on every PR; injection success rate 0 on golden adversarial set
- Parity checklist vs friend's site 100% + Tier-1 extras; landing passes the "Linear or bootstrap template?" test
