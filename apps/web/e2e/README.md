# E2E tests (Playwright)

Prerequisites — the dev stack must already be running (this config never
starts it for you):

- API on http://localhost:8000 (`cd apps/api && uv run uvicorn app.main:app --port 8000`) — auth-enforced (Phase 12 B1): every `/api/v1/*` route except `/health`, `/api/v1/hooks/*`, and `/api/v1/public/*` requires a Bearer JWT.
- Web on http://localhost:3010 (`cd apps/web && npm run dev`) — must match `baseURL` in `playwright.config.ts`
- LLM proxy on http://localhost:3001 — only needed for the `llm` project
- Repo root `.env` must have `AUTH_SECRET` set — `auth.setup.ts` reads it directly from that file (never logged/printed).

Commands (run from `apps/web`):

- `npm run e2e` — full suite (`deterministic` + `llm` projects)
- `npm run e2e:fast` — `deterministic` only, via `E2E_SKIP_LLM=1`

Not wired into CI: GitHub Actions has no web/proxy stack to point these
tests at, so this suite is local/manual for now — future work.

## Auth (Phase 12 B2)

Every page in this suite except the landing page and `/changelog` is now
gated behind Auth.js (`proxy.ts` + the `authorized` callback in `auth.ts`).
There is **no auth-bypass code in the app** — test and production users go
through the exact same session-verification path. Instead, a Playwright
`globalSetup` (`e2e/auth.setup.ts`) forges a real Auth.js session cookie
before any test runs:

- It calls the same `encode()` function next-auth v5 uses internally
  (`next-auth/jwt`, an encrypted JWE — alg `dir`, enc `A256CBC-HS512`) with
  `AUTH_SECRET` and the session cookie's own name as the salt (that's how
  next-auth v5 always derives it — confirmed against the installed
  `@auth/core` source). The result decrypts identically to a cookie a real
  Google sign-in would have produced.
- The forged identity is fixed: `{ email: "e2e@test.local", name: "E2E Test
  User", sub: "e2e@test.local" }`.
- The cookie is written to `e2e/.auth/state.json` (gitignored, regenerated
  every run) and wired into `playwright.config.ts` as the default
  `storageState` for both projects — so every spec in this suite, including
  the `llm` project (chat streaming, playground A/B), now runs signed in.

`auth.spec.ts` is the one spec that opts OUT of the global storageState
(`test.use({ storageState: { cookies: [], origins: [] } })`) to cover the
signed-out path: visiting `/chat` with no session cookie redirects to the
Auth.js sign-in page, and hitting `/api/v1/agents` directly with no
Authorization header 401s.
