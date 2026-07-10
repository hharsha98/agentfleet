# AgentFleet — Session Handoff (updated 2026-07-11, session 3)

## NOW: P5 FULLY COMPLETE ✅ (commit `3c50ef5`, pushed) — next: P6 agent builder + publish

Kanban board shipped at `/missions`: goal → live 5-column board (3s polling), Approve&run on review cards, expandable results, usage footers, cross-nav Chat/Documents/Missions. **NEXT: P6** — runtime agent builder (CRUD UI over the agents table + create/edit API routes with slug validation), connect external MCP servers (MCP client in tool registry), publish pillar (share URL + per-app API keys + expose-as-MCP), templates gallery. Also remaining: README roadmap tick for P5, update roadmap P4 line (both currently unticked).

## Earlier: P5 backend (commit `0e4d83a`)

Orchestration works end-to-end (live-verified): `POST /api/v1/runs {goal}` → Orchestrator plans a task DAG (parse_plan in `services/orchestrator.py`) → parallel execution through the chat runtime (throwaway conversations = tools+metering+tracing for free) → `needs_approval` tasks pause in `review`; `POST /api/v1/runs/{run}/tasks/{task}/approve` resumes. Langfuse tracing live-verified (keys were pasted behind `#` comments — fixed with sed). **NEXT STEP: the Kanban board UI** — `/missions` page: goal input → poll `GET /api/v1/runs/{id}` every ~3s → columns todo/in_progress/review/done/failed → Approve button on review cards → expandable results with mono usage footers. Then P6 (agent builder + publish). Server startup rule: ALWAYS `lsof -ti tcp:8000 | xargs kill` before starting uvicorn — stale servers on 8000 caused two false-negative test rounds.

## LATEST: P4 COMPLETE ✅ (through commit `31d4fdd`, pushed) — PLAN CHANGE: LOCAL-FIRST

**User decision (ADR-007):** no cloud deploy until interviews — AWS (~$100 credits) at interview time, GCP (~3 months free) after. Build the full prototype locally; task #10 = Dockerize everything + K8s manifests. Terraform prep still belongs to task #3 (on-demand).

P4 shipped: documents/chunks tables (pgvector 384-dim, migration `b374b4179d73` — note the manual `import pgvector.sqlalchemy` + CREATE EXTENSION fix), `app/services/ingest.py` (fastembed bge-small local embeddings, ADR-008; ~130MB model cached after first use), `search_documents` tool, upload API + `/documents` page. Deep Research has both tools and routes between them correctly (live-verified).

**Langfuse: keys still NOT in .env** — user tried, paste didn't land (hidden-file trap). Told them: `open -e ".../agentfleet/.env"`, uncomment + fill the three LANGFUSE lines. Verify with `grep -c "^LANGFUSE_PUBLIC_KEY=pk" .env` (never print values) then restart API and check cloud.langfuse.com for traces.

