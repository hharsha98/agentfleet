# AgentFleet — active roadmap

**Read this first if you are picking up work with no prior context** — a fresh
session, a cloud session, or a future you. It is written to be self-contained.

Last updated: 2026-08-04 · at tag `v0.1.0` · HEAD `3c810f4`

---

## What this project is, in one paragraph

A self-hostable multi-agent operations platform. FastAPI + SQLAlchemy async +
Postgres/pgvector + Redis/arq behind a Next.js 16 frontend. 17 built-in agents, a
DAG orchestrator with self-healing and human-approval gates, document RAG,
LLM-as-judge evals, guardrails, budgets and per-message cost metering. ~33,600
lines, 239 API tests, 26 Playwright E2E, 17 Alembic migrations, 11 ADRs.

**Why the roadmap looks the way it does:** this is a portfolio project targeting an
**AI Engineer** role at AI startups. Two audits were run against that goal. The
first found the app claiming capabilities it did not have; the second found the same
pattern in the infrastructure story. Both are recorded in `ARCHITECTURE.md` as dated
Status blocks rather than edited away, because the gap between what a document
claims and what the code does is precisely the thing an ADR exists to prevent.

---

## ⚠️ Environment constraints — read before running anything

**The test suite needs a live Postgres.** `apps/api/tests/conftest.py` points
`DATABASE_URL` at a dedicated `agentfleet_test` database, creates it, migrates it,
and truncates between tests. With no Postgres reachable, `pytest` fails at
collection — that is a missing dependency, **not** a code regression.

**The E2E suite needs the stack already running.** `apps/web/playwright.config.ts`
has no `webServer` block on purpose (see its header). It expects web on `:3002` and
API on `:8000` to be up already.

| Environment | What you can verify |
|---|---|
| The author's Mac (Docker up: `agentfleet-postgres-1`, `redis`, `searxng`) | Everything |
| Cloud VM / fresh clone **with** Docker | Bring infra up first: `docker compose -f docker/compose.yaml up -d`, then `cd apps/api && uv run alembic upgrade head` |
| Cloud VM **without** Docker | `npm run lint`, `npm run build`, `ruff check`, plus reading and editing code. **Not** pytest, **not** E2E |

**If you cannot run a check, say so explicitly. Never describe an unrun check as
passing.** That rule has already caught real mistakes in this repo.

---

## Wave plan

| Wave | What | Status |
|---|---|---|
| — | Eval judge fail-open + cross-tenant RAG leak + truthful cost metering | ✅ `41d2ee9` |
| — | Lint blocking in CI, nine react-hooks errors resolved | ✅ `518b359` |
| — | Public demo sign-in bounded by the budget system | ✅ `78242a2` |
| — | Free-tier deploy prepared (`deploy/hfspace/`, `docs/DEPLOY.md`) | ✅ `3e49be8` |
| **0** | Stop advertising infrastructure that does not exist | ✅ `3c810f4` |
| **1** | Half A — four real bugs | ✅ `6cb8ca5` |
| **1** | Half B — make the eval gate real | ✅ (this commit) |
| **2** | **Ship the free stack (Neon + HF Spaces + Vercel) — first public URL** | ⬅️ **next** |
| 3 | Container hardening, `k8s/` base+overlays, kind-in-CI, E2E in CI | todo |
| 4 | GCP: Cloud Run + Terraform + Workload Identity Federation | todo |
| 5 | GKE Autopilot evidence run, time-boxed, on the $300 credit | todo |
| 6 | Teardown + writeup + `docs/AWS_EQUIVALENTS.md` | todo |
| 7 | AI substance: hybrid retrieval, retrieval evals, judge calibration, OTel | todo |

**Sequencing rule that matters: do not create the GCP project until Waves 0–3 are
done.** The $300 credit is a 90-day clock that starts on activation; spending 30 of
those days hardening Dockerfiles is pure waste.

---

# Wave 1 — the next task

**Status (2026-08-05): Wave 1 is complete.** Everything below is kept as the
written record of what was wrong and why it mattered — it is no longer a task
list. Half A landed in `6cb8ca5`; Half B landed in the commit that added this
block. Next task is **Wave 2**.

What Half B actually shipped, since it differs from the sketch below in two
places worth knowing:

