import { Reveal } from "./reveal";

// Deterministic slug -> hue mapping, same hash idiom as chat-ui.tsx's
// hueForSlug so the roster's tile colors match what a user later sees in
// the actual agent picker.
const HUES = ["blue", "violet", "cyan", "amber", "green", "red"] as const;
type Hue = (typeof HUES)[number];

const HUE_TILE_CLASS: Record<Hue, string> = {
  blue: "border-hue-blue/30 bg-hue-blue/10 text-hue-blue",
  violet: "border-hue-violet/30 bg-hue-violet/10 text-hue-violet",
  cyan: "border-hue-cyan/30 bg-hue-cyan/10 text-hue-cyan",
  amber: "border-hue-amber/30 bg-hue-amber/10 text-hue-amber",
  green: "border-hue-green/30 bg-hue-green/10 text-hue-green",
  red: "border-hue-red/30 bg-hue-red/10 text-hue-red",
};

function hueForSlug(slug: string): Hue {
  let hash = 0;
  for (let i = 0; i < slug.length; i++) {
    hash = (hash * 31 + slug.charCodeAt(i)) | 0;
  }
  return HUES[Math.abs(hash) % HUES.length];
}

// Transcribed verbatim (slug/name/description) from the BUILTIN roster in
// apps/api/scripts/seed_agents.py — the real 9 agents the app ships with.
const AGENTS: {
  slug: string;
  name: string;
  description: string;
  badge?: string;
}[] = [
  {
    slug: "orchestrator",
    name: "Orchestrator",
    description:
      "Routes goals to specialist agents and synthesizes their output.",
  },
  {
    slug: "deep-research",
    name: "Deep Research",
    description:
      "Web-searching analyst that structures evidence and cites sources.",
  },
  {
    slug: "creative-writer",
    name: "Creative Writer",
    description: "Brainstorming, copy, and storytelling with a distinct voice.",
  },
  {
    slug: "system-architect",
    name: "System Architect",
    description:
      "Distributed systems and cloud architecture design with diagrams.",
  },
  {
    slug: "sql-analytics",
    name: "SQL Analytics",
    description:
      "Careful data analyst that answers questions with real numbers from SQL.",
  },
  {
    slug: "competitor-monitor",
    name: "Competitor Monitor",
    description:
      "Tracks a competitor's recent moves and posts a digest to Slack.",
  },
  {
    slug: "meeting-notes",
    name: "Meeting Notes → CRM",
    description:
      "Extracts structured notes from a pasted transcript and files them to the CRM.",
  },
  {
    slug: "outreach",
    name: "Outreach Writer",
    description:
      "Researches a prospect and drafts one personalized outreach email for your review.",
  },
  {
    slug: "fact-checker",
    name: "Fact Checker",
    description: "Verifies a claim against live sources and cites what it found.",
    badge: "Pydantic AI runtime",
  },
];

function AgentCard({
  agent,
  delay,
}: {
  agent: (typeof AGENTS)[number];
  delay: number;
}) {
  const hue = hueForSlug(agent.slug);
  return (
    <Reveal
      delay={delay}
      className="flex flex-col gap-3 rounded-xl border border-hairline p-5 transition-all duration-300 hover:-translate-y-0.5 hover:border-accent/40 hover:bg-white/[0.02]"
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border font-mono text-sm font-medium ${HUE_TILE_CLASS[hue]}`}
        >
          {agent.name.charAt(0).toUpperCase()}
        </span>
        <div className="flex flex-col">
          <span className="font-medium tracking-tight text-foreground">
            {agent.name}
          </span>
          {agent.badge ? (
            <span className="w-fit rounded-full border border-hairline px-2 py-0.5 font-mono text-[9px] text-muted">
              {agent.badge}
            </span>
          ) : null}
        </div>
      </div>
      <p className="text-sm text-muted">{agent.description}</p>
    </Reveal>
  );
}

export function Roster() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-24">
      <div className="mb-12 flex flex-col gap-3">
        <span className="font-mono text-xs text-muted">THE ROSTER</span>
        <h2 className="text-2xl font-medium tracking-tight sm:text-3xl">
          9 built-in agents, 2 runtimes.
        </h2>
        <p className="max-w-xl text-muted">
          Every agent below ships with the app — real system prompts, real
          tools, no stubs. Eight run on LangGraph; Fact Checker runs on
          Pydantic AI, to prove the platform isn&apos;t locked to one
          framework.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {AGENTS.map((agent, i) => (
          <AgentCard key={agent.slug} agent={agent} delay={i * 60} />
        ))}
      </div>
    </section>
  );
}
