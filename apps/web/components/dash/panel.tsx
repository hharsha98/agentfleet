import type { ReactNode } from "react";

import { Reveal } from "@/components/landing/reveal";

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
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  return (
    <Reveal
      delay={delay}
      className={`rounded-lg border border-hairline p-4 transition-colors duration-200 hover:border-accent/20 sm:p-5 ${className}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium">{title}</h2>
          {description && <p className="mt-0.5 max-w-md text-xs text-muted">{description}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      <div className="mt-4">{children}</div>
    </Reveal>
  );
}
