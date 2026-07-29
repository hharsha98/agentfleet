// Per-agent visual identity: an icon + hue for each of the 17 builtin
// agents (apps/api/scripts/seed_agents.py), replacing the generic
// name.charAt(0) letter chip used everywhere an agent shows up. Shares the
// hue-tinted icon system from landing/icons.tsx so a builtin agent's glyph
// matches the icon language used across the rest of the landing page.
//
// hueForSlug lives here now — it used to be copy-pasted in roster.tsx,
// chat-ui.tsx, and missions/page.tsx. Every consumer that needs a stable
// slug -> hue color (for a custom agent's fallback chip, or a hue-only use
// like a status dot) should import it from this module instead of
// redefining the hash.

import { HUE_CLASSES, Icon, type Hue, type IconName } from "@/components/landing/icons";
import { GLOW_HOVER, HUE_TONE } from "@/components/ui/glow";

const HUES: Hue[] = ["blue", "violet", "cyan", "amber", "green", "red"];

export function hueForSlug(slug: string): Hue {
  let hash = 0;
  for (let i = 0; i < slug.length; i++) {
    hash = (hash * 31 + slug.charCodeAt(i)) | 0;
  }
  return HUES[Math.abs(hash) % HUES.length];
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
 * builtins, or a hueForSlug-colored letter chip (the old fallback look)
 * for anything else — custom/user-created agents included.
 *
 * Sizes:
 *  - "xs": bare 12px icon/letter, no tile — for tight inline contexts like
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
      <span
        aria-hidden
        className={`flex h-3 w-3 shrink-0 items-center justify-center font-mono text-[8px] font-medium leading-none ${c.icon} ${className}`}
      >
        {letter}
      </span>
    );
  }

  const tileDim = size === "sm" ? "h-5 w-5 rounded-md" : "h-9 w-9 rounded-lg";
  const iconDim = size === "sm" ? "h-2.5 w-2.5" : "h-4 w-4";
  const letterText = size === "sm" ? "text-[10px]" : "text-sm";

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
        <span className={`${c.icon} ${letterText}`}>{letter}</span>
      )}
    </span>
  );
}
