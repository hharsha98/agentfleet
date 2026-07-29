// Per-agent visual identity: an icon + hue for each of the 17 builtin
// agents (apps/api/scripts/seed_agents.py), replacing the generic
// name.charAt(0) letter chip used everywhere an agent shows up. Shares the
// hue-tinted icon system from landing/icons.tsx so a builtin agent's glyph
// matches the icon language used across the rest of the landing page.
//
// hueForSlug lives here now — it used to be copy-pasted in roster.tsx,
// chat-ui.tsx, and missions/page.tsx. Every consumer that needs a stable
// slug -> hue color (for a custom agent's fallback glyph, or a hue-only use
// like a status dot) should import it from this module instead of
// redefining the hash.

import { HUE_CLASSES, Icon, type Hue, type IconName } from "@/components/landing/icons";
import { GLOW_HOVER, HUE_TONE } from "@/components/ui/glow";

const HUES: Hue[] = ["blue", "violet", "cyan", "amber", "green", "red"];

// The hash hueForSlug has always used, lifted out so the generated glyph can
// be seeded from the SAME number. Extracted rather than recomputed: an agent's
// colour and its pattern must be two readings of one identity, and a second
// hash function would let them drift. Unchanged arithmetic (`* 31 + charCode`,
// coerced to int32 each step), so every existing slug keeps the exact hue it
// had — agent-board.tsx and workflow/nodes.tsx import hueForSlug separately
// and would visibly disagree with the tile if this shifted by one.
function hashSlug(slug: string): number {
  let hash = 0;
  for (let i = 0; i < slug.length; i++) {
    hash = (hash * 31 + slug.charCodeAt(i)) | 0;
  }
  return hash;
}

export function hueForSlug(slug: string): Hue {
  return HUES[Math.abs(hashSlug(slug)) % HUES.length];
}

/**
 * The fallback identity for any agent that is not one of the 17 builtins: a
 * deterministic 3x3 dot matrix seeded from hashSlug, on the same 24 grid as
 * every glyph in landing/icons.tsx.
 *
 * Three decisions make it read as designed rather than as noise:
 *
 *  - It is mirror-symmetric. Only the left and centre columns are derived
 *    from the hash (three bits each); the right column mirrors the left.
 *    Identicon logic — bilateral symmetry is most of what separates "a mark"
 *    from "random dots", and it also halves the ways a pattern can look
 *    lopsided next to a hand-drawn builtin icon.
 *  - All nine cells are always drawn. An "off" cell shrinks to r=1.25 instead
 *    of disappearing, so the 3x3 silhouette is constant across every agent
 *    and a sparse hash can never degrade to one lonely dot at 12px.
 *  - The centre cell is forced on, guaranteeing an optical anchor. That costs
 *    one bit: 2^6 = 64 patterns become 32 distinct ones, still far more than
 *    the handful of custom agents that share a screen.
 */
function GeneratedGlyph({
  slug,
  title,
  className,
}: {
  slug: string;
  title: string;
  className?: string;
}) {
  const hash = hashSlug(slug);
  const coords = [5.5, 12, 18.5];

  return (
    // aria-hidden is kept exactly as the letter chip had it: this tile is
    // decorative at all eight call sites — the agent's name is always
    // rendered as real text beside it — and un-hiding it now would make
    // every roster and mission card announce a stray character. The letter
    // survives as the SVG <title>, which is the hover tooltip: that is the
    // affordance a sighted user loses when the letter leaves the tile.
    <svg viewBox="0 0 24 24" className={className} aria-hidden fill="currentColor">
      <title>{title}</title>
      {coords.map((cy, row) =>
        coords.map((cx, col) => {
          // col 2 reads col 0's bit — that is the mirror.
          const bit = col === 1 ? row + 3 : row;
          const on = row === 1 && col === 1 ? true : ((hash >> bit) & 1) === 1;
          return (
            <circle key={`${row}-${col}`} cx={cx} cy={cy} r={on ? 3 : 1.25} />
          );
        }),
      )}
    </svg>
  );
}