- `scripts/stub_llm.py` serves recorded replies from
  `scripts/fixtures/llm_fixtures.json` and supports **streaming**, because
  `app/services/chat.py` streams — a non-streaming stub would have been
  useless against the real code path. It defaults to port **8099**, not 8081:
  `docker/compose.yaml` already publishes searxng on 8081.
- `evals-live` skips when `FREE_LLM_BASE_URL` is empty as well as when
  `FREE_LLM_KEY` is. An unset GitHub secret expands to an empty string, and
  pydantic treats an empty env var as a real value that **overrides** the
  field default rather than falling back to it — so an unguarded live gate
  would build a client against `base_url=""` and report a config gap as a
  provider outage.

Verified locally before commit: `ruff` clean, `pytest` 279 passed, and the
offline gate scoring 17/17 agents at 100% with no API key. All three
`run_evals` exit codes were exercised for real — 0 (pass), 1 (forced
regression via a deliberately wrong fixture file), 2 (stub stopped).
`gitleaks v8.30.1` scanned 139 commits and found no leaks, so the new
blocking secret-scan gate starts green.

Two halves, independent. Do them in either order.

## Half A — four real bugs

All four confirmed by reading the code at HEAD `3c810f4`, not inferred.

### Bug 1 — no connection-pool pre-ping · `apps/api/app/db.py:7`

```python
engine = create_async_engine(get_settings().database_url, echo=False)
```

That is the entire configuration. No `pool_pre_ping`, no sizing, no recycle. Wave 2
targets Neon and Wave 4 targets Cloud SQL — **both scale to zero** — so stale
connections are certain, not hypothetical.

Add `pool_pre_ping=True`, `pool_size`, `max_overflow`, `pool_recycle` (under any
proxy idle timeout) and `pool_timeout`. **Derive the sizing rather than guessing**,
and put the arithmetic in the docstring: `(pool_size + max_overflow) ×
max_instances` must stay under the database's connection cap. Expose the knobs via
`apps/api/app/config.py` so the worker — long-running, low concurrency — can use a
smaller pool than the API.

### Bug 2 — no LLM timeout · `apps/api/app/providers.py:25` and `:29`

Both branches build a client with no `timeout=` and no `max_retries=`. This is the
hottest path in the application and it can hang unbounded.

Use asymmetric timeouts: **short connect** (a dead endpoint should fail in ~5s),
**generous read** (a large model streaming can exceed 60s). Two couplings to respect
and to state in comments:

- `read` must stay **under Cloud Run's request timeout**, or the platform kills the
  request first and the timeout never fires.
- SDK retries compound with the app's own self-healing. The `SELF_HEAL_*` settings
  and the escalation ladder already retry *semantically*; keep SDK `max_retries` low
  so it owns only *transport* failures.

Apply to **both** branches — the Langfuse-traced client has the same hole.

### Bug 3 — no graceful shutdown · `apps/api/app/main.py:84`

```python
async def lifespan(app: FastAPI):
    _start_embeddings_prewarm()
    yield
```

Nothing runs on the way out: no `engine.dispose()`, no arq pool close. Under
`ORCHESTRATOR_MODE=inprocess`, runs are `asyncio.create_task` in the API process and
are **lost on any restart**, leaving rows stuck in `running` forever.

**Graceful means the data is truthful after the process dies, not that you waited
politely.** Order:

1. Set a shutting-down flag; `/health/ready` returns 503 immediately so load
   balancers and kube endpoints drain first. Cloud Run has no `preStop`, so an
   in-app drain is the only option there.
2. Brief drain.
3. Close the arq pool — `queue.py`'s global `_pool` is never closed today.
4. `await engine.dispose()` last.

For `inprocess`, wait on pending tasks with a timeout, then **write `interrupted` to
any run still going**. A run stuck in `running` forever is the user-visible bug. For
`arq`, add `on_startup`/`on_shutdown` to `WorkerSettings` in `apps/api/app/worker.py`
and set `job_timeout`, `max_tries` and `retry_jobs` explicitly so an interrupted job
is **re-queued rather than lost**.

No graceful path survives SIGKILL. Consider a periodic reaper marking `running` rows
with a stale heartbeat as `interrupted` — acknowledging the limit is stronger than
pretending shutdown covers it.

### Bug 4 — fire-and-forget tasks can be collected · `apps/api/app/services/queue.py:59` and `:73`

```python
asyncio.create_task(plan_and_execute(run_id))   # :59
asyncio.create_task(execute_run(run_id))        # :73
```

