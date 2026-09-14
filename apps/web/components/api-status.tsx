"use client";

import { useEffect, useState } from "react";

import { loadPublicConfig } from "@/lib/public-config";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function ApiStatus() {
  const [state, setState] = useState<"ok" | "waking" | "down">("ok");

  useEffect(() => {
    let cancelled = false;
    const delays = [0, 2000, 4000, 8000, 16000, 32000];

    (async () => {
      const cfg = await loadPublicConfig();
      for (let i = 0; i < delays.length; i++) {
        if (delays[i] > 0) await sleep(delays[i]);
        if (cancelled) return;
        if (i === 1) setState("waking");
        try {
          const res = await fetch(`${cfg.apiUrl}/health`, { cache: "no-store" });
          if (res.ok) {
            if (!cancelled) setState("ok");
            return;
          }
        } catch {
          // Space or Neon still waking.
        }
      }
      if (!cancelled) setState("down");
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (state === "ok") return null;

  return (
    <div
      role="status"
      className="border-b border-hairline bg-surface-2 px-4 py-2 text-center font-mono text-xs text-muted"
    >
      {state === "waking"
        ? "API is waking from sleep (Hugging Face Space cold start, usually 10–30s)…"
        : "API is unreachable. If this is the hosted demo, wait and reload — the Space may still be starting."}
    </div>
  );
}
