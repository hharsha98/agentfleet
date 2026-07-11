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
- **Pagination (nice-11)** — limit/offset on list endpoints (agents, runs, documents, conversations, versions) with sane defaults.
- **Load testing (nice-15)** — a k6/locust script exercising chat + list endpoints + a short results note in docs.

## Phase 12 — Production hardening wrapper (right before deploy)
- **B. API auth + resource ownership** — verify the Auth.js session (HS256 JWT shared secret) on every `/api/v1/*` route; set + enforce `user_id` on conversations/documents/agents/runs; gate app pages behind login. One migration to backfill ownership. THIS is the big one; do it once, comprehensively, at the end.
- **C. Rate limiting** — per-user + per-IP limits (slowapi/Redis) on chat + public invoke.
- **F2. Deploy-safety** — Alembic migration Job / init-container (multi-replica safe), readiness probe with DB check, fastembed pre-warm, **SSR/browser URL split (nice-16)** (`INTERNAL_API_URL` for web-container SSR vs `NEXT_PUBLIC_API_URL` for the browser).

## Phase 13 — Q. Cloud deploy (LAST)
- AWS via Terraform at interview time (~$100 credit); GCP configs after (~3mo free). ADR-007.
- Managed Postgres (RDS / Cloud SQL) provides **backups + HA (nice-14)** out of the box; document the restore path.

## .env keys for the new features
All added to `.env.example` (commented/optional, grouped): AUTH_SECRET (shared with web, API-side), SLACK_WEBHOOK_URL, HUBSPOT_ACCESS_TOKEN, GITHUB_TOKEN, ANALYTICS_DATABASE_URL, OPENAI_API_KEY (optional Whisper), VAPI_API_KEY, WEBHOOK_SIGNING_SECRET, SENTRY_DSN, NEXT_PUBLIC_SENTRY_DSN, INTERNAL_API_URL. Every one degrades gracefully when blank.

## Status log
- (start 2026-07-12) Phase 9 kicking off with A.
- ✅ A done (robust web access: pluggable Tavily/Exa/SearXNG + fetch_url via trafilatura, SSRF-guarded; deep-research live-verified search→fetch→cite). Chose over Agent Reach (ToS-violating cookie-scraping CLI — wrong for deployed multi-tenant).
- ✅ G done (seed_evals.py idempotent golden cases; CI eval gate now seeds-then-runs).
- ✅ F1 done (JSON logging + X-Request-ID middleware + env CORS_ORIGINS). 43 tests.
- ✅ E done (durable Postgres LangGraph checkpointer). 47 tests.
- ✅ D done (durable arq/Redis orchestration: app/worker.py + services/queue.py; ORCHESTRATOR_MODE=arq|inprocess, default inprocess for dev; compose/k8s worker service set arq; LIVE durability PROVEN — run completed across an API kill+restart). **53 tests, Phase 9 COMPLETE.**
- ✅ Phase 10 H DONE (all roster agents): H1 SQL Analytics (sql_query read-only tool + demo schema), H2 Competitor Monitor, H3 Meeting-Notes→CRM (push_to_crm), H4 Outreach — plus send_slack/push_to_crm tools that degrade gracefully w/o keys. **8 built-in agents, 62 tests.** Live-verified.
- **NEXT: rest of Phase 10** — J (artifacts panel: sandboxed markdown/code/Vega-Lite render) → I (webhooks + scheduled runs, uses arq worker from D — also makes competitor-monitor autonomous) → K (⌘K palette + empty states + changelog) → L (prompt playground + A/B) → M (2nd-SDK / Pydantic AI agent) → N (voice, Vapi). Each degrades gracefully without its key.
- KNOWN MINOR: competitor-monitor can burn MAX_TOOL_ROUNDS (5, shared const in chat.py/graph_runtime) on research before calling send_slack on the free Groq model — revisit as a per-agent round budget or tighter prompt when I (scheduled runs) makes it autonomous.
- KNOWN MINOR (fix in Phase 12 B when resource-deletion/ownership lands): Conversation→Message ORM relationship lacks cascade/passive_deletes, so ORM `session.delete(conversation)` tries to NULL the NOT NULL messages.conversation_id instead of using the DB's ON DELETE CASCADE — add `cascade="all, delete-orphan"` + `passive_deletes=True` (there's no delete-conversation endpoint yet, so it doesn't bite today).
- SECURITY: AUTH_SECRET rotated 2026-07-12 (executor leaked it via `docker compose config`). USER TODO: rotate the Google OAuth client secret in console + paste into .env. Executor-instruction reminder: NEVER run `docker compose config` without redirecting to /dev/null (it interpolates .env secrets).
- User needs (optional, for best web search): a Tavily or Exa API key in .env (TAVILY_API_KEY / set WEB_SEARCH_PROVIDER=tavily). Works on SearXNG fallback without one.
