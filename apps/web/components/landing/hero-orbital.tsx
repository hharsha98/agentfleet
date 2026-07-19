"use client";

// Orbital "fleet" hero visual — replaces the old 3D trace/kanban/sparkline
// panel cluster (hero-3d.tsx, deleted). A center "core" tile dispatches
// work outward to nine flagship agents riding three concentric, slowly
// spinning orbit rings, with a hardcoded starfield behind everything for
// depth. Pure CSS transforms — no canvas, no three.js, no new deps.
//
// Mouse-move parallax tilts the whole scene toward the pointer, same
// rAF + lerp pattern hero-3d.tsx used (damped, applied via a ref so there's
// no per-frame re-render), now also resetting back to neutral on
// pointerleave. Disabled under prefers-reduced-motion or a coarse (touch)
// pointer, same as before — the scene then sits flat with every orbit ring
// and node in its static (unrotated, upright) resting position.

import { useEffect, useRef } from "react";

import { AGENT_VISUALS, AgentGlyph } from "@/components/agent-visual";
import type { Hue } from "@/components/landing/icons";
import { Icon } from "@/components/landing/icons";

const MAX_TILT_DEG = 8;
const LERP_FACTOR = 0.08;

// Hardcoded (not Math.random) so server and client render the same
// markup — a random starfield would mismatch on hydration.
const STARS: {
  top: number;
  left: number;
  size: number;
  opacity: number;
  pulse?: boolean;
}[] = [
  { top: 8, left: 12, size: 1.5, opacity: 0.3 },
  { top: 15, left: 42, size: 1, opacity: 0.2 },
  { top: 22, left: 78, size: 2, opacity: 0.35, pulse: true },
  { top: 30, left: 5, size: 1, opacity: 0.18 },
  { top: 35, left: 60, size: 1.5, opacity: 0.28 },
  { top: 40, left: 88, size: 1, opacity: 0.22 },
  { top: 45, left: 25, size: 2, opacity: 0.4, pulse: true },
  { top: 50, left: 50, size: 1, opacity: 0.15 },
  { top: 55, left: 15, size: 1.5, opacity: 0.3 },
  { top: 60, left: 72, size: 1, opacity: 0.2 },
  { top: 65, left: 35, size: 2, opacity: 0.38, pulse: true },
  { top: 70, left: 92, size: 1, opacity: 0.18 },
  { top: 75, left: 8, size: 1.5, opacity: 0.32 },
  { top: 78, left: 55, size: 1, opacity: 0.22 },
  { top: 82, left: 28, size: 2, opacity: 0.36, pulse: true },
  { top: 85, left: 80, size: 1, opacity: 0.2 },
  { top: 88, left: 45, size: 1.5, opacity: 0.28 },
  { top: 92, left: 18, size: 1, opacity: 0.16 },
  { top: 95, left: 65, size: 2, opacity: 0.34, pulse: true },
  { top: 10, left: 90, size: 1, opacity: 0.2 },
  { top: 18, left: 25, size: 1.5, opacity: 0.26 },
  { top: 28, left: 48, size: 1, opacity: 0.18 },
  { top: 58, left: 5, size: 1.5, opacity: 0.3 },
  { top: 90, left: 95, size: 1, opacity: 0.2 },
];

type OrbitNode = {
  slug: keyof typeof AGENT_VISUALS;
  name: string;
  // Degrees clockwise from 12 o'clock — converted to a left/top percentage
  // (relative to the node's own ring container) below, so positioning
  // survives the ring's CSS rotation for free instead of fighting it with
  // a transform-based translateX.
  angleDeg: number;
};

type Ring = {
  key: string;
  sizePct: number;
  durationSec: number;
  reverse: boolean;
  nodes: OrbitNode[];
};

