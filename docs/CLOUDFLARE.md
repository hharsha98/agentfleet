# Deploying AgentFleet on Cloudflare

Goal: a URL a stranger can open and use — chat, missions, the same FastAPI
app as local/K8s — not a screenshot gallery.

The **free-tier** path (no card) stays [DEPLOY.md](DEPLOY.md): Neon + Hugging
Face Spaces (API) + Vercel (web). This file is an **additional** path that
runs the API as a Cloudflare Container and the web as an OpenNext Worker
named `agentfleet-app`.

It is not a rewrite. D1 cannot replace pgvector. Hyperdrive does not work
inside Containers ([cloudflare/containers#97](https://github.com/cloudflare/containers/issues/97)).
Workers AI is optional and only as another OpenAI-compatible base URL.

---

## What gets deployed

| Piece | Cloudflare resource | Project name | Why this shape |
|---|---|---|---|
| Web (Next.js 16 App Router + Auth.js) | Worker via [OpenNext](https://opennext.js.org/cloudflare) | **`agentfleet-app`** | Pages' Next.js preset is **static HTML export**. This app mints JWTs, runs server components, and cannot be exported. |
| API (FastAPI) | Container + a thin Worker proxy | **`agentfleet-api`** | The existing Docker image, `ORCHESTRATOR_MODE=inprocess` (no Redis). |
| Postgres + pgvector | **Supabase** (existing project, schema `agentfleet`) | `koyhzzyzxcalyzruhgqw` | Talk TLS from the container. Do not use D1. Do not use Hyperdrive. |

Do **not** deploy either of these over:

- Pages project **`agentfleet-gallery`** (`https://agentfleet-gallery.pages.dev`) — static recruiter gallery
- Worker **`agentic-systems-studio`** / DNS **agentic-systems-studio.com**
- Pages projects `cursor-harsha-profile-pages` / `harsha-ai`

---

## Plan requirement

Cloudflare Containers are **Workers Paid only**. The API image is ~205 MB
imported and **~507 MB** once fastembed is resident. Instance type
`lite` (256 MiB) will OOM; `basic` (1 GiB) is tight; this repo pins
`standard-1` (4 GiB).

If `wrangler deploy` from `deploy/cloudflare/` fails because the account is
free, or because Containers are blocked, **stop**. Do not fake an API. Leave
the `agentfleet-app` frontend wired to the public API URL and keep using the
Hugging Face Space from [DEPLOY.md](DEPLOY.md) as the API.

Typical wrangler errors (exact text varies by CLI version — paste yours into
the PR/deploy notes, do not invent a green URL):

```
Workers Paid plan required to use containers
Cannot deploy containers on this account
Authentication error [code: 10000]
You are not authenticated. Please run wrangler login.
The Docker CLI is needed to build the configured image before deploying
```

Do **not** use `wrangler deploy --containers-rollout=none` as a workaround: that
ships the proxy Worker without an API process. The proxy then has nothing to
forward to. Use the Hugging Face Space from [DEPLOY.md](DEPLOY.md) instead.

---

## 1. Database — existing Supabase (pgvector)

This deploy uses the already-running Supabase project, **not** a new Neon
database and not D1:

| | |
|---|---|
| Name | hharsha98's Project |
| Ref | `koyhzzyzxcalyzruhgqw` |
| Region | `eu-west-1` (Ireland) |
| Engine | Postgres 17 (`ACTIVE_HEALTHY`) |
| Direct host | `db.koyhzzyzxcalyzruhgqw.supabase.co` — **IPv6-only** (no IPv4 route from a typical Mac) |
| Working session pooler | `aws-1-eu-west-1.pooler.supabase.com` port **5432** |
| Username | `agentfleet_cf.koyhzzyzxcalyzruhgqw` (the `.projectref` suffix is required) |
| Database | `postgres` |
| App schema | **`agentfleet`** (not `public`) — already at Alembic head `b51d0f1cf233` (18 tables) |

`vector` is already installed in the `extensions` schema. The `agentfleet`
schema exists and is **not** granted to `anon` / `authenticated`, so it
does not collide with other `public` tables and is not on the Data API.
The API sets `search_path` to `agentfleet,extensions,public` so unqualified
`vector` types and app tables resolve without touching anyone else's
`public` objects.

### Observed hosts (do not guess a different pooler)

Tried from a laptop against this project; do not invent a substitute:

| Host | Result |
|---|---|
| `db.koyhzzyzxcalyzruhgqw.supabase.co` | IPv6-only. No route from this Mac. |
| `aws-0-eu-west-1.pooler.supabase.com` | Auth error: `tenant/user ... not found` for this project. |
| `aws-1-eu-west-1.pooler.supabase.com:5432` | **Works** (session mode). |
| `aws-1-eu-west-1.pooler.supabase.com:6543` | Also authenticated (transaction mode). **Do not use** — asyncpg prepared statements break on transaction-mode poolers. |

### DSN

```
postgresql+asyncpg://agentfleet_cf.koyhzzyzxcalyzruhgqw:YOUR_PASSWORD@aws-1-eu-west-1.pooler.supabase.com:5432/postgres
```

1. **Drop** `?sslmode=require` — asyncpg rejects that query parameter.
2. Enable TLS with `DATABASE_SSL=1` (already a wrangler `var`). That flag
   matches libpq `sslmode=require`: encrypt, **do not** verify CA or
   hostname. `asyncpg ssl=True` is verify-full and fails against this
   pooler (`SSLCertVerificationError: self-signed certificate in
   certificate chain`, chain rooted at self-signed `Supabase Root 2021
   CA`). Bundling the official Supabase CA then failed with `CA cert does
   not include key usage extension`. psycopg already used `sslmode=require`
   and that path worked.
3. Do **not** commit `YOUR_PASSWORD`. Put the URI in
   `deploy/cloudflare/.dev.vars` (gitignored) and
   `wrangler secret put DATABASE_URL`.

The API container connects to that host **over TLS directly**. Hyperdrive is
a Worker-side pooler and does not work inside Containers
([cloudflare/containers#97](https://github.com/cloudflare/containers/issues/97)).
Do not add a Hyperdrive binding to this Worker.

`ORCHESTRATOR_MODE=inprocess` stays on: no Redis, no arq worker. Mission
DAGs run inside the API process.

Schema `agentfleet` is already migrated to Alembic head `b51d0f1cf233`
(18 tables). `RUN_MIGRATIONS_ON_BOOT=1` should be a no-op besides the
non-fatal `CREATE EXTENSION IF NOT EXISTS vector`.

---

## 2. Generate one shared `AUTH_SECRET`

```bash
openssl rand -base64 32
```

Put the **same bytes** on the API Worker (`wrangler secret put AUTH_SECRET`
in `deploy/cloudflare/`) **and** the web Worker (`npx wrangler secret put AUTH_SECRET`
in `apps/web/`). The Next.js app mints an HS256 JWT; the API verifies it.
Mismatch → sign-in appears to work, every API call is 401.

---

## 3. API — Cloudflare Container (`agentfleet-api`)

Requires: Docker (wrangler builds `apps/api/Dockerfile`), Workers Paid,
`wrangler login`.

```bash
cd deploy/cloudflare
npm install
cp .dev.vars.example .dev.vars   # fill DATABASE_URL, AUTH_SECRET, FREE_LLM_*
chmod +x put-secrets.sh
./put-secrets.sh
npx wrangler deploy
```

Wrangler prints a workers.dev URL, for example
`https://agentfleet-api.<your-subdomain>.workers.dev`. That is the public
API URL. Confirm `/health` after the first container boot (migrations +
demo seed; can take a couple of minutes).

### API env (Worker `vars` + secrets)

Secrets (`wrangler secret put` / `.dev.vars` locally):

| Name | Purpose |
|---|---|
| `DATABASE_URL` | Session-pooler DSN above (password not in git) |
| `AUTH_SECRET` | Shared with web, byte-identical |
| `FREE_LLM_BASE_URL` | OpenAI-compatible endpoint |
| `FREE_LLM_KEY` | Provider key |

`wrangler.jsonc` `vars` (already set in repo — override if needed):

| Name | Value |
|---|---|
| `ORCHESTRATOR_MODE` | `inprocess` |
| `DEMO_LOGIN_ENABLED` | `1` |
| `SEED_DEMO_DATA` | `1` |
| `RUN_MIGRATIONS_ON_BOOT` | `1` (schema already at `b51d0f1cf233`; no-op besides non-fatal `CREATE EXTENSION`) |
| `DEFAULT_MODEL` | `openai/gpt-oss-120b` |
| `EMBEDDINGS_PREWARM` | `1` |
| `DATABASE_SCHEMA` | `agentfleet` |
| `DATABASE_SSL` | `1` (libpq `require`: encrypt, no CA/hostname verify) |
| `CORS_ORIGINS` | web origin(s), comma-separated — fill after step 4, then redeploy the API Worker (vars, not a rebuild of the image) |

The proxy Worker refuses to start a container if the four secrets are
missing; it returns JSON `503 api_not_configured` instead of a crash loop.

### LLM: keep the existing provider

`FREE_LLM_BASE_URL` / `FREE_LLM_KEY` are unchanged. Optional Workers AI
fallback is the same abstraction: Workers AI exposes an OpenAI-compatible
API, so point the existing client at it — do not add a second provider
stack.

```
FREE_LLM_BASE_URL=https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/ai/v1
FREE_LLM_KEY=<cloudflare-api-token-with-workers-ai>
DEFAULT_MODEL=@cf/meta/llama-3.1-8b-instruct
```

Tool-calling quality varies by model; the eval suite is the gate, not this
file.

---

## 4. Web — OpenNext Worker `agentfleet-app`

Root directory: **`apps/web`**. Project name: **`agentfleet-app`**.

OpenNext is pinned to **1.19.11** (`apps/web/package.json`). 1.20.x requires
Next `>=16.3.3`; this app is on **16.2.11**. Do not bump `@opennextjs/cloudflare`
to latest until Next is bumped too.

```bash
cd apps/web
npm install
# Build-time: NEXT_PUBLIC_* is inlined. Same trap as DEPLOY.md.
export NEXT_PUBLIC_API_URL=https://agentfleet-api.<your-subdomain>.workers.dev
export INTERNAL_API_URL="$NEXT_PUBLIC_API_URL"
export NEXT_PUBLIC_SITE_URL=https://agentfleet-app.<your-subdomain>.workers.dev
export AUTH_URL="$NEXT_PUBLIC_SITE_URL"
export AUTH_SECRET='<the same secret as the API>'
export DEMO_LOGIN_ENABLED=1
export AUTH_TRUST_HOST=true
export OPEN_NEXT=1

npx wrangler secret put AUTH_SECRET   # paste the same secret
npm run cf:deploy
```

Wrangler prints `https://agentfleet-app.<your-subdomain>.workers.dev`.

### Why this is not a Pages static upload

| Path | Use when |
|---|---|
| OpenNext → Worker `agentfleet-app` | This repo (App Router, Auth.js, SSR) |
| Pages static export | Marketing sites with `output: 'export'` |
| Existing Pages `agentfleet-gallery` | Screenshots only — do not overwrite |

Cloudflare's current Next.js guide sends full apps to Workers (OpenNext /
vinext). A `.pages.dev` hostname is **not** created by `npm run cf:deploy`.
If you later attach a custom domain in the dashboard, do not retarget
`agentic-systems-studio.com`.

### Web env

| Name | When | Notes |
|---|---|---|
| `AUTH_SECRET` | runtime secret | Byte-identical with API |
| `AUTH_URL` | wrangler `vars` + build | Public web URL |
| `AUTH_TRUST_HOST` | wrangler `vars` | `true` on workers.dev |
| `DEMO_LOGIN_ENABLED` | wrangler `vars` | `1` |
| `INTERNAL_API_URL` | wrangler `vars` **and** build | Server components |
| `NEXT_PUBLIC_API_URL` | **build time** | Browser `apiFetch()` |
| `NEXT_PUBLIC_SITE_URL` | **build time** | `metadataBase` / OG cards |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | optional | Demo login works without Google |

**Both API URL variables are required, and they are not interchangeable.**
`apps/web/lib/api.ts`: server components use `INTERNAL_API_URL`; the
browser uses `NEXT_PUBLIC_API_URL` (fallback `http://localhost:8000`).
On this deploy they are the **same public API URL**. Set only
`INTERNAL_API_URL` and the chat UI talks to the visitor's laptop.

`NEXT_PUBLIC_*` is baked at build. Changing a var in the dashboard without
`npm run cf:deploy` does nothing.

---

## 5. Close the loop

1. API `CORS_ORIGINS` = the web origin from step 4. Update
   `deploy/cloudflare/wrangler.jsonc` `vars` (or dashboard vars) and
   `npx wrangler deploy` the API Worker again. No image rebuild needed.
2. Optional Google OAuth: authorised redirect
   `https://<web-url>/api/auth/callback/google`.

---

## 6. Verify the way a stranger would

Private window, no session:

- [ ] Landing page loads on the `agentfleet-app` URL.
- [ ] Demo login works without Google.
- [ ] `/missions` shows seeded demo missions.
- [ ] `/chat` — send one message, get a streamed reply.
- [ ] `/agents` lists the built-in roster.
- [ ] Browser console: no CORS errors, no calls to `localhost:8000`.
- [ ] First request after idle may be slow (container `sleepAfter` 15m).
      The UI already says the API may be waking.

---

## Cloudflare extras vs Useful Agents (GCP)

[useful-agents.com](https://useful-agents.com) runs on GKE Autopilot + Cloud
SQL + Redis. AgentFleet on Cloudflare is the same *product* (chat, DAG
missions, RAG, MCP, evals), with these Cloudflare pieces closing that infra
gap. They are **not** required to get a stranger onto demo login; the first
deploy is Container `standard-1` + Supabase + in-process orchestrator.

| GCP (Useful Agents) | Cloudflare extra | What it replaces / adds | First deploy? |
|---|---|---|---|
| GKE Autopilot pods | **Workers Paid Containers `standard-1`** (4 GiB) | Runs the real FastAPI image. `lite` (256 MiB) OOMs; measured RSS is ~507 MB with fastembed. | **Yes** — pinned in `wrangler.jsonc` |
| Cloud SQL Postgres | **Supabase** session pooler `aws-1-eu-west-1.pooler.supabase.com:5432`, schema `agentfleet` | pgvector, TLS from the container (`DATABASE_SSL=1` = libpq require). Not D1, not Hyperdrive. Direct `db.*.supabase.co` is IPv6-only. | **Yes** |
| Redis / arq workers | **Queues + Workflows** | Durable DAG steps if you outgrow `ORCHESTRATOR_MODE=inprocess` (a run currently dies if the container sleeps mid-mission). Wire a Workflow around `POST /api/v1/runs` later; do not turn Redis on inside the container for v1. | No — keep `inprocess` |
| GCS / disk uploads | **R2** | Original file blobs. Today ingest stores chunks + embeddings in Postgres (5 MB cap). R2 is the place for larger artifacts / raw PDFs without stuffing `public` or the container's ephemeral disk. | No |
| Provider sprawl / retries | **AI Gateway** | Front `FREE_LLM_BASE_URL` with `https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/…` so logging, caching, and provider failover sit in one place. Still OpenAI-compatible — no second client. | Optional |
| VPC + Memorystore | (none) | Container `enableInternet=true` reaches Supabase and the LLM endpoint over TLS. | — |

Do **not** overwrite Pages project **`agentfleet-gallery`**. These extras
belong on `agentfleet-app` / `agentfleet-api` only.

---

## Fallback: Pages frontend + HF Spaces API

If Containers cannot deploy, you can still ship a usable demo:

1. Keep the Space from [DEPLOY.md](DEPLOY.md) as the API.
2. Point `NEXT_PUBLIC_API_URL` and `INTERNAL_API_URL` at the Space URL.
3. Deploy only `agentfleet-app` (OpenNext).
4. Set Space `CORS_ORIGINS` to the `agentfleet-app` origin.

That is a real chat/missions demo. It is not "AgentFleet running on
Cloudflare Containers."

---

## Local preview

```bash
# API proxy + container (needs Docker)
cd deploy/cloudflare && cp .dev.vars.example .dev.vars && npx wrangler dev

# Web in the Workers runtime (needs a prior cf:build)
cd apps/web && npm run cf:preview
```

`next dev` on port 3002 is unchanged and still the day-to-day loop.

---

## File map

| Path | Role |
|---|---|
| `deploy/cloudflare/wrangler.jsonc` | API Worker + Container |
| `deploy/cloudflare/src/index.ts` | Proxy (pass-through, no app rewrite) |
| `apps/api/Dockerfile` | Image wrangler builds (`image` path in wrangler.jsonc) |
| `apps/api/app/db_connect.py` | `DATABASE_SCHEMA` + `DATABASE_SSL` connect args |
| `apps/api/tests/test_db_connect.py` | Offline schema/TLS connect-arg tests |
| `apps/web/wrangler.jsonc` | OpenNext Worker `agentfleet-app` |
| `apps/web/open-next.config.ts` | OpenNext adapter |
| `docs/DEPLOY.md` | Free-tier Spaces + Vercel (kept) |
