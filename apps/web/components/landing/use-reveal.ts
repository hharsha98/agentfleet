"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Reveals an element (fade + translate) the first time it scrolls into view.
 * Honors prefers-reduced-motion by revealing immediately, no animation.
 *
 * Returns `settled` alongside `visible`: true once the reveal transition has
 * actually finished, so the caller can strip the reveal's transition,
 * transform and delay afterwards. Without it the element keeps a 400ms
 * `transition-all` and a persistent `transition-delay` forever, and every
 * later hover on that element inherits both — which reads as a dead zone the
 * length of `revealDelay` followed by a sluggish 400ms response.
 *
 * @param threshold   IntersectionObserver visibility ratio to trigger on.
 * @param revealDelay The transition-delay (ms) the caller applies, used to
 *                    size the settle fallback timer.
 */
export function useReveal<T extends HTMLElement>(threshold = 0.15, revealDelay = 0) {
  const ref = useRef<T | null>(null);
  const [visible, setVisible] = useState(false);
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      // This must run in an effect, not render or a lazy useState
      // initialiser: `window` doesn't exist during SSR, and reading
      // matchMedia during render would make the server render visible=false
      // while the client's first render (post-hydration) computes true —
      // a hydration mismatch. Running it here means the flip to visible
      // happens synchronously right after mount, which is what "reveal
      // immediately, no animation" requires for reduced-motion users.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [threshold]);

  // Mark settled when the reveal transition actually ends.
  //
  // The setTimeout is not belt-and-braces, it is load-bearing: the
  // reduced-motion branch above flips `visible` synchronously, so the
  // element never transitions and `transitionend` never fires. Same story
  // if the element is display:none'd mid-reveal, or if the browser drops
  // the transition. revealDelay + 450 clears the caller's own delay plus
  // the 400ms transition with a little slack.
  useEffect(() => {
    if (!visible) return;

    const el = ref.current;
    const settle = () => setSettled(true);
    // transitionend bubbles, so a child transitioning (a button's hover
    // colour, say) mid-reveal would otherwise settle us early and snap the
    // transform off before the reveal finished.
    const onEnd = (e: TransitionEvent) => {
      if (e.target === el) settle();
    };

    el?.addEventListener("transitionend", onEnd);
    const fallback = window.setTimeout(settle, revealDelay + 450);

    return () => {
      el?.removeEventListener("transitionend", onEnd);
      window.clearTimeout(fallback);
    };
  }, [visible, revealDelay]);

  return { ref, visible, settled };
}
