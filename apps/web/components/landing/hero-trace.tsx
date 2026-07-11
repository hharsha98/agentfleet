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
      setVisible(RUN.length);
      return;
    }

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

  return (
    <div className="w-full rounded-lg border border-hairline bg-white/[0.02] p-4 sm:p-5">
      <div className="flex items-center justify-between border-b border-hairline pb-3">
        <span className="font-mono text-xs text-muted">{RUN_ID}</span>
        <span className="flex items-center gap-1.5 font-mono text-xs text-muted">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" />
          live trace
        </span>
      </div>

      <div className="flex flex-col gap-2 pt-3">
        {rows.map((row, i) => {
          const isLast = i === rows.length - 1;
          const inProgress =
            animated && row.kind === "tool" && isLast && visible <= RUN.length;

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
                {row.lines.map((line, j) => (
                  <p key={j}>{line}</p>
                ))}
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
  );
}
