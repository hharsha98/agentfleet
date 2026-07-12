import Link from "next/link";

// Shared "nothing here yet" block — pure presentation, no data logic, so it
// can be dropped into any page's already-working fetch/loading flow without
// touching that flow. Server component: no hooks, no interactivity.
export function EmptyState({
  glyph = "◇",
  title,
  description,
  action,
}: {
  glyph?: string;
  title: string;
  description: string;
  action?: { href: string; label: string };
}) {
  return (
    <div className="flex flex-col items-center gap-2 py-12 text-center">
      <span aria-hidden="true" className="text-3xl text-muted">
        {glyph}
      </span>
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="max-w-xs text-sm text-muted">{description}</p>
      {action && (
        <Link
          href={action.href}
          className="mt-1 text-sm font-medium text-accent hover:opacity-80"
        >
          {action.label} →
        </Link>
      )}
    </div>
  );
}
