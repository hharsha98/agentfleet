import Link from "next/link";

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
    version: "Phase 10 K",
    date: "Unreleased",
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
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-hairline px-6 py-3">
        <Link href="/" className="font-medium tracking-tight">
          AgentFleet
        </Link>
        <nav className="flex gap-4 text-sm text-muted">
          <Link href="/chat" className="hover:text-foreground">
            Chat
          </Link>
          <Link href="/documents" className="hover:text-foreground">
            Documents
          </Link>
          <Link href="/missions" className="hover:text-foreground">
            Missions
          </Link>
          <Link href="/agents" className="hover:text-foreground">
            Agents
          </Link>
          <Link href="/templates" className="hover:text-foreground">
            Templates
          </Link>
          <Link href="/evals" className="hover:text-foreground">
            Evals
          </Link>
          <Link href="/usage" className="hover:text-foreground">
            Usage
          </Link>
          <Link href="/automations" className="hover:text-foreground">
            Automations
          </Link>
          <span className="text-foreground">Changelog</span>
        </nav>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
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
    </div>
  );
}
