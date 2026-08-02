import type { ReactNode } from "react";

import { HUE_CLASSES, type Hue } from "@/components/landing/icons";
import { Reveal } from "@/components/landing/reveal";
import { HUE_CARD_BORDER } from "@/components/ui/glow";

// Shared explainer primitives (Stage 6). Before this file the numbered
// explainer card existed as FOUR byte-identical private copies —
// app/(app)/voice/page.tsx, app/(app)/guardrails/page.tsx,
// components/landing/deep-dives.tsx (as NumberedExplainerCard) and
// components/landing/workflows.tsx — each with a comment apologising for the
// duplication. They never diverged, so this extraction is a pure lift: the
// markup below is character-for-character what all four rendered.
//
// Server-compatible (no hooks); Reveal is the only client boundary, so this
// drops into server and "use client" pages alike.

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

// The whole "how does this screen work?" block in one call: a responsive
// row of NumberedCards, numbered from the array order so adding or
// reordering a step never leaves a stale hand-written `n={2}` behind.
//
// Collapsed by default behind a native <details>/<summary> — on /agents this
// explainer used to sit ~700px ABOVE the actual product, so a first-time
// viewer saw a manual instead of a tool. <details> needs no client JS, no
// useState, and is keyboard/screen-reader accessible for free, so this stays
// a server component exactly like the Panel-based version it replaces (no
// "use client", no state-in-effect). None of the per-step copy is deleted —
// only demoted behind the closed state.
//
// Card-count-aware grid: every explainer has 3 steps EXCEPT agents/page.tsx's
// AGENT_STEPS, which has 4 — in a fixed 3-column grid that 4th card sat alone
// with a full row of empty space beside it. 4+ steps switch to a 2x4 grid so
// every row stays full; 3 steps keep the original single row.
export function HowItWorks({
  title,
  steps,
  delay = 0,
  className = "",
  hue,
  children,
}: {
  title: string;
  steps: ExplainerStep[];
  delay?: number;
  className?: string;
  // Per-page identity tint (UI-7) — same optional prop, same af-card-<hue>
  // class, as Panel above; this explainer shares the identical af-card
  // bg-surface-1 chrome, so it gets the identical treatment. Independent of
  // each step's own `hue` (NumberedCard's number tile), which is left
  // untouched — a step can legitimately carry a different hue than the
  // page's identity color.
  hue?: Hue;
  // Optional extra prose rendered under the step grid, still inside the
  // closed-by-default <details> — for a page whose explainer needs one more
  // paragraph of nuance (chat's tool_call/artifact/tokens gloss) that used
  // to sit directly below this component, always visible, defeating the
  // point of the collapsed state. Every existing caller omits this, so it
  // is a pure widening, not a breaking change.
  children?: ReactNode;
}) {
  const gridCols = steps.length >= 4 ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-3";

  return (
    <Reveal
      delay={delay}
      className={`af-card bg-surface-1 p-4 sm:p-5 ${hue ? HUE_CARD_BORDER[hue] : ""} ${className}`}
    >
      <details className="group">
        <summary
          className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent [&::-webkit-details-marker]:hidden"
        >
          <span className="text-base font-semibold tracking-tight">{title}</span>
          <span
            aria-hidden="true"
            className="af-menu-chevron shrink-0 text-xs text-muted transition-transform duration-200 group-open:rotate-180"
          >
            ▾
          </span>
        </summary>
        <div className={`mt-4 grid grid-cols-1 gap-4 ${gridCols}`}>
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
        {children}
      </details>
    </Reveal>
  );
}
