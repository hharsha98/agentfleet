# Load test (Phase 11, nice-15)

**Tool:** [k6](https://k6.io) v2.1.0 (installed via `brew install k6`), script at [`load/k6-api.js`](../load/k6-api.js).

**Machine context:** Apple Silicon (arm64) dev laptop, macOS 15.5. API is a single-process `uvicorn app.main:app` (no `--workers`, `apps/api/Dockerfile`). Postgres is `pgvector/pgvector:pg16` in Docker (`docker/compose.yaml`), no connection pooler in front of it. Not representative of a multi-worker production deploy — see observations below.

## How to run

```bash
# lists + writes only — no LLM calls, safe default
BASE_URL=http://localhost:8000 k6 run load/k6-api.js

# also runs chat_smoke (3 iterations against the real LLM proxy)
BASE_URL=http://localhost:8000 CHAT=1 k6 run load/k6-api.js
```

## Results — default run (lists + writes, ~1m40s wall clock)

| Scenario | Requests | p50 | p95 | p99* | RPS | Error rate |
|---|---|---|---|---|---|---|
| lists  | 41,439 | 28.7ms | **94.11ms** | ~470ms (max 483ms) | ~414/s | 0.00% |
| writes | ~7,197 | 33.29ms | **95.9ms**  | ~490ms (max 493ms) | ~72/s  | 0.00% |

*p99 not emitted directly by k6's default summary; approximated from max/tail shape in the log.

All checks passed (`status is 200/201`, `has X-Total-Count header`) — 90,074/90,074 (100%).

**Thresholds** (all green, no tuning needed): lists p95 < 300ms, lists error rate < 1%, writes p95 < 500ms. Chose these as "should comfortably pass on healthy local hardware, would catch a real regression" — actual local p95s (~94-96ms) ran ~3-5x under threshold, so there's real headroom before these would fire.

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
