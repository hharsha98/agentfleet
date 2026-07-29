"use client";

import { useId, useRef, useState, type ReactNode } from "react";

import { GLOSSARY, type GlossaryKey } from "@/lib/glossary";

// Inline glossary term: <Term k="wave">wave</Term> renders the word with a
// dotted underline and reveals its definition on click or on keyboard focus.
//
// Deliberately NOT a `title=` attribute, which is what the rest of the app
// still uses in a few places. `title` never appears on touch, needs a
// deliberate hover-and-wait on desktop, and screen readers treat it as a
// last-resort fallback rather than content. That is the same failure mode
// that made the workflow builder's save-first behaviour undiscoverable — a
// hint nobody could find is not a hint.
//
// Focus opens the tooltip so a keyboard user gets the definition just by
// tabbing to it, with no second keystroke. A mouse user's click would
// otherwise fire right after the focus that click caused and toggle the
// tooltip straight back shut, so pointer-driven focus is tracked and skipped
// — click alone owns the toggle in that case.
export function Term({ k, children }: { k: GlossaryKey; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const tipId = useId();
  // True between pointerdown and blur: "this focus came from a click, the
  // click handler will deal with it."
  const pointerFocus = useRef(false);

  return (
    <span className="relative inline-block">
      <button
        type="button"
        aria-expanded={open}
        aria-describedby={open ? tipId : undefined}
        onPointerDown={() => {
          pointerFocus.current = true;
        }}
        onClick={() => {
          // The pointer interaction is over by the time click runs (focus
          // always fires first, on pointerdown), so clear the flag here
          // rather than waiting for blur — otherwise it stays set for the
          // element's whole focus lifetime and a later focus that genuinely
          // wasn't pointer-driven would be ignored.
          pointerFocus.current = false;
          setOpen((wasOpen) => !wasOpen);
        }}
        onFocus={() => {
          if (!pointerFocus.current) setOpen(true);
        }}
        onBlur={() => {
          pointerFocus.current = false;
          setOpen(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape" && open) {
            // Stop here rather than letting it bubble to window: the closest
            // dismissible layer should be the one that closes, and the
            // command palette listens for Escape on window.
            e.stopPropagation();
            setOpen(false);
          }
        }}
        // No .af-glow-* here, on purpose: those rules are unlayered, so they
        // beat Tailwind's layered ring-* utilities and would swallow the
        // focus ring on the one element that most needs it (see the
        // "Corollary worth knowing" note in app/globals.css).
        className="cursor-help rounded-sm underline decoration-dotted underline-offset-2 transition-colors duration-200 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        {children ?? k}
      </button>
      {open && (
        <span
          id={tipId}
          role="tooltip"
          className="absolute top-full left-0 z-50 mt-1.5 w-64 max-w-[calc(100vw-2rem)] rounded-md border border-hairline bg-background p-2.5 text-left text-xs leading-relaxed font-normal text-muted normal-case shadow-lg"
        >
          {GLOSSARY[k]}
        </span>
      )}
    </span>
  );
}
