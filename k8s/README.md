# AgentFleet on Kubernetes (local cluster)

Resume/demo artifact for a local kind/k3d/minikube cluster. Not applied in CI.

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

## 5. Reach the web app

```bash
kubectl port-forward -n agentfleet svc/web 3002:3002
open http://localhost:3002
```