const RINGS: Ring[] = [
  {
    key: "outer",
    sizePct: 100,
    durationSec: 90,
    reverse: false,
    nodes: [
      { slug: "deep-research", name: "Deep Research", angleDeg: 15 },
      { slug: "creative-writer", name: "Creative Writer", angleDeg: 100 },
      { slug: "market-intelligence", name: "Market Intelligence", angleDeg: 195 },
      { slug: "web-navigator", name: "Web Navigator", angleDeg: 280 },
    ],
  },
  {
    key: "middle",
    sizePct: 72,
    durationSec: 60,
    reverse: true,
    nodes: [
      { slug: "data-analyst", name: "Data Analyst", angleDeg: 60 },
      { slug: "youtube-research", name: "YouTube Research", angleDeg: 180 },
      { slug: "clinical-research", name: "Clinical Research", angleDeg: 300 },
    ],
  },
  {
    key: "inner",
    sizePct: 46,
    durationSec: 40,
    reverse: false,
    nodes: [
      { slug: "code-reviewer", name: "Code Reviewer", angleDeg: 45 },
      { slug: "fact-checker", name: "Fact Checker", angleDeg: 225 },
    ],
  },
];

// left/top percentage on a circle of radius 50% (i.e. touching the edge
// of whatever square container it's computed against), 0deg = 12 o'clock,
// clockwise. Pure deterministic math — safe at both render and hydration.
function pointOnRing(angleDeg: number) {
  const rad = (angleDeg * Math.PI) / 180;
  return {
    left: 50 + 50 * Math.sin(rad),
    top: 50 - 50 * Math.cos(rad),
  };
}

const HUE_GLOW: Record<Hue, string> = {
  blue: "shadow-[0_0_16px_2px_color-mix(in_srgb,var(--hue-blue)_45%,transparent)]",
  violet: "shadow-[0_0_16px_2px_color-mix(in_srgb,var(--hue-violet)_45%,transparent)]",
  cyan: "shadow-[0_0_16px_2px_color-mix(in_srgb,var(--hue-cyan)_45%,transparent)]",
  amber: "shadow-[0_0_16px_2px_color-mix(in_srgb,var(--hue-amber)_45%,transparent)]",
  green: "shadow-[0_0_16px_2px_color-mix(in_srgb,var(--hue-green)_45%,transparent)]",
  red: "shadow-[0_0_16px_2px_color-mix(in_srgb,var(--hue-red)_45%,transparent)]",
};

function OrbitNodeTile({ node, ring }: { node: OrbitNode; ring: Ring }) {
  const { left, top } = pointOnRing(node.angleDeg);
  const hue = AGENT_VISUALS[node.slug]?.hue ?? "blue";

  return (
    <div
      className="absolute -translate-x-1/2 -translate-y-1/2"
      style={{
        left: `${left}%`,
        top: `${top}%`,
        transform: "translate(-50%, -50%) translateZ(40px)",
      }}
    >
      {/* Counter-spins at the ring's own rate/direction, reversed — the
          net rotation on this subtree stays 0deg, so the tile and its
          label stay upright while the ring itself keeps orbiting them. */}
      <div
        className={ring.reverse ? "animate-orbit-spin" : "animate-orbit-spin-reverse"}
        style={{ animationDuration: `${ring.durationSec}s` }}
      >
        <div className="group relative">
          <div
            className={`rounded-lg transition-transform duration-200 group-hover:scale-125 ${HUE_GLOW[hue]}`}
          >
            <AgentGlyph slug={node.slug} name={node.name} size="md" />
          </div>
          <span className="pointer-events-none absolute left-1/2 top-full mt-1.5 -translate-x-1/2 whitespace-nowrap font-mono text-[9px] text-muted opacity-0 transition-opacity duration-200 group-hover:opacity-100">
            {node.name}
          </span>
        </div>
      </div>
    </div>
  );
}

