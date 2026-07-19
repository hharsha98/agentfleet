"use client";

import Link from "next/link";

import { IconTile, type Hue, type IconName } from "./icons";
import { Reveal } from "./reveal";
import { SectionHeader } from "./section-header";
import { useReveal } from "./use-reveal";

type Step = {
  icon: IconName;
  hue: Hue;
  title: string;
  description: string;
  href: string;
};

const STEPS: Step[] = [
  {
    icon: "sparkle",
    hue: "violet",
    title: "Give the fleet a goal",
    description:
      "Type a goal in plain language, in chat or the mission board. No workflow to configure first.",
    href: "/missions",
  },
  {
    icon: "workflow",
    hue: "blue",
    title: "Orchestrator plans, agents execute",
    description:
      "The orchestrator breaks it into steps and routes each one to a specialist agent with the right tools.",
    href: "/missions",
  },
  {
    icon: "search",
    hue: "green",
    title: "Review, approve, ship",
    description:
      "Watch every tool call in the live trace, approve human-in-the-loop checkpoints, and publish when it's ready.",
    href: "/usage",
  },
];

// Connecting line between step icons that draws itself in once the row
// scrolls into view (dash-draw-once), rather than looping forever.
function Connector() {
  const { ref, visible } = useReveal<HTMLDivElement>();
  return (
    <div ref={ref} className="hidden h-1 w-full md:block">
      <svg
        aria-hidden
        viewBox="0 0 100 4"
        preserveAspectRatio="none"
        className="h-1 w-full"
      >
        <path d="M2 2 L98 2" stroke="var(--hairline)" strokeWidth={1.5} />
        <path
          d="M2 2 L98 2"
          stroke="var(--accent)"
          strokeWidth={1.5}
          strokeLinecap="round"
          pathLength={100}
          className={visible ? "animate-dash-draw-once" : ""}
          opacity={0.7}
        />
      </svg>
    </div>
  );
}

export function HowItWorks() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-24">
      <Reveal className="mb-12">
        <SectionHeader
          eyebrow="Autonomous Execution"
          hue="violet"
          title="From goal to finished work, hands-free"
          tagline="The orchestrator decomposes your goal into a task DAG, routes each step to the right agent, and pauses for your approval wherever you want a checkpoint."
        />
      </Reveal>

      <div className="flex flex-col gap-8 md:flex-row md:items-start md:gap-6">
        {STEPS.map((step, i) => (
          <div
            key={step.title}
            className="flex flex-1 items-start gap-6 md:flex-col md:gap-4"
          >
            <Link
              href={step.href}
              aria-label={step.title}
              className="group flex flex-1 cursor-pointer items-start gap-6 rounded-lg transition-opacity duration-200 hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent md:flex-col md:gap-4"
            >
              <div className="flex flex-col items-center gap-4 md:w-full md:flex-row">
                <span className="font-mono text-xs text-muted md:hidden">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <IconTile icon={step.icon} hue={step.hue} />
                {i < STEPS.length - 1 ? <Connector /> : null}
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="hidden font-mono text-xs text-muted md:block">
                  STEP {i + 1}
                </span>
                <h3 className="font-medium tracking-tight text-foreground">
                  {step.title}
                </h3>
                <p className="text-sm text-muted">{step.description}</p>
              </div>
            </Link>
          </div>
        ))}
      </div>
    </section>
  );
}
