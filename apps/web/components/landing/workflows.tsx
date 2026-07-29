// NEW landing section (UI-5 Chunk B): a 4-step pipeline diagram showing
// agents chained into one automated run, extending the orchestration idea
// from the Kanban deep-dive above. Whole diagram is one clickable Link to
// /missions (plus a separate, non-nested "Open the mission board" link in
// the header) since that's where a real chained run actually shows up as
// tasks on the live board.

import Link from "next/link";
import { Fragment } from "react";

import { NumberedCard } from "@/components/explainer";

import { HUE_CLASSES, IconTile, type Hue, type IconName } from "./icons";
import { Reveal } from "./reveal";
import { SectionHeader } from "./section-header";

type WorkflowStep = {
  title: string;
  agent: string;
  icon: IconName;
  hue: Hue;
  duration: string;
};

// Honest mapping to the real 17-agent roster (apps/api/scripts/seed_agents.py)
// — every agent named below actually exists and could run this chain.
const STEPS: WorkflowStep[] = [
  {
    title: "Research Competitors",
    agent: "Deep Research",
    icon: "search",
    hue: "blue",
    duration: "2m14s",
  },
  {
    title: "Analyze Market Data",
    agent: "Data Analyst",
    icon: "gauge",
    hue: "cyan",
    duration: "1m38s",
  },
  {
    title: "Draft Strategy",
    agent: "Creative Writer",
    icon: "sparkle",
    hue: "violet",
    duration: "3m02s",
  },
  {
    title: "Fact-Check Claims",
    agent: "Fact Checker",
    icon: "shield",
    hue: "green",
    duration: "0m52s",
  },
];

function StepArrow({ delay }: { delay: number }) {
  return (
    <div aria-hidden className="hidden items-center justify-center px-1 sm:flex">
      <svg viewBox="0 0 40 12" className="h-3 w-8 shrink-0">
        <path
          d="M2 6h30M26 2l6 4-6 4"
          fill="none"
          stroke="var(--accent)"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          pathLength={100}
          className="animate-dash-draw"
          style={{ animationDelay: `${delay}s` }}
        />
      </svg>
    </div>
  );
}

function StepCard({ step, i }: { step: WorkflowStep; i: number }) {
  return (
    <div className="flex flex-1 flex-col gap-2 rounded-lg border border-hairline bg-black/20 p-3">
      <div className="flex items-center justify-between">
        {/* Sequential light-up: each tile's pulse is staggered so the row
            reads as steps completing one after another. */}
        <div className="animate-pulse-node" style={{ animationDelay: `${i * 1.8}s` }}>
          <IconTile icon={step.icon} hue={step.hue} />
        </div>
        <span className="font-mono text-[10px] text-hue-green">✓ Done</span>
      </div>
      <span className="text-xs font-medium tracking-tight text-foreground">
        {step.title}
      </span>
      <span
        className={`w-fit rounded-full border px-1.5 py-0.5 font-mono text-[9px] ${HUE_CLASSES[step.hue].tile} ${HUE_CLASSES[step.hue].icon}`}
      >
        {step.agent}
      </span>
      <span className="font-mono text-[10px] text-muted">{step.duration}</span>
    </div>
  );
}

export function Workflows() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-24">
      <Reveal className="mb-8 flex flex-col gap-3">
        <SectionHeader
          eyebrow="Workflows"
          hue="amber"
          title="Chain agents into automated pipelines"
          tagline="The orchestrator sequences the steps, hands each one to the right agent, and runs the whole chain unattended."
        />
        <Link
          href="/missions"
          className="w-fit cursor-pointer text-sm font-medium text-accent underline-offset-4 transition-colors duration-200 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Open the mission board →
        </Link>
      </Reveal>

      <Reveal delay={80}>
        <Link
          href="/missions"
          aria-label="Open the mission board"
          className="block cursor-pointer rounded-xl border border-hairline bg-black/10 p-4 transition-opacity duration-200 hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:p-5"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch sm:gap-0">
            {STEPS.map((step, i) => (
              <Fragment key={step.title}>
                <StepCard step={step} i={i} />
                {i < STEPS.length - 1 ? <StepArrow delay={i * 1.2} /> : null}
              </Fragment>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-hairline pt-4 font-mono text-[11px] text-muted">
            <span>
              TOTAL STEPS <span className="text-foreground">4</span>
            </span>
            <span>
              AGENTS USED <span className="text-foreground">4</span>
            </span>
            <span>
              DURATION <span className="text-foreground">7m46s</span>
            </span>
            <span>
              STATUS <span className="text-hue-green">All passed</span>
            </span>
          </div>
        </Link>
      </Reveal>

      <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <NumberedCard
          n={1}
          hue="amber"
          title="Dependency Chains"
          description="Steps declare what they depend on. The orchestrator won't start a step until everything it needs has finished."
        />
        <NumberedCard
          n={2}
          hue="amber"
          title="One-Click Execution"
          description="Launch a whole pipeline from one goal — no manual hand-off between steps, no copy-pasting output between agents."
        />
        <NumberedCard
          n={3}
          hue="amber"
          title="Visual Task Board"
          description="Every pipeline run shows up as tasks on the mission board, so you can watch, approve, or retry any step as it happens."
        />
      </div>
    </section>
  );
}
