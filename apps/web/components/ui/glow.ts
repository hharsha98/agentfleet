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
 * Compose with any HUE_GLOW entry to escalate ambient -> state on hover.
 * Colour-agnostic: the .af-glow-* class publishes its hue as --glow, and
 * this class reads it, so one class covers all seven tones.
 */
export const GLOW_HOVER = "af-glow-hover";
