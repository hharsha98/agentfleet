// The single source of truth for "which glow class does this hue get?"
// (UI-6). The recipes themselves — colour, radius, spread, duration — live
// in app/globals.css as .af-glow-* ; this file only maps a hue onto a class
// name so TSX consumers never hand-roll a shadow again. It replaces two
// previously incompatible conventions for the same idea: hero-orbital.tsx's
// local HUE_GLOW map of arbitrary shadow-[...] strings, and app/page.tsx's
// hard-coded rgba(94,106,210,...) CTA shadows.
//
// Every value below is a STATIC string literal, never a template string.
// Same constraint documented in components/dash/bar-chart.tsx:8-9 — a class
// name assembled at runtime like `af-glow-${hue}` is invisible to Tailwind's
// JIT scanner at build time. These particular classes are plain CSS rather
// than Tailwind utilities so they would survive scanning anyway, but keeping
// the maps literal means a consumer can freely mix them with real Tailwind
// classes without having to know which is which. Shape deliberately mirrors
// HUE_CLASSES in components/landing/icons.tsx.
import type { Hue } from "@/components/landing/icons";
import type { TaskStatus } from "@/components/workflow/types";

// The six feature hues plus the one brand accent. `Hue` itself stays
// accent-free (it describes per-feature tinting); glow additionally covers
// the accent, since CTAs and active states glow too.
export type GlowTone = Hue | "accent";

/** Ambient glow — the resting state. Something is present, not active. */
export const HUE_GLOW: Record<GlowTone, string> = {
  blue: "af-glow-blue",
  violet: "af-glow-violet",
  cyan: "af-glow-cyan",
  amber: "af-glow-amber",
  green: "af-glow-green",
  red: "af-glow-red",
  accent: "af-glow-accent",
};

/** State glow — hover, selected, running. Roughly double the ambient. */
export const HUE_GLOW_STRONG: Record<GlowTone, string> = {
  blue: "af-glow-blue-strong",
  violet: "af-glow-violet-strong",
  cyan: "af-glow-cyan-strong",
  amber: "af-glow-amber-strong",
  green: "af-glow-green-strong",
  red: "af-glow-red-strong",
  accent: "af-glow-accent-strong",
};

/**
 * Hue carrier with NO resting shadow. Pair with GLOW_HOVER for a glow that
 * exists only under the cursor — the treatment for brand/identity surfaces
 * (wordmark, icon tiles, agent glyphs), which have no state to report and
 * so must not carry a resting halo. Use HUE_GLOW instead when the glow is
 * reporting a state.
 */
export const HUE_TONE: Record<GlowTone, string> = {
  blue: "af-tone-blue",
  violet: "af-tone-violet",
  cyan: "af-tone-cyan",
  amber: "af-tone-amber",
  green: "af-tone-green",
  red: "af-tone-red",
  accent: "af-tone-accent",
};

/**
 * Compose with any HUE_GLOW entry to escalate ambient -> state on hover.
 * Colour-agnostic: the .af-glow-* class publishes its hue as --glow, and
 * this class reads it, so one class covers all seven tones.
 */
export const GLOW_HOVER = "af-glow-hover";

/**
 * Task status -> glow, the ONE place the board (missions/page.tsx TaskCard)
 * and the run DAG (workflow/nodes.tsx TaskNode) agree about it. Both files
 * already carry "keep these in sync" comments over their duplicated status
 * maps; a glow that disagreed between the two views of the same task would
 * be worse than a colour that did, so this one is shared outright.
 *
 * `TaskStatus` is a type-only import, so this module stays free of any
 * runtime dependency on components/workflow/* (which reaches @xyflow/react)
 * and the landing bundle that imports HUE_GLOW is unaffected.
 *
 * Three statuses map to "" on purpose:
 *  - todo:       nothing has happened yet. A glow would announce an event
 *                that hasn't occurred.
 *  - skipped:    never ran because a dependency died. Not a failure.
 *  - superseded: replaced by a repair plan, its work carried forward. Not a
 *                failure either — missions/page.tsx's COLUMNS comment makes
 *                exactly this argument about not tinting it red or cyan,
 *                and glowing it would break the same promise.
 *
 * Full literal strings (not `${HUE_GLOW.green} animate-glow-in`) so every
 * class name is greppable in source — same discipline as the maps above.
 */
export const TASK_STATUS_GLOW: Record<TaskStatus, string> = {
  todo: "",
  // Accent, breathing: the one status that is still changing.
  in_progress: "af-glow-accent animate-glow-breathe",
  // Loudest thing on the board — a review is what BLOCKS the whole run.
  review: "af-glow-amber-strong",
  // One-shot arrival bloom that settles onto the ambient green.
  done: "af-glow-green animate-glow-in",
  failed: "af-glow-red-strong",
  skipped: "",
  superseded: "",
};
