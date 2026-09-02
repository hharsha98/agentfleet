# AgentFleet on Cloudflare

This directory is the **API** half of the Cloudflare deploy: a small Worker
that proxies to the existing FastAPI Docker image running as a Cloudflare
Container.

The **web** half lives in `apps/web` (OpenNext Worker named `agentfleet-app`).
The human guide — env vars, Postgres, what to do when Containers are blocked
on a free plan — is [docs/CLOUDFLARE.md](../../docs/CLOUDFLARE.md).

```bash
# from this directory, after wrangler login
cp .dev.vars.example .dev.vars   # fill real values
./put-secrets.sh
npx wrangler deploy
```

Do **not** deploy this over `agentic-systems-studio` or the Pages project
`agentfleet-gallery`.
