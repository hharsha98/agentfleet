# AgentFleet — Production-Readiness Plan (all builds → deploy last)

User decision (2026-07-12): build **every** optional item to a fully production-ready, feature-complete web app, THEN deploy (AWS → GCP) as the very last step. Sequenced by dependency + testing friction (auth/rate-limit deliberately late so feature executors test against the open local API; auth wraps everything at the end).

Working model: Opus/Fable = brain (specs + review + live verification), Sonnet subagents = executors. Each chunk: spec → delegate → independently verify (pytest + build + live smoke) → commit → push → confirm CI green.

## Phase 9 — Reliability & web access (self-contained, high value)
- **A. Robust web access** ← FIRST. Pluggable search provider (env `WEB_SEARCH_PROVIDER=tavily|exa|searxng`, default searxng so it works with no key): add Tavily (best for agents) + Exa support; SearXNG stays as fallback. New `fetch_url` tool via **trafilatura** (pure-Python clean extraction, no headless browser — container-friendly; Crawl4AI noted for JS-heavy pages later). Give deep-research the fetch tool. Fixes the citation pain. USER ACTION: optional Tavily/Exa API key for best results.
- **E. Postgres LangGraph checkpointer** — replace MemorySaver with a Postgres saver so agent graph state is durable + cross-replica.
- **D. Durable orchestration** — wire arq + Redis worker so orchestrator runs survive API restarts (ADR-004); keep in-process as fallback.
- **G. Seed eval cases + real CI eval gate** — a few golden cases per built-in agent so `scripts.run_evals` is a real regression gate, not a no-op.
- **F1. Ops hygiene** — structured JSON logging + request-ID middleware; env-configurable CORS (`CORS_ORIGINS`).

## Phase 10 — Feature builds
- **H. Extra roster agents** — SQL Analytics (NL→SQL over a sandboxed read-only DB), Competitor Monitor (scheduled scrape+diff+digest — pairs with I), Meeting-Notes→CRM (transcript→structured), Outreach (research→draft→HITL). Each with an eval case.
- **I. Webhooks + scheduled runs** — inbound webhook trigger per workflow + cron-scheduled runs (turns chat app into an automation platform). Depends on D (worker) for scheduling.
- **J. Artifacts side panel** — sandboxed rendering of agent-generated markdown/code/charts (Vega-Lite) in a resizable panel.
- **L. Prompt playground + A/B** — side-by-side prompt/model compare + versioned experiments.
- **M. Second-SDK agent** — one agent on Pydantic AI (or Claude Agent SDK) to show framework breadth beyond LangGraph.
- **N. Voice agent** — Vapi/Retell-wrapped voice interface (rising German-JD theme). Scoped demo.
- **K. ⌘K command palette + polish** — cmdk palette, designed empty states, changelog page, keyboard nav.

## Phase 11 — Quality
- **O. E2E tests** — Playwright covering core flows (login → chat with tool → upload doc → mission with approval → build+red-team agent).
- **P. Error monitoring** — Sentry (backend + frontend) with request-ID correlation.

## Phase 12 — Production hardening wrapper (right before deploy)
- **B. API auth + resource ownership** — verify the Auth.js session (HS256 JWT shared secret) on every `/api/v1/*` route; set + enforce `user_id` on conversations/documents/agents/runs; gate app pages behind login. One migration to backfill ownership. THIS is the big one; do it once, comprehensively, at the end.
- **C. Rate limiting** — per-user + per-IP limits (slowapi/Redis) on chat + public invoke.
- **F2. Deploy-safety** — Alembic migration Job / init-container (multi-replica safe), readiness probe with DB check, fastembed pre-warm.

## Phase 13 — Q. Cloud deploy (LAST)
- AWS via Terraform at interview time (~$100 credit); GCP configs after (~3mo free). ADR-007.

## Status log
- (start 2026-07-12) Phase 9 kicking off with A.
- ✅ A done (robust web access: pluggable Tavily/Exa/SearXNG + fetch_url via trafilatura, SSRF-guarded; deep-research live-verified search→fetch→cite). Chose over Agent Reach (ToS-violating cookie-scraping CLI — wrong for deployed multi-tenant).
- ✅ G done (seed_evals.py idempotent golden cases; CI eval gate now seeds-then-runs).
- ✅ F1 done (JSON logging + X-Request-ID middleware + env CORS_ORIGINS). 43 tests.
- **NEXT (Phase 9 remainder): E (Postgres LangGraph checkpointer, replace MemorySaver), then D (arq+Redis durable orchestrator).** Then Phase 10 features.
- User needs (optional, for best web search): a Tavily or Exa API key in .env (TAVILY_API_KEY / set WEB_SEARCH_PROVIDER=tavily). Works on SearXNG fallback without one.
