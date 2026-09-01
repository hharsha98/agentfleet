# AgentFleet on Kubernetes (local cluster)

For a local kind/k3d/minikube cluster.

> **Status (2026-08-03) — read this before trusting the manifests below.**
> These were written as a demo artifact and, until now, were **never applied
> anywhere and never validated in CI**. That showed: two defects meant the stack
> could not actually serve traffic.
>
> - `SEARXNG_URL` pointed at a Service that does not exist under `k8s/` (compose
>   has one; these manifests never did). `web_search` degrades to "no results"
>   rather than crashing, so it failed *quietly* — worse than failing loudly.
> - `FREE_LLM_BASE_URL` was `http://localhost:3001/v1`, a host-machine dev proxy
>   address. Inside a pod, `localhost` is the pod, so every LLM call failed.
>
> A third: this file claimed `ORCHESTRATOR_MODE=arq` was set on **both** `api` and
> `worker`. It was set only on `worker`, so the API ran missions in-process while
> an idle worker polled an empty queue. That one is **fixed** — `k8s/api.yaml` now
> sets it, and the two defects above are annotated in place there.
>
> These manifests are being reworked into `base/` + `overlays/{kind,gke}` and wired
> into CI against a kind cluster, so "it deploys" becomes a check on every push
> instead of a claim in a README. Until that lands, read this page as a description
> of work in progress.

> **Status (2026-09-01) — the base/overlays rework landed; CI did not.**
> The restructure promised in the block above is done, with two corrections to
> what it predicted:
>
> - The overlays are named `overlays/dev` and `overlays/prod`, not
>   `overlays/{kind,gke}` — there is still only ever one real target (a local
>   kind/k3d/minikube cluster), so "dev" vs "prod" means "replica count and a
>   PodDisruptionBudget", not separate cloud targets. See
>   `overlays/prod/kustomization.yaml` for the honest version of that
>   distinction.
> - CI-against-a-kind-cluster is still **not wired up**. Nothing in this
>   rework touched CI, and nothing here has been `kubectl apply`'d against a
>   real cluster — the Docker daemon was unavailable in the environment this
>   work was done in, so `docker build`/`kind load`/`kubectl apply` could not
>   be run or verified. What *was* run and is safe to trust: `kubectl
>   kustomize k8s/overlays/dev` and `kubectl kustomize k8s/overlays/prod`
>   both render cleanly (no cluster needed for that). Treat everything below
>   as unverified against a live cluster until someone runs it end-to-end.
>
> What actually changed, layout-wise: the flat `k8s/*.yaml` files moved to
> `k8s/base/*.yaml` (via `git mv`, history preserved) unchanged in behavior,
> plus:
>
> - Every Deployment/Job pod now sets `runAsNonRoot`, `runAsUser: 1000`,
>   `runAsGroup: 1000`, `fsGroup: 1000`, and a `RuntimeDefault` seccomp
>   profile at the pod level, and `allowPrivilegeEscalation: false`,
>   `readOnlyRootFilesystem: true`, and `capabilities: {drop: [ALL]}` on every
>   container. UID/GID 1000 matches `apps/api/Dockerfile` and
>   `apps/web/Dockerfile`'s own `app` user exactly (hardened in the same
>   effort this rework was part of). It does **not** necessarily match
>   `postgres.yaml`/`redis.yaml`'s third-party images, which is called out as
>   an explicit, unverified risk in a comment on each of those two files —
>   read it before relying on either in a real cluster.
> - `readOnlyRootFilesystem: true` needed a writable `emptyDir` wherever a
>   container genuinely writes at runtime: the fastembed model cache for
>   `api`/`worker` (that model downloads at runtime rather than being baked
>   in — see `deploy/hfspace/Dockerfile` for the one image that does bake it
>   in, and why), Next.js's on-disk fetch cache for `web`, and Postgres's
>   unix-socket directory plus `/tmp` for `postgres`. Each mount has a
>   comment on the container that needs it explaining why.
> - Every container now has `resources.requests`/`resources.limits`. The
>   `api`/`worker` numbers are derived from the one real measurement on
>   record anywhere in this repo — `deploy/hfspace/Dockerfile`'s header
>   comment ("~205MB imported, ~507MB once the fastembed model is
>   resident") — with the arithmetic spelled out in a comment on
>   `base/api.yaml` and `base/worker.yaml`. `postgres`/`redis`/`web`/`migrate`
>   have no equivalent measurement anywhere in the repo; their numbers are
>   flagged in-file as conservative, commonly-used defaults, not
>   measurements — replace them with real `kubectl top pod` numbers once a
>   cluster exists to measure against.
> - `api.yaml`'s existing two probes (`/health/ready`, `/health`) are
>   unchanged. `web.yaml` gained the same shape of probe, reusing the `/`
>   path `apps/web/Dockerfile`'s own `HEALTHCHECK` already treats as "the app
>   is up" (there's no dedicated health route to point at instead — a good
>   follow-up). `worker.yaml` deliberately has **no** probe: it has no HTTP
>   server, and the one genuinely meaningful option — arq's built-in
>   `--check` health-check CLI — could not be verified end-to-end without a
>   running cluster, so it's left as a documented gap in a comment rather
>   than an untested probe that could kill a worker mid-mission on a false
>   positive.

