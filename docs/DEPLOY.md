# Deploying AgentFleet (full-feature public demo)

Goal: a URL a stranger can open, click **Try the demo**, and use **every**
README feature — chat, agent builder (publish/version/MCP), visual
workflows, missions/DAG + approvals, RAG documents, evals/ops — not a
scaffold where only Chat works.

**Do not use or advertise** `agentfleet.pages.dev` or `agentfleet.vercel.app`.
Those hostnames are other products. This repo's owned public resources:

| Piece | Owned resource | Notes |
|---|---|---|
| API | Cloudflare Worker **`agentfleet-api`** (Containers wrapping the FastAPI image) | Live. `workers.dev` URL is printed by `wrangler deploy` — it includes your account subdomain. |
| Web | Cloudflare Worker **`agentfleet-app`** (OpenNext) | Deploy from `apps/web` (`npm run cf:deploy`). Not interchangeable with the static gallery `agentfleet-gallery`. |
| Postgres + pgvector | Existing **Supabase** project, schema `agentfleet` (Cloudflare path) **or** **Neon** (free path) | Not D1. Not R2. |
| Free-tier API fallback | Hugging Face **Space** (`deploy/hfspace/`) | Use when Containers cannot rebuild. 16 GB RAM so RAG fits. |

Studio DNS (`agentic-systems-studio.com`, `fleet.agentic-systems-studio.com`)
is **out of scope** until this demo checklist is green on the owned URLs
above.

**No Redis** on the public demo. `ORCHESTRATOR_MODE=inprocess`.

Cloudflare Containers are **Workers Paid**. The API image is ~205 MB
imported and **~507 MB** with fastembed. Instance type `lite` OOMs; this
repo pins `standard-1`. If you cannot use Containers, use the Hugging Face
Space as the API and still deploy `agentfleet-app` as the web. Details:
[CLOUDFLARE.md](CLOUDFLARE.md).

---

## Exact env — full-feature demo

Values must match on API and web where marked **shared**.

### API (`agentfleet-api` wrangler vars/secrets, or HF Space secrets)

