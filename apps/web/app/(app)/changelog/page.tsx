// Static, honest changelog — summarized from git history + docs/PRODUCTION_PLAN.md
// status log. No client hooks needed: this is plain server-rendered content.
type Release = {
  version: string;
  date: string; // "Unreleased" for work still in flight
  summary: string;
  changes: string[];
};

const RELEASES: Release[] = [
  {
    version: "UI-2",
    date: "Unreleased",
    summary: "App-shell polish — one nav, no emoji icons, premium pass on every page.",
    changes: [
      "Shared <AppNav/> (sticky, backdrop-blur, active-page state) replaces 11 duplicated per-page headers, mounted once via an app/(app) route-group layout",
      "⌘K hint chip in the nav opens the existing command palette",
      "Command palette, empty states, and artifact chips: emoji glyphs replaced with hand-inlined SVG icons",
      "Consistent page headers, card hover states, and focus-visible rings across Chat, Documents, Missions, Agents, Templates, Evals, Usage, Automations, Playground, and Voice",
      "Chat page: hue-tinted avatar tiles per agent, refined message bubbles, compact mono tool-call cards",
    ],
  },
  {
    version: "UI-1",
    date: "2026-07-18",
    summary: "Premium landing redesign — product-forward bento grid + display hero.",
    changes: [
      "New display hero with a live agent-trace animation and gradient headline",
      "Six-pillar bento feature grid with hue-tinted icon tiles and hand-built product vignettes (chat, mission board, sparkline)",
      "Honest stats strip (9 agents, 2 runtimes, 106 backend tests, 21 E2E, 94ms p95) and an ops-layer section",
      "Shared hue tokens, dot texture, and reveal-on-scroll primitives added to globals.css for reuse across the app shell",
    ],
  },
  {
    version: "Phase 12",
    date: "2026-07-16",
    summary: "Production hardening — auth, rate limiting, deploy safety. Phase 12 complete.",
    changes: [
      "Bearer JWT auth + per-resource ownership across all 15 routers; pages gated via proxy.ts, / and /changelog stay public",
      "Per-user (JWT email, else IP) rate limiting with a Redis-backed store and a memory fallback",
      "Deploy safety: one-shot DB migration job, /health/ready readiness check, background embedding-model pre-warm",
      "98 → 106 backend tests across the phase; 21/21 E2E with the new auth flow",
    ],
  },
  {
    version: "Phase 11",
    date: "2026-07-16",
    summary: "Quality pass — E2E coverage, pagination, error monitoring, a real load test.",
    changes: [
      "Playwright E2E suite: 20 tests across two projects (deterministic + LLM-dependent), skippable via E2E_SKIP_LLM=1",
      "Uniform limit/offset pagination + deterministic ordering on every DB-backed list endpoint",
      "DSN-gated Sentry error monitoring, backend and frontend, no-op until a key is configured",
      "k6 load test: lists p95 94ms at ~414 rps, writes p95 96ms, 0% errors over 48.6k requests",
    ],
  },
  {
    version: "Phase 10 N",
    date: "2026-07-16",
    summary: "Voice agent via Vapi — keys-optional scoped demo.",
    changes: [
      "New /voice page: live call via the Vapi web SDK when a key is configured, a designed not-configured state otherwise",
      "GET /api/v1/voice/config gates on VAPI_PUBLIC_KEY server-side — the API key itself is never exposed to the browser",
    ],
  },
  {
    version: "Phase 10 M",
    date: "2026-07-16",
    summary: "Second agent runtime — Pydantic AI alongside LangGraph.",
    changes: [
      "New pydantic-ai-slim runtime with real delta streaming, wrapped web_search + search_documents tools, and budget checks",
      "Per-agent runtime selection (default: LangGraph); new built-in Fact Checker agent runs on the Pydantic AI path",
    ],
  },
  {
    version: "Phase 10 L",
    date: "2026-07-16",
    summary: "Prompt Playground — side-by-side model/temperature A/B testing.",
    changes: [
      "New /playground page: run the same prompt against two model configs in parallel, compare cost, latency, and output",
      "Load a variant's model + system prompt straight from an existing agent; save and reload comparisons as experiments",
    ],
  },
  {
    version: "Phase 10 K",
    date: "2026-07-12",
    summary: "Command palette, designed empty states, and this changelog.",
    changes: [
      "⌘K / Ctrl+K command palette for jumping to any page without the mouse",
      "Shared EmptyState component — replaces bare \"No X yet\" text across Chat, Documents, Missions, Agents, Evals, Automations, and Templates",
      "This changelog page",
    ],
  },
  {
    version: "Phase 10 J",
    date: "2026-07-12",
    summary: "Sandboxed artifacts side panel.",
    changes: [
      "Agent replies can render code, markdown, and Vega-Lite charts as clickable chips that open in a resizable side panel",
      "Streaming-safe fence parser and an escape-then-transform markdown renderer with a URL allowlist",
      "Chart rendering (vega-embed) is lazily imported so it never bloats the main bundle",
    ],
  },
  {
    version: "Phase 10 I",
    date: "2026-07-11",
    summary: "Scheduled runs + inbound webhooks — the automation platform half of Phase 10.",
    changes: [
      "Cron-scheduled mission runs (Automations page) backed by an arq worker poller",
      "Inbound webhook triggers with bearer-secret auth and {payload} template substitution",
      "Both surfaced in a new /automations page",
    ],
  },
  {
    version: "Phase 10 H",
    date: "2026-07-11",
    summary: "Roster expansion — four new built-in agents.",
    changes: [
      "SQL Analytics agent — natural language to read-only SQL over a demo schema",
      "Competitor Monitor, Meeting-Notes→CRM, and Outreach agents, each with an eval case",
      "send_slack and push_to_crm tools that degrade gracefully without keys configured",
    ],
  },
  {
    version: "Phase 9",
    date: "2026-07-11",
    summary: "Reliability pass — durability, web access, and ops hygiene.",
    changes: [
      "Pluggable web search (Tavily / Exa / SearXNG) plus a trafilatura-based fetch_url tool",
      "Durable Postgres LangGraph checkpointer, replacing the in-memory saver",
      "Durable arq/Redis orchestration — mission runs survive an API restart",
      "Seeded golden eval cases as a real CI regression gate",
      "Structured JSON logging, request-ID middleware, env-configurable CORS",
    ],
  },
  {
    version: "Phase 8",
    date: "2026-07-11",
    summary: "LangGraph runtime, landing page, and production packaging.",
    changes: [
      "LangGraph agent runtime promoted to the default execution path",
      "Premium landing page with a live agent-trace hero and feature grid",
      "Interview-grade README, DEMO.md, and LICENSE",
      "Local production packaging — Dockerfiles, one-command compose, Kubernetes manifests",
    ],
  },
];

export default function ChangelogPage() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-medium tracking-tight">Changelog</h1>
      <p className="mt-1 text-sm text-muted">
        What shipped, phase by phase — summarized from the build history.
      </p>

      <ol className="mt-8 space-y-8 border-l border-hairline pl-6">
        {RELEASES.map((release) => (
          <li key={release.version} className="relative">
            <span
              aria-hidden="true"
              className="absolute -left-[29px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-background bg-accent"
            />
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 className="text-sm font-medium">{release.version}</h2>
              <span className="font-mono text-xs text-muted">{release.date}</span>
            </div>
            <p className="mt-1 text-sm text-muted">{release.summary}</p>
            <ul className="mt-3 space-y-1.5 text-sm">
              {release.changes.map((change) => (
                <li key={change} className="flex gap-2">
                  <span aria-hidden="true" className="text-muted">
                    —
                  </span>
                  <span>{change}</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </main>
  );
}