export function HeroOrbital() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<HTMLDivElement | null>(null);
  const target = useRef({ x: 0, y: 0 });
  const current = useRef({ x: 0, y: 0 });
  const rafId = useRef<number | null>(null);

  useEffect(() => {
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const coarsePointer = window.matchMedia("(pointer: coarse)").matches;

    if (reduceMotion || coarsePointer) {
      return;
    }

    function handlePointerMove(e: PointerEvent) {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const inside =
        e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom;
      if (!inside) return;

      const relX = (e.clientX - rect.left) / rect.width;
      const relY = (e.clientY - rect.top) / rect.height;
      target.current = {
        x: (0.5 - relY) * 2 * MAX_TILT_DEG,
        y: (relX - 0.5) * 2 * MAX_TILT_DEG,
      };
    }

    function handlePointerLeave() {
      target.current = { x: 0, y: 0 };
    }

    function tick() {
      const cur = current.current;
      const tgt = target.current;
      cur.x += (tgt.x - cur.x) * LERP_FACTOR;
      cur.y += (tgt.y - cur.y) * LERP_FACTOR;
      if (sceneRef.current) {
        sceneRef.current.style.transform = `rotateX(${cur.x.toFixed(2)}deg) rotateY(${cur.y.toFixed(2)}deg)`;
      }
      rafId.current = requestAnimationFrame(tick);
    }

    const el = containerRef.current;
    window.addEventListener("pointermove", handlePointerMove);
    el?.addEventListener("pointerleave", handlePointerLeave);
    rafId.current = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      el?.removeEventListener("pointerleave", handlePointerLeave);
      if (rafId.current) cancelAnimationFrame(rafId.current);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      aria-hidden
      className="relative mx-auto aspect-square w-[280px] sm:w-[380px] lg:w-[520px]"
      style={{ perspective: "1000px" }}
    >
      <div
        ref={sceneRef}
        className="absolute inset-0"
        style={{ transformStyle: "preserve-3d" }}
      >
        {/* (a) Starfield — back layer. */}
        <div
          className="absolute inset-0"
          style={{ transform: "translateZ(-40px)" }}
        >
          {STARS.map((s, i) => (
            <span
              key={i}
              className={`absolute rounded-full bg-foreground ${s.pulse ? "animate-pulse-soft" : ""}`}
              style={{
                top: `${s.top}%`,
                left: `${s.left}%`,
                width: `${s.size}px`,
                height: `${s.size}px`,
                opacity: s.opacity,
              }}
            />
          ))}
        </div>

        {/* (b) + (c) Orbit rings and their agent nodes. */}
        {RINGS.map((ring) => (
          <div
            key={ring.key}
            className={`absolute rounded-full border border-hairline/60 ${
              ring.reverse ? "animate-orbit-spin-reverse" : "animate-orbit-spin"
            }`}
            style={{
              width: `${ring.sizePct}%`,
              height: `${ring.sizePct}%`,
              top: `${(100 - ring.sizePct) / 2}%`,
              left: `${(100 - ring.sizePct) / 2}%`,
              animationDuration: `${ring.durationSec}s`,
              transformStyle: "preserve-3d",
            }}
          >
            {ring.nodes.map((node) => (
              <OrbitNodeTile key={node.slug} node={node} ring={ring} />
            ))}
          </div>
        ))}

        {/* (d) Center core — front-most layer, dispatching agents outward. */}
        <div
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
          style={{ transform: "translate(-50%, -50%) translateZ(80px)" }}
        >
          <div className="relative flex h-[72px] w-[72px] items-center justify-center">
            <div
              aria-hidden
              className="pointer-events-none absolute -inset-4 rounded-full bg-accent/25 blur-2xl"
            />
            <span
              aria-hidden
              className="animate-core-ping absolute inset-0 rounded-2xl border-2 border-accent/40"
            />
            <span
              aria-hidden
              className="animate-core-ping absolute inset-0 rounded-2xl border-2 border-accent/40"
              style={{ animationDelay: "2s" }}
            />
            <div className="relative flex h-full w-full items-center justify-center rounded-2xl border border-accent/30 bg-accent/10 backdrop-blur-sm">
              <Icon name="workflow" className="h-8 w-8 text-accent" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