Deploys 5 workloads: `postgres`, `redis`, `api`, `worker`, `web`. `worker` reuses
the `agentfleet-api:local` image (no separate build) and runs
`arq app.worker.WorkerSettings` instead of `uvicorn`, so mission runs execute
durably and survive an `api` pod restart (see ARCHITECTURE.md ADR-004).

Layout:

```
k8s/
├── base/               # the 5 workloads + namespace + secret template
│   └── kustomization.yaml
└── overlays/
    ├── dev/            # 1 replica each (matches base's own defaults)
    │   └── kustomization.yaml
    └── prod/           # api/worker/web at 2 replicas + a PodDisruptionBudget
        ├── kustomization.yaml
        └── pdb.yaml
```

`base/` is not applied directly — always target an overlay.

## 1. Build images

```bash
docker build -t agentfleet-api:local apps/api
docker build -t agentfleet-web:local --build-arg NEXT_PUBLIC_API_URL=http://localhost:8000 apps/web
```

## 2. Load images into the cluster

```bash
kind load docker-image agentfleet-api:local agentfleet-web:local
# k3d: k3d image import agentfleet-api:local agentfleet-web:local
# minikube: minikube image load agentfleet-api:local agentfleet-web:local
```

## 3. Create the secret (real keys — never commit)

```bash
set -a; source .env; set +a
kubectl create namespace agentfleet --dry-run=client -o yaml | kubectl apply -f -
kubectl create secret generic agentfleet-secrets --namespace agentfleet \
  --from-literal=FREE_LLM_KEY="$FREE_LLM_KEY" \
  --from-literal=ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" \
  --from-literal=PLANNER_MODEL="$PLANNER_MODEL" \
  --from-literal=LANGFUSE_PUBLIC_KEY="$LANGFUSE_PUBLIC_KEY" \
  --from-literal=LANGFUSE_SECRET_KEY="$LANGFUSE_SECRET_KEY"
```

See `base/secret.example.yaml` for the placeholder shape — do not `kubectl apply` it.

## 4. Apply everything

Pick an overlay. For local day-to-day work:

```bash
kubectl apply -k k8s/overlays/dev
```

For the higher-replica-plus-PodDisruptionBudget configuration (still a local
cluster — see the 2026-09-01 status note above for what "prod" does and does
not mean here):

```bash
kubectl apply -k k8s/overlays/prod
```

Migrations run as a one-shot `migrate` Job (Phase 12 F2 — api pods no longer
migrate at boot; their `/health/ready` probe keeps them out of the Service
until the schema exists). Jobs are immutable once completed, so when
re-applying after rebuilding the image:

```bash
kubectl delete job -n agentfleet migrate --ignore-not-found
kubectl apply -k k8s/overlays/dev   # or overlays/prod
```

To check either overlay renders without a cluster (no Docker/kind needed):

```bash
kubectl kustomize k8s/overlays/dev
kubectl kustomize k8s/overlays/prod
```

## 5. Reach the web app

```bash
kubectl port-forward -n agentfleet svc/web 3002:3002
open http://localhost:3002
```