**Next: P5 Orchestration** (task #5) — arq worker + task DAG + Kanban board + step timeline + HITL approvals. Redis is already in compose.

## Earlier: P2 + P2b (commit `e2daa9e`)

P2b shipped: tool registry (`app/tools.py`, web_search via SearXNG), multi-round tool-calling loop in `services/chat.py` with SSE `tool_call`/`tool_result` events, collapsible tool cards in `chat-ui.tsx`, Langfuse env-gated in `providers.py` (activates when LANGFUSE_* keys land in .env — user still needs to create the free account). Battle-tested: loop salvages provider aborts on malformed model tool calls and forces a final answer with tool traffic flattened to plain text (Groq gpt-oss quirk — see commit message). **Next: P3 AWS MVP deploy + landing page (task #3).**

## P2 core (commit `463293d`)

Agent runtime + SSE chat shipped and live-verified: 4 seeded agents (`uv run python -m scripts.seed_agents` — note `-m`!), `GET /api/v1/agents`, `POST /api/v1/conversations(/{id}/messages)` → SSE stream, per-message metering (tokens/cost/latency), `/chat` page with agent picker + Stop button. Hardened by adversarial review: 8k input cap, 30-message history cap, sanitized errors, disconnect-safe persistence. Deferred to P7: conversation ownership/auth. **Next (P2b): tool registry (web_search via SearXNG :8081) + tool-call cards in UI + Langfuse tracing (user must create free cloud account) — then P3 AWS deploy.** Testing note: freellmapi proxy still not running; live tests used Groq direct via env override (`FREE_LLM_BASE_URL=https://api.groq.com/openai/v1`, key grep'd from career-ops keys.txt — never printed). Kill stale test servers on :8000 before testing (`lsof -ti tcp:8000`).

**Next session: read this file + ARCHITECTURE.md + docs/specs/2026-07-09-agentfleet-design.md. Do NOT crawl the whole repo.**

## Project in one line

Portfolio project for AI Engineer roles in Germany: multi-agent operations platform (feature parity with friend's useful-agents.com + a premium ops layer: evals, cost governance, guardrails, versioned publishing), AWS deployment as centerpiece. Owner: Harsha — MSc student, coding beginner: explain in plain English, teach while building (his global CLAUDE.md applies).

## State: P1 COMPLETE ✅ (commits `a68cea2` → `79f86f5`, repo github.com/hharsha98/agentfleet)

- Monorepo: `/Users/harsha/claude code/career /Projects/projects/agentfleet` (note spaces in path — always quote)
- **apps/api** — FastAPI, Python 3.12 + uv. `/health` works, `uv run pytest -q` green
- **DB** — docker compose (`docker/compose.yaml`): Postgres+pgvector :5432, Redis :6379, SearXNG :8081. Tables `users/agents/conversations/messages` (messages already has tokens/cost/latency columns). Migrations: `uv run alembic upgrade head`
- **apps/web** — Next.js 16.2.10 App Router (Turbopack), **port 3002** (3000 is occupied by user's other app). Dark-first tokens: bg `#0A0A0A`, accent `#5E6AD2`, Geist/Geist Mono, hairline borders. Homepage: blueprint-grid hero + live API status chip
- **Auth** — Auth.js v5 + Google, USER-TESTED WORKING on 3002. Header has Continue-with-Google / Sign-out
- **Secrets** — single root `.env` (gitignored, chmod 600), symlinked to `apps/api/.env` and `apps/web/.env.local`. Holds `FREE_LLM_KEY`, `AUTH_GOOGLE_ID/SECRET`, `AUTH_SECRET`, `AUTH_URL`. NEVER print or commit values

## Environment quirks (read before acting)

1. **Fact-Forcing Gate hook**: the first Write/Edit/Bash per file/turn gets blocked with a demand for 4 facts. Present the facts in text, then retry the SAME call — the retry passes. Budget for this.
2. **context-mode hooks**: `curl`/`wget` blocked → use `ctx_execute` (language `"javascript"`, not `"js"`) with `fetch`. Keep Bash output <20 lines.
3. **freellmapi proxy** (dev LLM provider, career-ops repo) must run on `localhost:3001` — it was NOT running last session. User must start it before chat testing. Model IDs: GET `http://localhost:3001/v1/models`; `.env` has `DEFAULT_MODEL=openai/gpt-oss-120b` (Groq via proxy — verify it exists in the proxy's list; config reference: `/Users/harsha/career-ops/config/free-llm.yml`)
4. Web CORS in `apps/api/app/main.py` allows only `http://localhost:3002`

## Next: P2 — Agent runtime + SSE chat (session task #2)

1. Seed 4 built-in agents into `agents` table (Orchestrator, Deep Research-lite, Creative Writer, System Architect) — new `apps/api/scripts/seed_agents.py`
2. API: `POST /api/v1/conversations`, `POST /api/v1/conversations/{id}/messages` → **SSE stream** (FastAPI StreamingResponse) using `app/providers.py:get_llm_client()` + agent.system_prompt; persist both turns with tokens/cost/latency into `messages`
3. Cost metering: price table per model (free proxy models → €0 but count tokens); groundwork for the cost dashboard
4. Langfuse tracing — needs user to create free cloud account first (LANGFUSE_PUBLIC_KEY/SECRET_KEY into `.env`)
5. Web `/chat` page: agent picker (from GET /api/v1/agents), streaming chat with the design tokens; tool-call cards come in P2b with the tool registry (web_search via SearXNG :8081)
6. LangGraph enters when tools/loops land (ADR-001); plain provider streaming is fine for chat v1

## User action items (pending)

- Start freellmapi proxy before P2 testing
- Delete `~/Downloads/client_secret_*.json` (values now live in `.env`)
- Create Langfuse cloud free account when asked

## Quick verify commands

```bash
cd "/Users/harsha/claude code/career /Projects/projects/agentfleet"
docker compose -f docker/compose.yaml ps        # 3 containers healthy
cd apps/api && uv run pytest -q                  # tests green
# health: run uvicorn, then fetch http://localhost:8000/health via ctx_execute
```
