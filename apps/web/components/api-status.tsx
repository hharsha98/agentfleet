"use client";

import { useEffect, useState } from "react";

import { loadPublicConfig } from "@/lib/public-config";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function ApiStatus() {
  const [state, setState] = useState<"ok" | "waking" | "down" | "no-llm">("ok");

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
            // /health reports whether an LLM endpoint is configured at all
            // (no network call). Without one, every agent run fails, so say
            // it once up top instead of letting each run fail mysteriously.
            const body = await res.json().catch(() => ({}));
            if (!cancelled) setState(body?.llm_configured === false ? "no-llm" : "ok");
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

  if (state === "no-llm") {
    return (
      <div
        role="alert"
        className="border-b border-hue-amber/30 bg-hue-amber/10 px-4 py-2 text-center text-xs text-foreground"
      >
        This server&apos;s AI provider isn&apos;t configured, so agents can&apos;t answer yet.{" "}
        <span className="text-muted">
          Owner: set <code className="font-mono">FREE_LLM_BASE_URL</code> and{" "}
          <code className="font-mono">FREE_LLM_KEY</code> for the API, then restart it.
        </span>
      </div>
    );
  }

  return (
    <div
      role="status"
      className="border-b border-hairline bg-surface-2 px-4 py-2 text-center font-mono text-xs text-muted"
    >
      {state === "waking"
        ? "Connecting to the API… a cold start can take 10–30s."
        : "The API is unreachable right now. Wait a moment and reload the page."}
    </div>
  );
}
