import Link from "next/link";
import type { ReactNode } from "react";

import { NumberedCard } from "@/components/explainer";

import { HeroTrace } from "./hero-trace";
import { HUE_CLASSES, Icon, IconTile, type Hue, type IconName } from "./icons";
import { Reveal } from "./reveal";

// --- Shared section shells -----------------------------------------------

type DeepDive = {
  eyebrow: string;
  title: string;
  description: string;
  bullets: string[];
  hue: Hue;
  icon: IconName;
  href: string;
  linkLabel: string;
};

function DeepDiveCopy({ dive }: { dive: DeepDive }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <IconTile icon={dive.icon} hue={dive.hue} />
        <span
          className={`font-mono text-xs font-medium uppercase tracking-[0.14em] ${HUE_CLASSES[dive.hue].icon}`}
        >
          {dive.eyebrow}
        </span>
      </div>
      <h3 className="text-2xl font-medium tracking-tight text-foreground sm:text-3xl">
        {dive.title}
      </h3>
      <p className="max-w-md text-sm leading-relaxed text-muted">
        {dive.description}
      </p>
      <ul className="flex flex-wrap gap-2">
        {dive.bullets.map((bullet) => (
          <li
            key={bullet}
            className="rounded-full border border-hairline px-3 py-1 font-mono text-[11px] text-muted"
          >
            {bullet}
          </li>
        ))}
      </ul>
      <Link
        href={dive.href}
        className="w-fit cursor-pointer text-sm font-medium text-accent underline-offset-4 transition-colors duration-200 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        {dive.linkLabel} →
      </Link>
    </div>
  );
}

function BigDeepDive({
  dive,
  flip,
  vignette,
}: {
  dive: DeepDive;
  flip: boolean;
  vignette: ReactNode;
}) {
  return (
    <Reveal className="grid grid-cols-1 items-center gap-10 py-14 lg:grid-cols-2 lg:gap-16">
      <div className={flip ? "lg:order-2" : "lg:order-1"}>
        <DeepDiveCopy dive={dive} />
      </div>
      <div className={flip ? "lg:order-1" : "lg:order-2"}>{vignette}</div>
    </Reveal>
  );
}

function CompactDeepDive({
  dive,
  vignette,
  delay,
}: {
  dive: DeepDive;
  vignette: ReactNode;
  delay: number;
}) {
  return (
    <Reveal
      delay={delay}
      className="flex flex-col gap-5 rounded-xl border border-hairline p-6"
    >
      <DeepDiveCopy dive={dive} />
      {vignette}
    </Reveal>
  );
}

// --- BIG vignettes ---------------------------------------------------------

function ChatDeepVignette() {
  const bubbles = [
    { mine: true, text: "Plan a 90-day agent portfolio" },
    { mine: false, text: "Drafting 3 portfolio agents and an eval plan…" },
    { mine: false, text: "Calling search_documents() for prior notes" },
  ];
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-hairline bg-black/20 p-4">
      <span className="mx-auto mb-1 w-fit rounded-full border border-hairline bg-white/[0.03] px-2.5 py-1 font-mono text-[10px] text-muted">
        <span className="animate-pulse-node mr-1 inline-block h-1.5 w-1.5 rounded-full bg-accent align-middle" />
        search_documents()
      </span>
      {bubbles.map((b, i) => (
        <div
          key={i}
          className={`animate-rise-in max-w-[80%] rounded-md px-3 py-1.5 text-xs ${
            b.mine
              ? "ml-auto rounded-tr-sm bg-accent/15 text-foreground/80"
              : "rounded-tl-sm border border-hairline bg-white/[0.03] text-foreground/70"
          }`}
          style={{ animationDelay: `${i * 1.8}s` }}
        >
          {b.text}
        </div>
      ))}
    </div>
  );
}

