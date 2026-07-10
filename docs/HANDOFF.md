# AgentFleet — Session Handoff (updated 2026-07-10)

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
