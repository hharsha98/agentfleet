import Link from "next/link";

import { Reveal } from "./reveal";
import { SectionHeader } from "./section-header";

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
// apps/api/scripts/seed_agents.py — the real 17 agents the app ships with.
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
  {
    slug: "data-analyst",
    name: "Data Analyst",
    description: "Queries real data and charts trends with vega-lite artifacts.",
  },
  {
    slug: "market-intelligence",
    name: "Market Intelligence",
    description: "Researches stocks, markets, and companies with cited sources.",
  },
  {
    slug: "patent-scout",
    name: "Patent Scout",
    description: "Searches the patent landscape with cited patent numbers and links.",
  },
  {
    slug: "code-reviewer",
    name: "Code Reviewer",
    description: "Reviews public GitHub PRs and diffs fetched by URL.",
  },
  {
    slug: "resume-builder",
    name: "Resume Builder",
    description: "Tailors your uploaded resume to a target company or role.",
  },
  {
    slug: "youtube-research",
    name: "YouTube Research",
    description: "Researches YouTube videos, channels, and trends via web search.",
  },
  {
    slug: "clinical-research",
    name: "Clinical Research",
    description: "Literature research over PubMed, clinicaltrials.gov, and journals.",
  },
  {
    slug: "web-navigator",
    name: "Web Navigator",
    description: "Reads and compares content across live web pages by URL.",
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
    <Reveal delay={delay}>
      <Link
        href="/chat"
        aria-label={`Chat with ${agent.name}`}
        className="flex cursor-pointer flex-col gap-3 rounded-xl border border-hairline p-5 transition-all duration-300 hover:-translate-y-0.5 hover:border-accent/40 hover:bg-white/[0.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
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
      </Link>
    </Reveal>
  );
}

export function Roster() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-24">
      <Reveal className="mb-12 flex flex-col gap-4">
        <SectionHeader
          eyebrow="Built-in Agents"
          hue="cyan"
          title="Specialized agents, ready to deploy"
          tagline="Each agent ships preconfigured with the right tools and prompts. Use the built-in lineup or create your own."
        />
        <p className="max-w-xl text-sm text-muted">
          17 agents total — real system prompts, real tools, no stubs.
          Sixteen run on LangGraph; Fact Checker runs on Pydantic AI, to
          prove the platform isn&apos;t locked to one framework.
        </p>
      </Reveal>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {AGENTS.map((agent, i) => (
          <AgentCard key={agent.slug} agent={agent} delay={i * 60} />
        ))}
      </div>
    </section>
  );
}
