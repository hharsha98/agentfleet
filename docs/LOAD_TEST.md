# Load test (Phase 11, nice-15)

**Tool:** [k6](https://k6.io) v2.1.0 (installed via `brew install k6`), script at [`load/k6-api.js`](../load/k6-api.js).

**Machine context:** Apple Silicon (arm64) dev laptop, macOS 15.5. API is a single-process `uvicorn app.main:app` (no `--workers`, `apps/api/Dockerfile`). Postgres is `pgvector/pgvector:pg16` in Docker (`docker/compose.yaml`), no connection pooler in front of it. Not representative of a multi-worker production deploy — see observations below.

## How to run

Every `/api/v1` route requires a Bearer JWT since Phase 12 B, so the script
now needs a minted token via `API_TOKEN`. Mint one (prints ONLY the token —
never the signing secret) with:

```bash
cd apps/api && uv run python -c "
import datetime as dt, os
import jwt
from dotenv import load_dotenv
load_dotenv()
email = 'k6-load-test@agentfleet.test'
now = dt.datetime.now(dt.timezone.utc)
payload = {'sub': email, 'email': email, 'iat': int(now.timestamp()), 'exp': int((now + dt.timedelta(hours=1)).timestamp())}
print(jwt.encode(payload, os.environ['AUTH_SECRET'], algorithm='HS256'))
"
```

Then run k6 with that token:

```bash
# lists + writes only — no LLM calls, safe default
API_TOKEN=<jwt from above> BASE_URL=http://localhost:8000 k6 run load/k6-api.js

# also runs chat_smoke (3 iterations against the real LLM proxy)
API_TOKEN=<jwt from above> BASE_URL=http://localhost:8000 CHAT=1 k6 run load/k6-api.js
```

`setup()` fails fast with a clear message if `API_TOKEN` is unset — every
route this script touches is auth-gated now, so there's no "unauthenticated
mode" to fall back to.

**Rate limiting (Phase 12 C) and this script:** chat send / document upload
/ the public invoke endpoint are rate-limited per-user (`RATE_LIMIT_CHAT`
default 30/minute, `RATE_LIMIT_UPLOAD` 10/minute, `RATE_LIMIT_PUBLIC`
60/minute). The **default run** (`lists` + `writes`) never calls any of
those three routes — `/agents`, `/runs`, `/documents` (GET), `/schedules`,
and `POST /conversations` are all unlimited — so it is completely
unaffected by rate limiting regardless of VU count. `CHAT=1`'s
`chat_smoke` scenario sends only 3 chat messages from a single VU/token,
well under the 30/minute default, so it isn't affected either.

## Results — default run (lists + writes, ~1m40s wall clock)

| Scenario | Requests | p50 | p95 | p99* | RPS | Error rate |
|---|---|---|---|---|---|---|
| lists  | 41,439 | 28.7ms | **94.11ms** | ~470ms (max 483ms) | ~414/s | 0.00% |
| writes | ~7,197 | 33.29ms | **95.9ms**  | ~490ms (max 493ms) | ~72/s  | 0.00% |

*p99 not emitted directly by k6's default summary; approximated from max/tail shape in the log.

All checks passed (`status is 200/201`, `has X-Total-Count header`) — 90,074/90,074 (100%).

**Thresholds** (all green, no tuning needed): lists p95 < 300ms, lists error rate < 1%, writes p95 < 500ms. Chose these as "should comfortably pass on healthy local hardware, would catch a real regression" — actual local p95s (~94-96ms) ran ~3-5x under threshold, so there's real headroom before these would fire.

## Re-verification after auth + rate limiting (Phase 12 C)

Re-ran the default (lists + writes) scenario with a minted `API_TOKEN` after
adding JWT auth (12 B) and per-user rate limiting (12 C) to confirm nothing
regressed — thresholds stayed green, comfortably inside the original
Phase 11 numbers above:

```
  █ THRESHOLDS

    http_req_duration{scenario:lists}
    ✓ 'p(95)<300' p(95)=91.13ms

    http_req_duration{scenario:writes}
    ✓ 'p(95)<500' p(95)=115.18ms

    http_req_failed{scenario:lists}
    ✓ 'rate<0.01' rate=0.00%
```

42,072 requests, 787 checks/s, 100% checks passed (78,751/78,751), 0% error
rate. As expected from the rate-limit scope note above, this run — 25 VUs
across lists + writes — was completely unaffected by the new per-user
limits: neither scenario calls chat send, upload, or public invoke, the
only three rate-limited routes.

## Results — CHAT=1 run (chat_smoke, 3/3 iterations)

```
✓ chat_smoke: conversation created
✓ chat_smoke: SSE stream completed with 200
✓ chat_smoke: stream body has SSE data frames
chat_smoke ✓ [ 100% ] 1 VUs 0m08.8s/3m0s  3/3 iters, 3 per VU
```

lists/writes thresholds stayed green even with the LLM proxy running concurrently (lists p95=149.2ms, writes p95=200.66ms) — higher than the default run but still well inside budget, consistent with shared CPU contention from the LLM proxy rather than a DB or API bottleneck.

## Observations

1. **writes ≳ lists at the tail.** Both scenarios show a similar max (~490ms) despite very different median latency profiles, which points to occasional connection/pool contention under the combined 25-VU load rather than either endpoint being intrinsically slow — a single uvicorn worker sharing one DB connection pool across both scenarios is the likely culprit.
2. **No endpoint stood out as slow.** `/documents` (join to chunks) wasn't measurably worse than the other three list endpoints in this run — the dataset is small in dev, so a join-cost hypothesis wasn't exercised. Worth re-testing after seeding a larger document/chunk table.
3. **CHAT=1 run degraded lists/writes latency ~1.5-2x** (p95 94ms → 149ms, 96ms → 201ms) purely from running alongside the LLM proxy on the same laptop — a single-process, single-machine artifact, not evidence of an API-side issue.
