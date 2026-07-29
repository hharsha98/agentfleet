// The AgentFleet mark. Hand-inlined SVG — no icon package, no image asset —
// so it inherits currentColor and sits in exactly the same stroke family as
// the 30 glyphs in components/landing/icons.tsx: 24x24 grid, fill="none",
// stroke="currentColor", strokeWidth 1.75, round caps and joins.
//
// Shape: a three-node DAG in delta formation — one lead node at the apex,
// two trailing nodes at the base, two edges. It is built to read three ways
// at once: a graph (the agent topology), an arrowhead (a *fleet*, with a
// direction of travel), and an "A".
//
// The lead node is filled rather than stroked. Three reasons: it is the
// arrow's tip and needs the visual weight; it marks the orchestrator in the
// graph reading; and a solid dot is the one element that still resolves at
// 16px, which is what app/icon.svg has to survive. Filling a small circle
// with `fill="currentColor" stroke="none"` is already the house idiom —
// see the gauge, radar, palette and stethoscope glyphs in icons.tsx.
//
// The two edges are trimmed short of each node's radius (2.25 + a 0.45
// breathing gap) so a stroke never runs into a node outline at any size.

export function LogoMark({
  className,
  size = 20,
}: {
  className?: string;
  size?: number;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {/* Lead node / arrow tip. */}
      <circle cx="12" cy="4.75" r="2.25" fill="currentColor" stroke="none" />
      {/* Two trailing nodes. */}
      <circle cx="4.75" cy="18.5" r="2.25" />
      <circle cx="19.25" cy="18.5" r="2.25" />
      {/* Two edges — the legs of the "A", the sides of the arrowhead. */}
      <path d="M10.74 7.14 6.01 16.11" />
      <path d="M13.26 7.14 17.99 16.11" />
    </svg>
  );
}

/**
 * Mark + "AgentFleet". The one lockup used in both headers (the landing
 * page's and the app shell's), so the two can never drift apart.
 *
 * The mark carries the accent and the text stays foreground: that keeps the
 * brand colour present without turning the whole wordmark into a coloured
 * blob next to the muted nav links. The text keeps the exact
 * `font-medium tracking-tight` treatment the bare text had before, so
 * swapping this in changes nothing about the type.
 *
 * Deliberately renders no glow of its own — callers own that. app-nav.tsx
 * wraps this in the span that carries the Stage 4 accent hover bloom.
 */
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <LogoMark className="shrink-0 text-accent" size={20} />
      <span className="font-medium tracking-tight">AgentFleet</span>
    </span>
  );
}
