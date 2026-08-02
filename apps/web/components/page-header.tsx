import { cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";

import { HUE_CLASSES, type Hue } from "@/components/landing/icons";
import { Reveal } from "@/components/landing/reveal";
import { GLOW_HOVER, HUE_TONE } from "@/components/ui/glow";

// Shared page-header idiom for the ten (app) pages (UI-4b): a hue-tinted
// icon tile paired with the page's own h1 and a short plain-language
// explainer, in the same glow-tile idiom as the landing page's IconTile
// (components/landing/icons.tsx — HUE_CLASSES is imported straight from
// there so the tile/glow colors stay identical, rather than redefined here).
//
// `icon` takes a ReactNode (typically `<Icon name="..." />` from
// landing/icons.tsx) rather than an IconName, so this component doesn't
// need to know about the Icon switch — it just clones the hue's size/color
// classes onto whatever element it's given.
//
// Server-compatible: this file has no "use client" directive itself. The
// only client boundary is Reveal (entrance fade/rise), which is already a
// client component, so PageHeader can be dropped into both server pages
// (chat) and "use client" pages (the rest) without forcing either to change.
export function PageHeader({
  icon,
  hue,
  title,
  description,
  children,
}: {
  icon: ReactNode;
  hue: Hue;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  const c = HUE_CLASSES[hue];
  const iconEl = isValidElement(icon)
    ? cloneElement(icon as ReactElement<{ className?: string }>, {
        className: `relative h-5 w-5 ${c.icon}`,
      })
    : icon;

  return (
    <Reveal>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          {/* Same identity-surface treatment as landing/icons.tsx's
              IconTile (this tile is a hand-rolled copy of it): a hue-correct
              glow that exists only under the pointer, never at rest. */}
          <div
            aria-hidden="true"
            className={`relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border ${c.tile} ${HUE_TONE[hue]} ${GLOW_HOVER}`}
          >
            <div
              aria-hidden="true"
              className={`pointer-events-none absolute -inset-2 rounded-full ${c.glow} blur-lg`}
            />
            {iconEl}
          </div>
          <div>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p>
          </div>
        </div>
        {children && <div className="shrink-0">{children}</div>}
      </div>
    </Reveal>
  );
}