// Builtin roster only. A user-created agent's slug won't be a key here, so
// AgentGlyph falls through to the letter-chip fallback below for those.
export const AGENT_VISUALS: Record<string, { icon: IconName; hue: Hue }> = {
  orchestrator: { icon: "network", hue: "cyan" },
  "deep-research": { icon: "search", hue: "amber" },
  "creative-writer": { icon: "palette", hue: "violet" },
  "system-architect": { icon: "server", hue: "blue" },
  "sql-analytics": { icon: "database", hue: "red" },
  "competitor-monitor": { icon: "radar", hue: "amber" },
  "meeting-notes": { icon: "clipboard-list", hue: "violet" },
  outreach: { icon: "mail", hue: "cyan" },
  "fact-checker": { icon: "shield", hue: "green" },
  "data-analyst": { icon: "chart-column", hue: "blue" },
  "market-intelligence": { icon: "trending-up", hue: "amber" },
  "patent-scout": { icon: "scroll-text", hue: "cyan" },
  "code-reviewer": { icon: "code", hue: "green" },
  "resume-builder": { icon: "briefcase", hue: "violet" },
  "youtube-research": { icon: "play", hue: "red" },
  "clinical-research": { icon: "stethoscope", hue: "cyan" },
  "web-navigator": { icon: "globe", hue: "blue" },
};

type GlyphSize = "xs" | "sm" | "md";

/**
 * A hue-tinted agent avatar. Renders the agent's real icon for the 17
 * builtins, or — for anything else, custom/user-created agents included —
 * the deterministic GeneratedGlyph above, hue and pattern both seeded from
 * the slug. This replaces the first-letter chip, which made every custom
 * agent read as unhandled next to a builtin's drawn icon.
 *
 * Sizes:
 *  - "xs": bare 12px icon/glyph, no tile — for tight inline contexts like
 *    the missions board's agent chip (was a plain colored dot before).
 *  - "sm": 20px tile — chat's agent-picker strip, agent-builder cards.
 *  - "md": 36px tile — landing roster cards.
 */
export function AgentGlyph({
  slug,
  name,
  size = "md",
  className = "",
}: {
  slug: string;
  name: string;
  size?: GlyphSize;
  className?: string;
}) {
  const visual = AGENT_VISUALS[slug];
  const hue = visual?.hue ?? hueForSlug(slug);
  const c = HUE_CLASSES[hue];
  const letter = name.charAt(0).toUpperCase();

  if (size === "xs") {
    return visual ? (
      <Icon
        name={visual.icon}
        className={`h-3 w-3 shrink-0 ${c.icon} ${className}`}
      />
    ) : (
      <GeneratedGlyph
        slug={slug}
        title={letter}
        className={`h-3 w-3 shrink-0 ${c.icon} ${className}`}
      />
    );
  }

  const tileDim = size === "sm" ? "h-5 w-5 rounded-md" : "h-9 w-9 rounded-lg";
  const iconDim = size === "sm" ? "h-2.5 w-2.5" : "h-4 w-4";

  return (
    // Identity surface — this tile IS the agent's logo, so it gets the
    // hover bloom (HUE_TONE + GLOW_HOVER, no resting halo). Only the sm/md
    // tile branch: the "xs" branch above renders a bare glyph inside mission
    // cards and graph nodes, where glow is reserved for task state and a
    // hover bloom would compete with it.
    <span
      aria-hidden
      className={`flex ${tileDim} shrink-0 items-center justify-center border font-mono font-medium ${c.tile} ${HUE_TONE[hue]} ${GLOW_HOVER} ${className}`}
    >
      {visual ? (
        <Icon name={visual.icon} className={`${iconDim} ${c.icon}`} />
      ) : (
        <GeneratedGlyph
          slug={slug}
          title={letter}
          className={`${iconDim} ${c.icon}`}
        />
      )}
    </span>
  );
}
