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

Deploys 5 workloads: `postgres`, `redis`, `api`, `worker`, `web`. `worker` reuses
the `agentfleet-api:local` image (no separate build) and runs
`arq app.worker.WorkerSettings` instead of `uvicorn`, so mission runs execute
durably and survive an `api` pod restart (see ARCHITECTURE.md ADR-004).

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

See `secret.example.yaml` for the placeholder shape — do not `kubectl apply` it.

## 4. Apply everything

```bash
kubectl apply -k k8s/
```

Migrations run as a one-shot `migrate` Job (Phase 12 F2 — api pods no longer
migrate at boot; their `/health/ready` probe keeps them out of the Service
until the schema exists). Jobs are immutable once completed, so when
re-applying after rebuilding the image:

```bash
kubectl delete job -n agentfleet migrate --ignore-not-found
kubectl apply -k k8s/
```

## 5. Reach the web app

```bash
kubectl port-forward -n agentfleet svc/web 3002:3002
open http://localhost:3002
```
