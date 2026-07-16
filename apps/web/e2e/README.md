# E2E tests (Playwright)

Prerequisites — the dev stack must already be running (this config never
starts it for you):

- API on http://localhost:8000 (`cd apps/api && uv run uvicorn app.main:app --port 8000`)
- Web on http://localhost:3002 (`cd apps/web && npm run dev`)
- LLM proxy on http://localhost:3001 — only needed for the `llm` project

Commands (run from `apps/web`):

- `npm run e2e` — full suite (`deterministic` + `llm` projects)
- `npm run e2e:fast` — `deterministic` only, via `E2E_SKIP_LLM=1`

Not wired into CI: GitHub Actions has no web/proxy stack to point these
tests at, so this suite is local/manual for now — future work.

Phase 12 note: none of these pages are auth-gated yet. Once the auth wrapper
lands, these tests will need a test-user or auth-bypass strategy (e.g. a
seeded session cookie) — see `smoke.spec.ts` for the current placeholder
(it only asserts the sign-in affordance renders).
