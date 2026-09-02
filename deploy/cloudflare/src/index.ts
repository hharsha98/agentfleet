import { env } from "cloudflare:workers";
import { Container, getContainer } from "@cloudflare/containers";

const REQUIRED_SECRETS = [
  "DATABASE_URL",
  "AUTH_SECRET",
  "FREE_LLM_BASE_URL",
  "FREE_LLM_KEY",
] as const;

// First boot runs pgvector + alembic + demo seed before uvicorn listens.
// The platform default (20s) is too short for a sleeping Neon + migrations.
const PORT_READY_TIMEOUT_MS = 180_000;

function missingSecrets(): string[] {
  return REQUIRED_SECRETS.filter((name) => !env[name]);
}

/**
 * FastAPI process in a Cloudflare Container. This is the real AgentFleet
 * API (chat, DAG missions, RAG, MCP, evals) — not a Workers rewrite.
 *
 * Hyperdrive is intentionally unused: it does not work inside Containers
 * (cloudflare/containers#97). Postgres is reached over TLS from here.
 */
export class AgentFleetApi extends Container {
  defaultPort = 8000;
  sleepAfter = "15m";
  enableInternet = true;
  pingEndpoint = "/health";

  envVars = {
    ORCHESTRATOR_MODE: env.ORCHESTRATOR_MODE,
    DEMO_LOGIN_ENABLED: env.DEMO_LOGIN_ENABLED,
    SEED_DEMO_DATA: env.SEED_DEMO_DATA,
    RUN_MIGRATIONS_ON_BOOT: env.RUN_MIGRATIONS_ON_BOOT,
    DEFAULT_MODEL: env.DEFAULT_MODEL,
    CORS_ORIGINS: env.CORS_ORIGINS,
    EMBEDDINGS_PREWARM: env.EMBEDDINGS_PREWARM,
    DATABASE_SCHEMA: env.DATABASE_SCHEMA,
    DATABASE_SSL: env.DATABASE_SSL,
    DATABASE_URL: env.DATABASE_URL,
    AUTH_SECRET: env.AUTH_SECRET,
    FREE_LLM_BASE_URL: env.FREE_LLM_BASE_URL,
    FREE_LLM_KEY: env.FREE_LLM_KEY,
  };

  override async fetch(request: Request): Promise<Response> {
    await this.startAndWaitForPorts({
      cancellationOptions: { portReadyTimeoutMS: PORT_READY_TIMEOUT_MS },
    });
    return super.fetch(request);
  }
}

function jsonError(status: number, error: string, detail: string): Response {
  return Response.json({ error, detail }, { status });
}

export default {
  async fetch(request: Request): Promise<Response> {
    const missing = missingSecrets();
    if (missing.length > 0) {
      // Do not start a container that cannot serve. A 503 with names is
      // louder than a crash-looping image, and it is not a fake API.
      return jsonError(
        503,
        "api_not_configured",
        `Missing Worker secrets: ${missing.join(", ")}. Set them with wrangler secret put (see docs/CLOUDFLARE.md).`,
      );
    }

    const container = getContainer(env.AGENTFLEET_API);
    return container.fetch(request);
  },
} satisfies ExportedHandler;
