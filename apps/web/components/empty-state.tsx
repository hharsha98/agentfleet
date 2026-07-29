import Link from "next/link";
import type { ReactNode } from "react";

// Shared "nothing here yet" block — pure presentation, no data logic, so it
// can be dropped into any page's already-working fetch/loading flow without
// touching that flow. Server component: no hooks, no interactivity.
//
// `glyph` accepts a ReactNode (an inline SVG icon, per-page) rather than an
// emoji string — see the hand-inlined icons at each call site. A default
// muted-stroke "diamond" glyph covers any caller that doesn't pass one.
//
// `action` is either a destination or a callback. It started out href-only,
// which quietly meant "your CTA must be a static link" — so workflows/page.tsx
// (whose CTA has to POST a new workflow and then navigate to the id the API
// hands back) built its own button beside the EmptyState instead, with a
// comment explaining the workaround. The union below is that workaround's
// fix; both arms render the same accent-text affordance, so an empty state
// looks the same whether its CTA navigates or fires.
export function EmptyState({
  glyph = <DefaultGlyph />,
  title,
  description,
  action,
}: {
  glyph?: ReactNode;
  title: string;
  description: string;
  action?:
    | { href: string; label: string }
    | { onClick: () => void; label: string; disabled?: boolean };
}) {
  return (
    <div className="flex flex-col items-center gap-3 py-12 text-center">
      <span
        aria-hidden="true"
        className="flex h-12 w-12 items-center justify-center rounded-full border border-hairline text-muted"
      >
        {glyph}
      </span>
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="max-w-xs text-sm text-muted">{description}</p>
      {action &&
        ("href" in action ? (
          <Link href={action.href} className={ACTION_CLASS}>
            {action.label} →
          </Link>
        ) : (
          <button
            type="button"
            onClick={action.onClick}
            disabled={action.disabled}
            className={`${ACTION_CLASS} disabled:cursor-not-allowed disabled:opacity-40`}
          >
            {action.label} →
          </button>
        ))}
    </div>
  );
}

// One class string for both arms — the whole point of the union is that a
// callback CTA and a link CTA are indistinguishable to the reader.
const ACTION_CLASS =
  "mt-1 cursor-pointer text-sm font-medium text-accent transition-opacity duration-200 hover:opacity-80";

function DefaultGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <path d="M12 3.5 20.5 12 12 20.5 3.5 12Z" />
    </svg>
  );
}