// Rich Kanban vignette (UI-5 Chunk B, replaces the old empty-boxes traveling
// card) — mirrors the reference: a goal header row, then 4 columns with
// real-looking task cards (agent chip, priority badge, dependency note,
// spinner) instead of blank placeholder bars.
function OrchestrationDeepVignette() {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-hairline bg-black/20 p-4">
      {/* Goal header row: orchestrator icon + goal quote + badges. */}
      <div className="flex flex-wrap items-center gap-2 border-b border-hairline pb-3">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-hue-violet/30 bg-hue-violet/10">
          <Icon name="workflow" className="h-3 w-3 text-hue-violet" />
        </span>
        <p className="min-w-0 flex-1 truncate font-mono text-[10px] text-foreground/80">
          &ldquo;Research and write a competitive analysis report&rdquo;
        </p>
        <span className="shrink-0 rounded-full border border-hairline px-2 py-0.5 font-mono text-[8px] text-muted">
          Project
        </span>
        <span className="shrink-0 font-mono text-[8px] text-muted">
          4 tasks · 3 agents
        </span>
      </div>

      {/* 4 columns: Backlog, In Progress, Done, Failed. */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {/* Backlog — empty state. */}
        <div className="flex flex-col gap-1.5">
          <span className="font-mono text-[8px] uppercase tracking-wide text-muted">
            Backlog · 0
          </span>
          <div className="flex h-24 flex-col items-center justify-center gap-1 rounded-md border border-dashed border-hairline text-muted">
            <Icon name="list-checks" className="h-3.5 w-3.5" />
            <span className="font-mono text-[7px]">All clear</span>
          </div>
        </div>

        {/* In Progress — detailed task card. */}
        <div className="flex flex-col gap-1.5">
          <span className="font-mono text-[8px] uppercase tracking-wide text-muted">
            In Progress · 1
          </span>
          <div className="flex h-24 flex-col gap-1 rounded-md border border-accent/30 bg-accent/[0.06] p-1.5">
            <div className="flex items-start justify-between gap-1">
              <span className="text-[8px] leading-tight text-foreground/80">
                Draft competitor matrix
              </span>
              <span className="shrink-0 rounded-full border border-hue-red/30 bg-hue-red/10 px-1 font-mono text-[6px] uppercase text-hue-red">
                high
              </span>
            </div>
            <span className="flex w-fit items-center gap-1 rounded-full border border-hairline bg-white/[0.03] px-1 py-0.5 font-mono text-[6px] text-muted">
              <span className="h-1 w-1 rounded-full bg-hue-amber" />
              Creative Writer
            </span>
            <span className="font-mono text-[6px] text-muted">
              Waiting on 2 tasks
            </span>
            <span className="mt-auto flex items-center gap-1 font-mono text-[6px] text-accent">
              <span className="animate-spin-slow h-2 w-2 rounded-full border border-accent/40 border-t-accent" />
              Agent working…
            </span>
          </div>
        </div>

        {/* Done — 2 cards. */}
        <div className="flex flex-col gap-1.5">
          <span className="font-mono text-[8px] uppercase tracking-wide text-muted">
            Done · 2
          </span>
          <div className="flex h-24 flex-col gap-1">
            {["Deep Research", "SQL Analytics"].map((agent, i) => (
              <div
                key={agent}
                className={`flex flex-1 flex-col justify-center gap-0.5 rounded-md border border-hue-green/25 bg-hue-green/[0.06] px-1.5 ${i === 0 ? "animate-pulse-node" : ""}`}
              >
                <span className="font-mono text-[6px] text-hue-green">
                  ✓ Completed by agent
                </span>
                <span className="truncate text-[7px] text-foreground/70">
                  {agent}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Failed — 1 card. */}
        <div className="flex flex-col gap-1.5">
          <span className="font-mono text-[8px] uppercase tracking-wide text-muted">
            Failed · 1
          </span>
          <div className="flex h-24 flex-col justify-center gap-1 rounded-md border border-hue-red/25 bg-hue-red/[0.05] p-1.5">
            <span className="truncate text-[7px] text-foreground/70">
              Pull analyst estimates
            </span>
            <span className="font-mono text-[6px] text-hue-red">
              ⚠ Rate limited — retry available
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- COMPACT vignettes ------------------------------------------------------

function BuilderVignette() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 220 70"
      className="h-16 w-full rounded-lg border border-hairline bg-black/20"
    >
      <circle cx="24" cy="35" r="8" fill="var(--hue-amber)" fillOpacity={0.25} stroke="var(--hue-amber)" strokeWidth={1.25} />
      <circle cx="110" cy="18" r="8" fill="var(--hue-amber)" fillOpacity={0.18} stroke="var(--hue-amber)" strokeWidth={1.25} />
      <circle cx="110" cy="52" r="8" fill="var(--hue-amber)" fillOpacity={0.18} stroke="var(--hue-amber)" strokeWidth={1.25} />
      <circle cx="196" cy="35" r="8" fill="var(--hue-amber)" fillOpacity={0.25} stroke="var(--hue-amber)" strokeWidth={1.25} />
      <path
        d="M32 35 Q 70 35 102 20"
        fill="none"
        stroke="var(--hue-amber)"
        strokeWidth={1.5}
        strokeLinecap="round"
        pathLength={100}
        className="animate-dash-draw"
      />
      <path
        d="M32 35 Q 70 35 102 50"
        fill="none"
        stroke="var(--hue-amber)"
        strokeWidth={1.5}
        strokeLinecap="round"
        pathLength={100}
        className="animate-dash-draw"
        style={{ animationDelay: "1.2s" }}
      />
      <path
        d="M118 20 Q 155 35 188 35"
        fill="none"
        stroke="var(--hue-amber)"
        strokeWidth={1.5}
        strokeLinecap="round"
        pathLength={100}
        className="animate-dash-draw"
        style={{ animationDelay: "2.4s" }}
      />
      <path
        d="M118 50 Q 155 35 188 35"
        fill="none"
        stroke="var(--hue-amber)"
        strokeWidth={1.5}
        strokeLinecap="round"
        pathLength={100}
        className="animate-dash-draw"
        style={{ animationDelay: "3.6s" }}
      />
    </svg>
  );
}

function DocIntelVignette() {
  const chunks = [0, 1, 2];
  return (
    <div className="flex items-center gap-3 rounded-lg border border-hairline bg-black/20 p-3">
      <Icon name="file-text" className="h-6 w-6 shrink-0 text-hue-cyan" />
      <span className="text-hue-cyan/60">→</span>
      <div className="flex gap-1.5">
        {chunks.map((i) => (
          <span
            key={i}
            className="animate-drift block h-4 w-4 rounded-sm border border-hue-cyan/40 bg-hue-cyan/15"
            style={{ animationDelay: `${i * 0.8}s` }}
          />
        ))}
      </div>
    </div>
  );
}

function PublishVignette() {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-hairline bg-black/20 p-3 font-mono text-[11px]">
      <span className="flex w-fit items-center gap-1.5 rounded border border-hairline bg-white/[0.03] px-1.5 py-0.5 text-muted">
        <Icon name="key" className="h-3 w-3 text-hue-green" />
        sk_live_••••4f2a
      </span>
      <span className="text-foreground/70">
        curl fleet.dev/api/v1/invoke
        <span
          aria-hidden
          className="ml-0.5 inline-block h-3 w-[2px] translate-y-0.5 animate-blink-caret bg-accent align-middle"
        />
      </span>
    </div>
  );
}

// --- Section data ------------------------------------------------------

const CHAT: DeepDive = {
  eyebrow: "Multi-Agent Chat",
  hue: "blue",
  icon: "chat",
  title: "Talk to every agent in one place",
  description:
    "Talk to any agent in the fleet from one streaming chat. Tool calls show up live as they run — search queries, SQL, Slack posts — so you see what the agent actually did, not just its final answer.",
  bullets: ["Streaming responses", "Live tool-call cards", "Switch agents mid-conversation"],
  href: "/chat",
  linkLabel: "Open multi-agent chat",
};

const ORCHESTRATION: DeepDive = {
  eyebrow: "Kanban Board",
  hue: "violet",
  icon: "workflow",
  title: "Organize work with a live task board",
  description:
    "Give the fleet a goal and the orchestrator turns it into a Kanban DAG — a chain of steps agents pick up, execute, and hand off. Human-in-the-loop checkpoints pause the run wherever you want a say.",
  bullets: ["Goal → step DAG", "Human-in-the-loop checkpoints", "Live mission board"],
  href: "/missions",
  linkLabel: "Open the mission board",
};

const OBSERVABILITY: DeepDive = {
  eyebrow: "Live Observability",
  hue: "red",
  icon: "activity",
  title: "See every step, token, and cent",
  description:
    "Every step is traced in Langfuse — latency, token usage, and cost per tool call, live as the run happens. When a run is slow or expensive, you see exactly which step, not just an aggregate number.",
  bullets: ["Per-step latency + cost", "Langfuse trace timeline", "p95 94ms under load"],
  href: "/usage",
  linkLabel: "See live usage",
};

const BUILDER: DeepDive = {
  eyebrow: "Agent Builder",
  hue: "amber",
  icon: "plug",
  title: "Create new agents without redeploying",
  description:
    "Compose a new agent at runtime — pick a system prompt, a model, and wire in external MCP tools — without touching code or redeploying.",
  bullets: ["No redeploy", "MCP tool wiring", "Model per agent"],
  href: "/agents",
  linkLabel: "Open the agent builder",
};

const DOC_INTEL: DeepDive = {
  eyebrow: "Document Intelligence",
  hue: "cyan",
  icon: "file-text",
  title: "Ground answers in your own documents",
  description:
    "Upload your own docs and every agent can search them through local pgvector retrieval — chunked and embedded on your machine, grounding answers in your content instead of the model's guesses.",
  bullets: ["Local pgvector search", "fastembed, on-device", "Grounded citations"],
  href: "/documents",
  linkLabel: "Open documents",
};

const PUBLISH: DeepDive = {
  eyebrow: "Publish & Integrate",
  hue: "green",
  icon: "rocket",
  title: "Ship agents as APIs and MCP servers",
  description:
    "Ship an agent behind a versioned API key, embed it as a widget, or expose your whole fleet as an MCP server. Every publish is a version — roll back a bad one in one click.",
  bullets: ["Versioned publishing", "One-click rollback", "MCP server export"],
  href: "/templates",
  linkLabel: "Explore templates",
};

// Whole-panel Link wrapper shared by every deep-dive vignette below — the
// vignette components themselves stay plain (no anchors), so wrapping here
// keeps each one a single clickable region without nesting <a> inside <a>.
function VignetteLink({
  href,
  label,
  children,
}: {
  href: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-label={label}
      className="block cursor-pointer rounded-xl transition-opacity duration-200 hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      {children}
    </Link>
  );
}

export function DeepDives() {
  return (
    <section className="mx-auto max-w-6xl px-6">
      <div className="flex flex-col divide-y divide-hairline">
        <BigDeepDive
          dive={CHAT}
          flip={false}
          vignette={
            <VignetteLink href={CHAT.href} label={CHAT.linkLabel}>
              <ChatDeepVignette />
            </VignetteLink>
          }
        />
        <div className="flex flex-col">
          <BigDeepDive
            dive={ORCHESTRATION}
            flip={true}
            vignette={
              <VignetteLink href={ORCHESTRATION.href} label={ORCHESTRATION.linkLabel}>
                <OrchestrationDeepVignette />
              </VignetteLink>
            }
          />
          {/* 3 numbered explainer cards below the Kanban vignette
              (reference-style), spanning the full section width. */}
          <div className="grid grid-cols-1 gap-4 pb-14 sm:grid-cols-3">
            <NumberedCard
              n={1}
              hue="violet"
              title="Describe your goal"
              description="Type what you want in plain language — a report, a campaign, a migration. No workflow to configure, no DAG to draw by hand."
            />
            <NumberedCard
              n={2}
              hue="violet"
              title="Auto-execute the DAG"
              description="The orchestrator breaks the goal into dependent steps and hands each one to the specialist agent best suited to run it."
            />
            <NumberedCard
              n={3}
              hue="violet"
              title="Track & intervene"
              description="Watch every task move across the board live. Approve checkpoints, retry a failed step, or step in anywhere the run needs a human call."
            />
          </div>
        </div>
        <BigDeepDive
          dive={OBSERVABILITY}
          flip={false}
          vignette={
            <VignetteLink href={OBSERVABILITY.href} label={OBSERVABILITY.linkLabel}>
              <HeroTrace />
            </VignetteLink>
          }
        />
      </div>

      <div className="grid grid-cols-1 gap-4 py-14 sm:grid-cols-3">
        <CompactDeepDive
          dive={BUILDER}
          vignette={
            <VignetteLink href={BUILDER.href} label={BUILDER.linkLabel}>
              <BuilderVignette />
            </VignetteLink>
          }
          delay={0}
        />
        <CompactDeepDive
          dive={DOC_INTEL}
          vignette={
            <VignetteLink href={DOC_INTEL.href} label={DOC_INTEL.linkLabel}>
              <DocIntelVignette />
            </VignetteLink>
          }
          delay={80}
        />
        <CompactDeepDive
          dive={PUBLISH}
          vignette={
            <VignetteLink href={PUBLISH.href} label={PUBLISH.linkLabel}>
              <PublishVignette />
            </VignetteLink>
          }
          delay={160}
        />
      </div>
    </section>
  );
}
