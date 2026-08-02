import type { ReactNode } from "react";

import type { Hue } from "@/components/landing/icons";
import { Reveal } from "@/components/landing/reveal";
import { HUE_CARD_BORDER } from "@/components/ui/glow";

// Shared dashboard panel (UI-5 Chunk D1): a titled card container with a
// header row (title + optional muted description + optional action slot,
// e.g. a button or a filter input) and a content area below. Used to frame
// the existing upload/list/budget/eval-case UIs on the documents, usage,
// and evals pages without touching their internal data flow — this is pure
// layout chrome around whatever `children` a page already renders.
// Server-compatible (no hooks); Reveal is the only client boundary.
export function Panel({
  title,
  description,
  action,
  children,
  className = "",
  delay = 0,
  hue,
}: {
  title: string;
  // ReactNode, not string: a couple of panels need the visible description
  // to stay short while keeping a long-form explanation one click away (see
  // missions/page.tsx's Board panel), which means embedding a <Term> inline.
  // Every existing call site passes a plain string, which ReactNode still
  // accepts, so this is a widening, not a breaking change.
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  delay?: number;
  // Per-page identity tint (UI-7), optional so existing call sites that
  // pass none keep .af-card's plain white top edge unchanged. Callers pass
  // their page's own hue — the same one already going into that page's
  // PageHeader — so every panel on a page picks up a consistent identity
  // colour instead of the app reading as one undifferentiated grey.
  hue?: Hue;
}) {
  return (
    // No hover styling, deliberately: a Panel is a container, not a
    // control. Lighting its border under the cursor promised a click that
    // never existed — 26 times over. Clickable things get .af-hover-nav.
    // .af-card supplies the hairline border + radius + state transition
    // (UI-6); bg-surface-1 gives the panel an actual elevated fill instead
    // of a transparent box on the page background, so 26 panels stop
    // reading as outlines-only on pure black. af-card-<hue> (UI-7), when a
    // hue is passed, overrides just .af-card's top-edge colour — a static
    // class, never a hue-${x} template string, so Tailwind's JIT scanner
    // (which cannot see dynamically-built class names) still finds it.
    //
    // Re-tried .af-glass here after app/(app)/layout.tsx grew an ambient
    // ground (UI-7) — the reasoning being that .af-glass would finally have
    // something behind it to blur. Screenshot + pixel diff against this
    // bg-surface-1 version showed only a faint, uniform tint (max channel
    // delta ~17/255) and no visible glass texture: Panel sits well below
    // where .af-app-ground's radial glow has already faded to ~0, so
    // there's still nothing with enough contrast back there to blur into
    // something that reads as glass. Kept the flat fill.
    <Reveal
      delay={delay}
      className={`af-card bg-surface-1 p-4 sm:p-5 ${hue ? HUE_CARD_BORDER[hue] : ""} ${className}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-tight">{title}</h2>
          {description && <p className="mt-0.5 max-w-md text-xs text-muted">{description}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      <div className="mt-4">{children}</div>
    </Reveal>
  );
}
