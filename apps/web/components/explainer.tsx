import { Panel } from "@/components/dash/panel";
import { HUE_CLASSES, type Hue } from "@/components/landing/icons";

// Shared explainer primitives (Stage 6). Before this file the numbered
// explainer card existed as FOUR byte-identical private copies —
// app/(app)/voice/page.tsx, app/(app)/guardrails/page.tsx,
// components/landing/deep-dives.tsx (as NumberedExplainerCard) and
// components/landing/workflows.tsx — each with a comment apologising for the
// duplication. They never diverged, so this extraction is a pure lift: the
// markup below is character-for-character what all four rendered.
//
// Server-compatible (no hooks); Panel's Reveal is the only client boundary,
// so this drops into server and "use client" pages alike.

// One numbered card: a hue-tinted number tile, a title, a line of prose.
export function NumberedCard({
  n,
  hue,
  title,
  description,
}: {
  n: number;
  hue: Hue;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-hairline p-6">
      <span
        className={`flex h-8 w-8 items-center justify-center rounded-lg border font-mono text-xs font-medium ${HUE_CLASSES[hue].tile} ${HUE_CLASSES[hue].icon}`}
      >
        {n}
      </span>
      <h4 className="font-medium tracking-tight text-foreground">{title}</h4>
      <p className="text-sm text-muted">{description}</p>
    </div>
  );
}

export type ExplainerStep = {
  title: string;
  description: string;
  hue?: Hue;
};

// The whole "how does this screen work?" block in one call: a Panel wrapping
// a responsive row of NumberedCards, numbered from the array order so adding
// or reordering a step never leaves a stale hand-written `n={2}` behind.
//
// The grid is `sm:grid-cols-3` because every existing explainer has exactly
// three steps; four+ steps wrap to a second row rather than getting narrower,
// which is the right failure mode for a paragraph-per-card layout.
export function HowItWorks({
  title,
  steps,
  delay = 0,
  className = "",
}: {
  title: string;
  steps: ExplainerStep[];
  delay?: number;
  className?: string;
}) {
  return (
    <Panel title={title} className={className} delay={delay}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {steps.map((step, i) => (
          <NumberedCard
            key={step.title}
            n={i + 1}
            hue={step.hue ?? "blue"}
            title={step.title}
            description={step.description}
          />
        ))}
      </div>
    </Panel>
  );
}
