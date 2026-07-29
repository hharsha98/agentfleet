"use client";

import type { ReactNode } from "react";

import { useReveal } from "./use-reveal";

export function Reveal({
  children,
  delay = 0,
  className = "",
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const { ref, visible, settled } = useReveal<HTMLDivElement>(0.15, delay);

  // Once the reveal has finished, get completely out of the way: no
  // transition-all, no transform utility at all (translate-y-0 would still
  // emit a transform and therefore still create a stacking context and a
  // containing block for absolutely-positioned descendants), and no inline
  // transitionDelay. Otherwise every hover style a caller passes in
  // `className` silently inherits this component's 400ms timing after a
  // dead zone the length of `delay` — which is what made hovers on
  // late-revealing Panels feel broken.
  //
  // Structure is deliberately identical in both states: same single div,
  // same ref, same children, same nesting depth. Only the class string and
  // the presence of the style attribute change.
  return (
    <div
      ref={ref}
      className={
        settled
          ? `opacity-100 ${className}`
          : `transition-all duration-[400ms] ease-out ${
              visible ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"
            } ${className}`
      }
      style={settled ? undefined : { transitionDelay: visible ? `${delay}ms` : "0ms" }}
    >
      {children}
    </div>
  );
}
