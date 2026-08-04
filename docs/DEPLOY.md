# Deploying AgentFleet publicly (free tier)

Goal: a URL you can put at the top of the README, that a stranger can open and
use without cloning anything.

**Three services, all free, no card required:**

| Piece | Where | Why this one |
|---|---|---|
| Postgres + pgvector | **Neon** | pgvector on the free tier; scales to zero |
| API (FastAPI) | **Hugging Face Spaces** | 2 vCPU / **16 GB RAM** free |
| Web (Next.js) | **Vercel** | first-party Next.js host, generous free tier |

**No Redis.** Set `ORCHESTRATOR_MODE=inprocess`; the orchestrator already falls
back to in-process execution when Redis is unreachable.

### Why Spaces, and not Fly or Render

Measured on this codebase: the API is **~205 MB** with everything imported, and
**~507 MB** once the fastembed embedding model is resident.

- Fly.io **no longer has a free tier** (2 VM-hours trial only, as of 2026).
- Render free is **512 MB** — the app would sit at 509 MB with zero headroom and
  OOM under any real use.
- Free CPU Spaces give **16 GB**, so RAG works instead of crashing.

The Space sleeps after prolonged inactivity and takes a few seconds to wake.

---

## Before you start

**These steps need your accounts and your credentials, so they are yours to do.**
Everything in the repo is already prepared.

Decide one thing first: **make the GitHub repo public.** The Space's Dockerfile
clones it at build time — and more importantly, a private repo means a hiring
manager cannot read your code at all. The history has been scanned: `.env` was
never committed, and there are zero matches for Google client secrets, OAuth
client IDs, Anthropic/OpenAI keys, `AUTH_SECRET` values, or AWS keys across every
commit.

To keep it private instead, supply a GitHub token as a build secret and adjust
`SOURCE_REPO` in the Space Dockerfile.

---

## 1. Database — Neon

1. Create a project at **neon.tech**. Pick a region near you.
2. Copy the connection string. It looks like
   `postgresql://user:pass@ep-xxx.region.aws.neon.tech/neondb?sslmode=require`.
3. **Rewrite the scheme** for this app: `postgresql://` → `postgresql+asyncpg://`,
   and drop `?sslmode=require` — asyncpg rejects that parameter and negotiates TLS
   itself. Keep everything else byte-identical:

   ```
   postgresql+asyncpg://user:pass@ep-xxx.region.aws.neon.tech/neondb
   ```

You do **not** need to create tables or the `vector` extension by hand. The
Space's entrypoint runs `CREATE EXTENSION IF NOT EXISTS vector` and
`alembic upgrade head` on boot.

## 2. Generate one shared auth secret

```bash
openssl rand -base64 32
```

Keep it. It goes into **both** the Space and Vercel, byte-identical.

> This is the most common way this deploy breaks. The Next.js app *mints* an HS256
> JWT; the API *verifies* it with the same secret. Mismatch it and sign-in appears
> to work while every API call returns 401. A blank secret fails loudly (503); a
> wrong one fails silently.

## 3. API — Hugging Face Space

1. **huggingface.co → New Space.** SDK **Docker** (blank template), hardware
   **CPU basic (free)**, visibility **Public**.
2. The Space is a git repo. Put **two files** in it, both from `deploy/hfspace/`:
   - `Dockerfile`
   - `README.md` — its YAML frontmatter is what configures the Space
3. **Settings → Variables and secrets:**

   | Name | Kind | Value |
   |---|---|---|
   | `DATABASE_URL` | secret | the rewritten Neon DSN from step 1 |
   | `AUTH_SECRET` | secret | the value from step 2 |
   | `FREE_LLM_BASE_URL` | secret | your provider endpoint |
   | `FREE_LLM_KEY` | secret | your provider key |
   | `CORS_ORIGINS` | variable | your Vercel URL — fill after step 4, then rebuild |
   | `DEFAULT_MODEL` | variable | `openai/gpt-oss-120b` |
   | `ORCHESTRATOR_MODE` | variable | `inprocess` |
   | `DEMO_LOGIN_ENABLED` | variable | `1` |
   | `SEED_DEMO_DATA` | variable | `1` |

4. Watch the build log — the first build is slow, because it installs deps and
   bakes in the ~130 MB embedding model. Then check the boot log for
   `[boot] pgvector ready`, `[boot] applying migrations`, `[boot] starting API`.
5. The API is at `https://<user>-<space>.hf.space`. Confirm `/health` responds.

## 4. Web — Vercel

1. **vercel.com → New Project → import the GitHub repo.**
2. **Root directory: `apps/web`** — Vercel detects Next.js from there.
3. Environment variables:

   | Name | Value |
   |---|---|
   | `AUTH_SECRET` | same as the Space, byte-identical |
   | `AUTH_URL` | your Vercel URL, e.g. `https://agentfleet.vercel.app` |
   | `AUTH_GOOGLE_ID` | from Google console |
   | `AUTH_GOOGLE_SECRET` | from Google console |
   | `INTERNAL_API_URL` | your Space URL from step 3 |
   | `DEMO_LOGIN_ENABLED` | `1` |

4. Deploy, then note the final URL.

## 5. Close the loop

Two values could only be filled once both sides existed:

1. **Space → `CORS_ORIGINS`** = your Vercel URL. Save, then **Factory rebuild**.
   Without this the browser blocks every API call.
2. **Google Cloud console → Credentials → your OAuth client → Authorised redirect
   URIs**, add:
   ```
   https://<your-vercel-url>/api/auth/callback/google
   ```
   Keep the localhost entry — Google allows several.

## 6. Verify the way a stranger would

In a private window, with no session:

- [ ] The landing page loads.
- [ ] The **demo login** works without Google.
- [ ] `/missions` shows seeded demo missions, not an empty board.
- [ ] `/chat` — send one message, get a streamed reply.
- [ ] `/agents` lists the built-in roster.
- [ ] `/usage` shows non-zero token and cost figures.
- [ ] Browser console: no CORS errors.
- [ ] Let the Space sleep, then reload — the UI says the API is waking rather than
      showing a broken screen.

## 7. Then put the link where it counts

Top of `README.md`, above the badges. A reviewer who sees a working URL in the
first line reads everything after it differently.

---

## When it breaks

| Symptom | Cause |
|---|---|
| Sign-in works, every API call 401s | `AUTH_SECRET` differs between Vercel and the Space |
| API calls blocked in the browser console | `CORS_ORIGINS` missing the Vercel origin, or set but not rebuilt |
| `redirect_uri_mismatch` on Google | production callback URL not registered (step 5.2) |
| Space build fails at the clone | repo is private and no token was supplied |
| Missing relation / catalog errors | migrations did not run — read the boot log |
| asyncpg rejects the DSN | `?sslmode=require` left on, or scheme is not `postgresql+asyncpg://` |
| First request very slow | Space waking from sleep. Expected; the UI says so |

**Rebuilding matters:** the Space clones GitHub at build time, so pushing to
GitHub does **not** redeploy it. Use Factory rebuild, or pin `SOURCE_REF` to a tag
for a reproducible deploy.
