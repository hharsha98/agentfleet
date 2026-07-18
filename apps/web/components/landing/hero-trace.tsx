"use client";

import { useEffect, useRef, useState } from "react";

type Row =
  | { kind: "phase"; text: string }
  | { kind: "tool"; text: string; duration: string }
  | { kind: "stream"; lines: string[] }
  | { kind: "done"; tokens: string; cost: string; time: string };

const RUN: Row[] = [
  { kind: "phase", text: "▸ orchestrator · planning" },
  {
    kind: "tool",
    text: 'web_search("German AI job market")',
    duration: "1.2s",
  },
  {
    kind: "tool",
    text: 'search_documents("salary bands")',
    duration: "0.4s",
  },
  { kind: "phase", text: "▸ creative-writer · drafting" },
  {
    kind: "stream",
    lines: [
      "Berlin's AI market rewards shipped proof over credentials.",
      "Drafting a 90-day plan: 3 portfolio agents, 1 open-source repo…",
    ],
  },
  { kind: "done", tokens: "↑1,240 ↓856 tok", cost: "$0.00", time: "4.9s" },
];

const STEP_MS = 700;
const PAUSE_MS = 2200;
const RUN_ID = "run_8f2a1c";

export function HeroTrace() {
  const [visible, setVisible] = useState(RUN.length);
  const [animated, setAnimated] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    if (reduceMotion) {
      // `visible` already defaults to RUN.length (see useState above), so
      // reduced-motion visitors see the full trace with no re-render needed.
      return;
    }

    // One-time client-mount kickoff for a self-contained demo animation
    // (no external system to subscribe to) — the standard "run this once
    // after mount" escape hatch, not a synchronization loop.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAnimated(true);

    function tick(step: number) {
      if (step > RUN.length) {
        timeoutRef.current = setTimeout(() => tick(0), PAUSE_MS);
        return;
      }
      setVisible(step);
      timeoutRef.current = setTimeout(() => tick(step + 1), STEP_MS);
    }

    tick(0);
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const rows = animated ? RUN.slice(0, visible) : RUN;
  const isStreaming = animated && visible > 0 && visible <= RUN.length;

  return (
    <div className="relative w-full">
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-px rounded-xl bg-gradient-to-br from-accent/30 via-transparent to-transparent opacity-60 blur-[2px]"
      />
      <div className="relative w-full rounded-xl border border-hairline bg-white/[0.03] p-4 shadow-[0_0_0_1px_rgba(255,255,255,0.02),0_20px_60px_-20px_rgba(94,106,210,0.35)] sm:p-5">
        <div className="flex items-center justify-between border-b border-hairline pb-3">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5" aria-hidden>
              <span className="h-2.5 w-2.5 rounded-full bg-hue-red/70" />
              <span className="h-2.5 w-2.5 rounded-full bg-hue-amber/70" />
              <span className="h-2.5 w-2.5 rounded-full bg-hue-green/70" />
            </span>
            <span className="font-mono text-xs text-muted">{RUN_ID}</span>
          </div>
          <span className="flex items-center gap-1.5 font-mono text-xs text-muted">
            <span
              className={`h-1.5 w-1.5 rounded-full bg-accent ${isStreaming ? "animate-pulse-soft" : ""}`}
            />
            live trace
          </span>
        </div>

        <div className="flex flex-col gap-2 pt-3">
          {rows.map((row, i) => {
            const isLast = i === rows.length - 1;
            const inProgress =
              animated && row.kind === "tool" && isLast && visible <= RUN.length;
            const streamInProgress =
              animated && row.kind === "stream" && isLast && visible <= RUN.length;

            if (row.kind === "phase") {
              return (
                <div
                  key={i}
                  className="font-mono text-xs uppercase tracking-wide text-accent"
                >
                  {row.text}
                </div>
              );
            }

            if (row.kind === "tool") {
              return (
                <div
                  key={i}
                  className="flex items-center justify-between gap-3 rounded-md border border-hairline bg-white/[0.02] px-3 py-2"
                >
                  <span className="truncate font-mono text-xs text-foreground/90">
                    {row.text}
                  </span>
                  {inProgress ? (
                    <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-accent/25 border-t-accent" />
                  ) : (
                    <span className="flex shrink-0 items-center gap-2 font-mono text-xs text-muted">
                      <span className="text-accent">✓</span>
                      {row.duration}
                    </span>
                  )}
                </div>
              );
            }

            if (row.kind === "stream") {
              return (
                <div
                  key={i}
                  className="rounded-md border border-hairline bg-white/[0.02] px-3 py-2 text-sm leading-relaxed text-foreground/80"
                >
                  {row.lines.map((line, j) => {
                    const isLastLine = j === row.lines.length - 1;
                    return (
                      <p key={j}>
                        {line}
                        {isLastLine && streamInProgress ? (
                          <span
                            aria-hidden
                            className="ml-0.5 inline-block h-3.5 w-[2px] translate-y-0.5 animate-blink-caret bg-accent align-middle"
                          />
                        ) : null}
                      </p>
                    );
                  })}
                </div>
              );
            }

            return (
              <div
                key={i}
                className="mt-1 flex items-center justify-between border-t border-hairline pt-3 font-mono text-xs text-muted"
              >
                <span className="text-accent">✓ done</span>
                <span>
                  {row.tokens} · {row.cost} · {row.time}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
