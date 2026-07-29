import Link from "next/link";

import { IconTile, type Hue, type IconName } from "./icons";
import { Reveal } from "./reveal";
import { SectionHeader } from "./section-header";

const OPS_ITEMS: {
  icon: IconName;
  hue: Hue;
  tag: string;
  title: string;
  description: string;
  href: string;
}[] = [
  {
    icon: "list-checks",
    hue: "blue",
    tag: "LLM-as-judge · CI gate",
    title: "Eval Center",
    description:
      "Every change runs against a regression suite scored by an LLM judge before it ships. A failing eval blocks the change in CI, the same gate a real production pipeline would use.",
    href: "/evals",
  },
  {
    icon: "shield",
    hue: "red",
    tag: "PII masking · red-team",
    title: "Guardrails",
    description:
      "Prompt-injection screening and PII masking run on every agent turn, and a red-team suite probes for jailbreaks in CI. Nothing here is a manual review step — it's automated on every run.",
    href: "/guardrails",
  },
  {
    icon: "gauge",
    hue: "amber",
    tag: "budgets · routing",
    title: "Cost governance",
    description:
      "Every call is metered, with per-agent budgets and hard caps so one runaway agent can't blow the spend. Model routing picks a cheaper model when the task allows it.",
    href: "/usage",
  },
  {
    icon: "git-branch",
    hue: "violet",
    tag: "one-click rollback",
    title: "Versioned publishing",
    description:
      "Publishing an agent creates a new version rather than overwriting the last one. If a change misbehaves in production, rolling back to the previous version is one click.",
    href: "/agents",
  },
];

export function OpsLayer() {
  return (
    <div className="flex flex-col gap-10">
      <Reveal>
        <SectionHeader
          eyebrow="Production Controls"
          hue="red"
          title="The governance layer that makes agents safe to ship"
          tagline="Most agent demos stop at a chat window. Evals, guardrails, cost caps, and versioned rollouts are what separate a production system from a toy."
        />
      </Reveal>

      <div className="grid grid-cols-1 gap-x-8 gap-y-10 md:grid-cols-2">
        {OPS_ITEMS.map((item, i) => (
          <Reveal
            key={item.title}
            delay={i * 80}
            className="border-t border-hairline"
          >
            <Link
              href={item.href}
              aria-label={item.title}
              className="af-hover-nav group flex cursor-pointer flex-col gap-3 rounded-md pt-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <div className="flex items-center gap-3">
                <IconTile icon={item.icon} hue={item.hue} />
                <span className="font-mono text-xs text-accent">
                  {item.tag}
                </span>
              </div>
              <h3 className="font-medium tracking-tight text-foreground">
                {item.title}
              </h3>
              <p className="text-sm text-muted">{item.description}</p>
            </Link>
          </Reveal>
        ))}
      </div>
    </div>
  );
}