| Name | Kind | Value |
|---|---|---|
| `DATABASE_URL` | secret | Postgres DSN (`postgresql+asyncpg://…`). Drop `?sslmode=require` — the app strips it. |
| `DATABASE_SSL` | var | `1` on Supabase/Neon TLS (libpq `require`, no CA verify). Off for local compose. |
| `DATABASE_SCHEMA` | var | `agentfleet` on the existing Supabase project; omit/`public` on Neon. |
| `AUTH_SECRET` | secret | **shared** with web, `openssl rand -base64 32` |
| `FREE_LLM_BASE_URL` | secret | OpenAI-compatible endpoint |
| `FREE_LLM_KEY` | secret | Provider key |
| `DEFAULT_MODEL` | var | `openai/gpt-oss-120b` (or your provider's id) |
| `ORCHESTRATOR_MODE` | var | `inprocess` |
| `DEMO_LOGIN_ENABLED` | var | `1` |
| `SEED_DEMO_DATA` | var | `1` |
| `RUN_MIGRATIONS_ON_BOOT` | var | `1` (single-instance only — Cloudflare Container / HF Space) |
| `EMBEDDINGS_PREWARM` | var | `1` |
| `CORS_ORIGINS` | var | web origin, comma-separated. Optional for the UI if it uses `/backend`; required for MCP/clients hitting the API host. |
| `TRUST_PROXY_HEADERS` | var | `1` on Spaces / any reverse proxy |

`RUN_MIGRATIONS_ON_BOOT=1` is load-bearing. The Worker already sends it.
If the image ignores it, Chat can look alive (old `agents` table) while
`/runs`, `/workflows`, `/documents`, `/evals` 500 on missing relations.

### Web (`agentfleet-app` wrangler vars/secrets, or web container env)

| Name | Kind | Value |
|---|---|---|
| `AUTH_SECRET` | secret | **shared**, byte-identical with the API |
| `AUTH_URL` | var | public web URL (`https://agentfleet-app.<subdomain>.workers.dev`) |
| `AUTH_TRUST_HOST` | var | `true` |
| `DEMO_LOGIN_ENABLED` | var | `1` |
| `INTERNAL_API_URL` | var | API origin (Worker or Space). **Runtime.** Used by RSC and `/backend`. |
| `PUBLIC_API_URL` | var | **leave unset** so the browser uses same-origin `/backend` |
| `NEXT_PUBLIC_SITE_URL` | var | public web URL (OG cards) |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | optional | Demo login works without Google |

**Never bake `NEXT_PUBLIC_API_URL=http://localhost:8000`.** That is the
hosted-demo failure mode: Chat (server component) uses `INTERNAL_API_URL`,
every other page (`"use client"` + `apiFetch`) talks to the visitor's
laptop. The `/backend` proxy is the fix.

Rebuild the **API container image** after merging boot/migration fixes.
Redeploying only the thin Worker proxy leaves the old FastAPI image running.

---

## 1. Database

### Cloudflare path (already provisioned)

See [CLOUDFLARE.md](CLOUDFLARE.md). Schema `agentfleet`, session pooler
`aws-1-eu-west-1.pooler.supabase.com:5432`, `DATABASE_SSL=1`.

### Free path — Neon

1. Create a project at neon.tech.
2. Paste the connection string. The app accepts `postgresql://…?sslmode=require`
   and rewrites it (`app/database_url.py`). You do **not** need to hand-edit
   the scheme.

You do **not** create tables by hand. `RUN_MIGRATIONS_ON_BOOT=1` runs
`CREATE EXTENSION vector` (non-fatal if already present) and
`alembic upgrade head`.

---

## 2. Shared `AUTH_SECRET`

```bash
openssl rand -base64 32
```

Same bytes on API and web. Mismatch → sign-in appears to work, every API
call is 401. Blank → API 503 (loud). Wrong → silent 401s on client pages.

---

## 3. API

### Owned: Cloudflare Container (`deploy/cloudflare`)

```bash
cd deploy/cloudflare
npm install
cp .dev.vars.example .dev.vars   # fill secrets
./put-secrets.sh
npx wrangler deploy
```

Confirm `GET https://agentfleet-api.<subdomain>.workers.dev/health` →
`{"status":"ok","service":"agentfleet-api","demo":true,…}` after first boot
(migrations + seed; can take a couple of minutes). Then:

```bash
cd apps/api
AUTH_SECRET=… uv run python -m scripts.demo_smoke \
  --base-url https://agentfleet-api.<subdomain>.workers.dev \
  --require-seeded
```

That script **fails** if builder / missions / ops routes 404 or 5xx, or if
create+publish+MCP persist does not work. CI runs the same script
(`.github/workflows/evals.yml` job `demo-smoke`).

### Fallback: Hugging Face Space

1. New Space, SDK **Docker**, CPU basic, public.
2. Copy `deploy/hfspace/Dockerfile` and `deploy/hfspace/README.md` into the
   Space repo.
3. Set the API env table above. `SOURCE_REF` pins the GitHub ref the image
   clones — **Factory rebuild after merge**; pushing GitHub does not redeploy
   the Space.
4. Confirm `/health`, then run `scripts.demo_smoke` against
   `https://<user>-<space>.hf.space`.

---

## 4. Web — OpenNext Worker `agentfleet-app`

```bash
cd apps/web
npm ci
# wrangler vars: AUTH_URL, INTERNAL_API_URL, DEMO_LOGIN_ENABLED=1, AUTH_TRUST_HOST=true
npx wrangler secret put AUTH_SECRET
npm run cf:deploy
```

Do not deploy over `agentic-systems-studio` or Pages `agentfleet-gallery`.

Local Docker (full stack, also a valid demo):

```bash
cp .env.example .env   # AUTH_SECRET, LLM keys, DEMO_LOGIN_ENABLED=1
docker compose -f docker/compose.full.yaml up --build
# http://localhost:3002 — browser uses /backend → api:8000
```

---

## 5. Verify (full-feature, not Chat-only)

Private window:

1. Landing loads. **Try the demo** (no Google required).
2. **Chat** — pick an agent, send a message, stream + tool cards.
3. **Agents** — open **Demo sandbox agent** (not a built-in). Edit prompt,
   add an MCP server URL, **Publish**, open versions, rollback.
   Built-ins stay 403 on mutate — that is ownership, not a broken builder.
4. **Workflows** — open the visual builder, save, **Run**.
5. **Missions** — seeded board visible. New mission with a short goal.
   When a task is in **Needs approval**, Approve.
6. **Documents** — upload a `.txt`, wait for `ready`, ask Chat with
   `search_documents`.
7. **Evals** — pick an agent with cases, **Run eval**.
8. **Usage / Guardrails / Automations** — pages load live data, not empty
   stubs. Guardrails scan flags injection/PII without an LLM.
9. Browser console: no `localhost:8000`, no CORS errors.

CI already fails the PR if those API surfaces are missing
(`demo-smoke` + `test_demo_feature_surface.py`).

---

## When it breaks

| Symptom | Cause |
|---|---|
| Sign-in works, client pages empty / 401 | `AUTH_SECRET` mismatch, **or** Auth.js Credentials JWT missing `email` (fixed in `apps/web/auth.ts` jwt/session callbacks) |
| Chat works, missions/agents/evals do not | Browser calling `localhost:8000` (`NEXT_PUBLIC_API_URL` baked). Leave `PUBLIC_API_URL` unset; use `/backend` + `INTERNAL_API_URL` |
| `/runs` `/workflows` `/documents` 500 missing relation | `RUN_MIGRATIONS_ON_BOOT` ignored by the image, or schema `search_path` wrong (`DATABASE_SCHEMA`) |
| SSL errors against Supabase pooler | `DATABASE_SSL=1` (require-style). `asyncpg ssl=True` is verify-full and fails |
| Publish 403 on a built-in agent | Expected. Use **Demo sandbox agent** or **New agent** |
| Demo login button missing | `DEMO_LOGIN_ENABLED` not `1` on **web** |
| Seeded missions empty | `SEED_DEMO_DATA=1` and `scripts.seed_demo` must run after migrate |
| Space/container first request slow | Cold start. UI banner says so |

**Rebuilding matters:** the Container image and the HF Space clone GitHub at
**build** time. Merging a PR does not move production until you rebuild.