Neither handle is kept. CPython documents that a task whose only reference is the
event loop's weak set may be **garbage-collected mid-execution**. Hold them in a
module-level `set()` and discard via `add_done_callback`. This is a prerequisite for
Bug 3 — you cannot wait on tasks you do not track.

## Half B — make the eval gate real *(highest value in this wave)*

`.github/workflows/evals.yml` runs the eval step under
`if: ${{ env.FREE_LLM_KEY != '' }}` **and** `continue-on-error: true`. It cannot run
without the secret and cannot fail the build with it. **It is not a gate.**

For an AI Engineer portfolio this is a bigger hole than every Kubernetes defect
combined — evals are the thing the role is hired for. `README.md` now states the
limitation honestly, which was the temporary fix; this is the real one.

Split it in two:

- **`evals-offline` — blocking, no secrets, every PR including forks.** Runs
  `check_case` logic, `judge()` parsing against **recorded** provider responses, and
  dataset schema validation. Fully deterministic. This is the gate that must be green
  on every PR.
- **`evals-live` — blocking on `main` + `workflow_dispatch`, skipped on forks.** Real
  provider, with retries on transient errors before declaring failure.

Also: `apps/api/scripts/run_evals.py` must distinguish **provider-unavailable (exit
2)** from **eval regression (exit 1)**. Today a dead provider and a genuinely broken
agent look identical.

**Build a stub LLM** — a small OpenAI-compatible fixture serving a fixed
`/v1/chat/completions` response. It makes the offline gate hermetic, and Wave 3
reuses the same stub inside the kind cluster. Build once, use twice.

`apps/api/app/services/evals.py` had two `judge()` bugs (a fail-open on string
booleans, and a `rfind` overshoot on trailing prose). Both were fixed in `41d2ee9`
with tests — **verify they are still fixed before touching that function.**

Free gates to add in the same pass: **ruff** (configured in `pyproject.toml`, never
run in CI), **`alembic check`** (migration drift — almost no portfolio has it),
`.github/dependabot.yml`, gitleaks, and a five-line `SECURITY.md`.

---

## Verification

Run what your environment allows, and **report honestly what you could not run.**

```bash
# API tests — needs Postgres
cd apps/api && uv run pytest -q                      # expect: 239 passed

# migrations — needs Postgres
cd apps/api && uv run alembic upgrade head && uv run alembic check

# web — no services needed
cd apps/web && npm run lint                          # expect: exit 0 (blocking in CI)
cd apps/web && npm run build

# E2E — needs web on :3002 and API on :8000 already up
cd apps/web && E2E_SKIP_LLM=1 npx playwright test    # expect: 26 passed

# python lint — not yet in CI; Wave 1 adds it
cd apps/api && uv run ruff check .
```

**Do not commit unless every check you were able to run is green.** If a check is
flaky, re-run before concluding — this suite shares one Postgres with no per-test
isolation beyond truncation, so a scattered burst of failures is usually contention.
A *reproducible* failure never is.

## House rules

- **Never claim an unrun check passed.** State what you ran and what you skipped.
- Correct documentation **in place** with a dated `Status (YYYY-MM-DD):` block — see
  `ARCHITECTURE.md` ADR-001/002/003/006/007 for the pattern. Do not silently rewrite
  a claim.
- Prefer making a false claim **true** over editing the claim down. `k8s/api.yaml`
  gained `ORCHESTRATOR_MODE: arq` for exactly that reason.
- One commit, one reason to change.
- **Do not commit or push unless the author asks.**

## Fragile selectors — read before touching the frontend

`apps/web/e2e/` asserts on these; changing them silently breaks the suite.

- `div.flex-1.space-y-4.overflow-y-auto` — the chat message list,
  `components/chat-ui.tsx:279`. A raw structural class.
- `page.locator("div", { hasText: name }).last()` in `workflows.spec.ts` — breaks on
  **any** added wrapper `<div>` around cards.
- Ten page `h1` strings exact-matched in `smoke.spec.ts`. Style them freely; do not
  change the text.
- `[class*="ring-red-500"]` with an exact `toHaveCount(2)` in
  `components/workflow/nodes.tsx`.
- `getByPlaceholder(/^Message /)`, `getByRole("button", { name: "Send" })`,
  `getByText(/agents online/)`.
