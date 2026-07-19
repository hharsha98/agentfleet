import { cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";

import { HUE_CLASSES, type Hue } from "@/components/landing/icons";
import { Reveal } from "@/components/landing/reveal";

// Shared dashboard stat tile (UI-5 Chunk D1): a label, a big mono value, an
// optional sub-line (delta/context), and an optional hue-tinted icon tile or
// live "pulse" dot — same glow-tile idiom as PageHeader/IconTile so stat
// rows read as one system with the rest of the app. Server-compatible (no
// hooks of its own); the only client boundary is Reveal, exactly like
// PageHeader, so it can be dropped into server or "use client" pages alike.
export function StatCard({
  label,
  value,
  sub,
  icon,
  hue = "blue",
  pulse = false,
  delay = 0,
  className = "",
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
  hue?: Hue;
  pulse?: boolean;
  delay?: number;
  className?: string;
}) {
  const c = HUE_CLASSES[hue];
  const iconEl = isValidElement(icon)
    ? cloneElement(icon as ReactElement<{ className?: string }>, {
        className: `relative h-4 w-4 ${c.icon}`,
      })
    : icon;

  return (
    <Reveal
      delay={delay}
      className={`rounded-lg border border-hairline p-4 transition-colors duration-200 hover:border-accent/30 ${className}`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs text-muted">{label}</p>
        {pulse ? (
          <span className="relative flex h-2 w-2 shrink-0 translate-y-0.5" aria-hidden="true">
            <span
              className={`absolute inline-flex h-full w-full animate-pulse-soft rounded-full ${c.icon.replace("text-", "bg-")}`}
            />
            <span className={`relative inline-flex h-2 w-2 rounded-full ${c.icon.replace("text-", "bg-")}`} />
          </span>
        ) : icon ? (
          <div
            aria-hidden="true"
            className={`relative flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-md border ${c.tile}`}
          >
            <div
              aria-hidden="true"
              className={`pointer-events-none absolute -inset-2 rounded-full ${c.glow} blur-lg`}
            />
            {iconEl}
          </div>
        ) : null}
      </div>
      <p className="mt-1 truncate font-mono text-2xl font-medium sm:text-3xl">{value}</p>
      {sub && <p className="mt-1 text-xs text-muted">{sub}</p>}
    </Reveal>
  );
}
