"use client";

// CSS-only 3D hero treatment (UI-4a) — no three.js, no new deps. A
// perspective scene of small floating product-vignette panels, layered
// between AgentNetwork and the headline in page.tsx. Purely decorative
// (aria-hidden), positioned at the edges so the centered headline column
// stays unobstructed.
//
// Mouse-move parallax tilts the whole scene a few degrees toward the
// pointer, damped via requestAnimationFrame + lerp and applied through a
// ref (no re-render per pointer move). Disabled under prefers-reduced-motion
// or a coarse (touch) pointer — panels then sit at their static baked-in
// tilt with no parallax.

import { useEffect, useRef } from "react";

const MAX_TILT_DEG = 4;
const LERP_FACTOR = 0.08;

type Panel = {
  key: string;
  // Placement within the scene (percent from top-left of the hero area).
  top: string;
  left?: string;
  right?: string;
  // Static 3D orientation baked into the panel — stays put even when the
  // pointer-parallax tilt is disabled.
  baseTransform: string;
  // Float animation timing, staggered so the panels don't move in sync.
  floatDuration: string;
  floatDelay: string;
  shadow: string;
  widthClass: string;
  // Hide on mobile to avoid clutter (composition rule: at most one panel <sm).
  mobileVisible: boolean;
  content: React.ReactNode;
};

function TraceCardContent() {
  return (
    <div className="w-full rounded-lg border border-hairline bg-black/40 p-3 shadow-inner backdrop-blur-sm">
      <div className="mb-2 flex items-center justify-between border-b border-hairline pb-1.5">
        <span className="flex items-center gap-1" aria-hidden>
          <span className="h-1.5 w-1.5 rounded-full bg-hue-red/70" />
          <span className="h-1.5 w-1.5 rounded-full bg-hue-amber/70" />
          <span className="h-1.5 w-1.5 rounded-full bg-hue-green/70" />
        </span>
        <span className="font-mono text-[9px] text-muted">run_8f2a1c</span>
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2 rounded border border-hairline bg-white/[0.02] px-1.5 py-1">
          <span className="truncate font-mono text-[9px] text-foreground/80">
            search_documents()
          </span>
          <span className="text-[9px] text-accent">✓</span>
        </div>
        <p className="font-mono text-[9px] leading-relaxed text-foreground/60">
          Drafting 90-day plan…
          <span
            aria-hidden
            className="ml-0.5 inline-block h-2.5 w-[2px] translate-y-0.5 animate-blink-caret bg-accent align-middle"
          />
        </p>
      </div>
    </div>
  );
}

function KanbanCardContent() {
  const cols = ["Backlog", "Doing", "Done"];
  return (
    <div className="w-full rounded-lg border border-hairline bg-black/40 p-3 shadow-inner backdrop-blur-sm">
      <div className="relative grid grid-cols-3 gap-1.5">
        {cols.map((c) => (
          <div key={c} className="flex flex-col gap-1">
            <span className="font-mono text-[8px] uppercase tracking-wide text-muted">
              {c}
            </span>
            <div className="h-6 rounded border border-dashed border-hairline" />
          </div>
        ))}
        <div className="pointer-events-none absolute inset-x-1.5 top-3.5 grid grid-cols-3 gap-1.5">
          <span className="animate-slide-card block h-6 rounded border border-accent/40 bg-accent/15" />
        </div>
      </div>
    </div>
  );
}

function SparklineCardContent() {
  const points = "0,20 10,16 20,17 30,9 40,11 50,4 60,7 70,1 80,6";
  return (
    <div className="flex w-full items-center gap-2 rounded-lg border border-hairline bg-black/40 p-3 shadow-inner backdrop-blur-sm">
      <svg viewBox="0 0 80 22" className="h-6 w-16 shrink-0" aria-hidden>
        <polyline
          points={points}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className="font-mono text-[9px] text-foreground/70">p95 94ms</span>
    </div>
  );
}

const PANELS: Panel[] = [
  {
    key: "trace",
    top: "10%",
    left: "3%",
    baseTransform: "rotateX(8deg) rotateY(16deg) translateZ(-40px)",
    floatDuration: "7.5s",
    floatDelay: "0s",
    shadow: "shadow-[0_25px_50px_-20px_rgba(0,0,0,0.65)]",
    widthClass: "w-36 sm:w-44",
    mobileVisible: false,
    content: <TraceCardContent />,
  },
  {
    key: "kanban",
    top: "58%",
    right: "4%",
    baseTransform: "rotateX(-6deg) rotateY(-14deg) translateZ(-20px)",
    floatDuration: "9s",
    floatDelay: "1.2s",
    shadow: "shadow-[0_25px_50px_-20px_rgba(0,0,0,0.6)]",
    widthClass: "w-40 sm:w-48",
    mobileVisible: true,
    content: <KanbanCardContent />,
  },
  {
    key: "sparkline",
    top: "22%",
    right: "1%",
    baseTransform: "rotateX(10deg) rotateY(-20deg) translateZ(-70px)",
    floatDuration: "6.5s",
    floatDelay: "2.4s",
    shadow: "shadow-[0_20px_40px_-18px_rgba(0,0,0,0.55)]",
    widthClass: "w-32 sm:w-40",
    mobileVisible: false,
    content: <SparklineCardContent />,
  },
];

export function Hero3D() {
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

    // Reduced motion or touch: leave the scene wrapper untransformed so
    // each panel sits at its static baked-in `baseTransform` only.
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

    window.addEventListener("pointermove", handlePointerMove);
    rafId.current = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      if (rafId.current) cancelAnimationFrame(rafId.current);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      aria-hidden
      className="pointer-events-none absolute inset-0 opacity-70 [mask-image:radial-gradient(ellipse_62%_65%_at_50%_45%,transparent_25%,black_82%)]"
      style={{ perspective: "1200px" }}
    >
      <div
        ref={sceneRef}
        className="absolute inset-0"
        style={{ transformStyle: "preserve-3d" }}
      >
        {PANELS.map((panel) => (
          <div
            key={panel.key}
            className={`absolute ${panel.widthClass} ${panel.shadow} ${panel.mobileVisible ? "" : "hidden sm:block"}`}
            style={{
              top: panel.top,
              left: panel.left,
              right: panel.right,
              transform: panel.baseTransform,
              transformStyle: "preserve-3d",
            }}
          >
            <div
              className="animate-float-3d"
              style={{
                animationDuration: panel.floatDuration,
                animationDelay: panel.floatDelay,
              }}
            >
              {panel.content}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
