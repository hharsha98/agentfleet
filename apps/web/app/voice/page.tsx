"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { apiFetch } from "@/lib/api";

type VoiceConfig =
  | { enabled: false }
  | { enabled: true; public_key: string; assistant: Record<string, unknown> };

type CallState = "idle" | "connecting" | "in-call" | "ended";

// Minimal shape of the @vapi-ai/web SDK instance we rely on — the package
// ships its own types, but the import is dynamic (see startCall below) so
// there's no static type at module scope to reuse here.
type VapiInstance = {
  start: (assistant: Record<string, unknown>) => void;
  stop: () => void;
  on: (event: string, handler: (...args: unknown[]) => void) => void;
  off: (event: string, handler: (...args: unknown[]) => void) => void;
};

export default function VoicePage() {
  const [config, setConfig] = useState<VoiceConfig | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [callState, setCallState] = useState<CallState>("idle");
  const [error, setError] = useState<string | null>(null);
  const vapiRef = useRef<VapiInstance | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch("/api/v1/voice/config")
      .then((res) => res.json())
      .then((body: VoiceConfig) => {
        if (!cancelled) setConfig(body);
      })
      .catch(() => {
        if (!cancelled) setNote("API offline — start the backend and reload.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Tear down any live call + SDK listeners on unmount so a navigation away
  // mid-call doesn't leave a dangling mic stream or stale event handlers.
  useEffect(() => {
    return () => {
      vapiRef.current?.stop();
    };
  }, []);

  async function startCall() {
    if (!config?.enabled) return;
    setError(null);
    setCallState("connecting");
    try {
      const { default: Vapi } = await import("@vapi-ai/web");
      const vapi = new Vapi(config.public_key) as unknown as VapiInstance;
      vapiRef.current = vapi;

      vapi.on("call-start", () => setCallState("in-call"));
      vapi.on("call-end", () => {
        setCallState("ended");
        vapiRef.current = null;
      });
      vapi.on("error", (e: unknown) => {
        const message = e instanceof Error ? e.message : String(e);
        setError(message);
        setCallState("idle");
        vapiRef.current = null;
      });

      vapi.start(config.assistant);
    } catch (err) {
      setError(String(err));
      setCallState("idle");
    }
  }

  function endCall() {
    vapiRef.current?.stop();
  }

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-hairline px-6 py-3">
        <Link href="/" className="font-medium tracking-tight">
          AgentFleet
        </Link>
        <nav className="flex flex-wrap items-center gap-4 text-sm text-muted">
          <Link href="/chat" className="hover:text-foreground">
            Chat
          </Link>
          <Link href="/documents" className="hover:text-foreground">
            Documents
          </Link>
          <Link href="/missions" className="hover:text-foreground">
            Missions
          </Link>
          <Link href="/agents" className="hover:text-foreground">
            Agents
          </Link>
          <Link href="/templates" className="hover:text-foreground">
            Templates
          </Link>
          <Link href="/evals" className="hover:text-foreground">
            Evals
          </Link>
          <Link href="/playground" className="hover:text-foreground">
            Playground
          </Link>
          <Link href="/usage" className="hover:text-foreground">
            Usage
          </Link>
          <Link href="/automations" className="hover:text-foreground">
            Automations
          </Link>
          <span className="text-foreground">Voice</span>
        </nav>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8">
        <h1 className="text-2xl font-medium tracking-tight">Voice Agent</h1>
        <p className="mt-1 text-sm text-muted">
          Talk to AgentFleet out loud — the browser handles the mic, Vapi handles the call.
        </p>
        {note && <p className="mt-3 font-mono text-xs text-muted">{note}</p>}

        {config === null && !note && (
          <p className="mt-10 text-center text-sm text-muted">Loading…</p>
        )}

        {config && !config.enabled && <DisabledState />}

        {config && config.enabled && (
          <CallPanel
            callState={callState}
            error={error}
            onStart={startCall}
            onEnd={endCall}
          />
        )}
      </main>
    </div>
  );
}

function DisabledState() {
  return (
    <div className="mt-6">
      <EmptyState
        glyph="🎙"
        title="Voice is not configured"
        description={`Add VAPI_PUBLIC_KEY to .env and restart the API to enable a live voice call with an AgentFleet assistant.`}
      />
      <div className="mx-auto mt-8 max-w-sm rounded-lg border border-hairline p-4">
        <p className="font-mono text-xs text-muted">how it works</p>
        <ul className="mt-3 space-y-2 text-sm text-muted">
          <li className="flex gap-2">
            <span aria-hidden="true">1.</span>
            <span>Your browser captures mic audio — nothing leaves the tab until a call starts.</span>
          </li>
          <li className="flex gap-2">
            <span aria-hidden="true">2.</span>
            <span>Vapi handles speech-to-text, text-to-speech, and telephony behind one web SDK.</span>
          </li>
          <li className="flex gap-2">
            <span aria-hidden="true">3.</span>
            <span>The assistant runs on the AgentFleet voice prompt, same platform knowledge as chat.</span>
          </li>
        </ul>
      </div>
    </div>
  );
}

function CallPanel({
  callState,
  error,
  onStart,
  onEnd,
}: {
  callState: CallState;
  error: string | null;
  onStart: () => void;
  onEnd: () => void;
}) {
  const statusLabel: Record<CallState, string> = {
    idle: "Ready",
    connecting: "Connecting…",
    "in-call": "In call",
    ended: "Call ended",
  };

  return (
    <div className="mt-10 flex flex-col items-center gap-6">
      <div className="flex flex-col items-center gap-2">
        <span
          className={`h-2 w-2 rounded-full ${
            callState === "in-call"
              ? "bg-accent"
              : callState === "connecting"
                ? "animate-pulse bg-accent/60"
                : "bg-hairline"
          }`}
          aria-hidden="true"
        />
        <p className="font-mono text-xs text-muted">{statusLabel[callState]}</p>
      </div>

      {callState === "idle" || callState === "ended" ? (
        <button
          onClick={onStart}
          className="flex h-32 w-32 items-center justify-center rounded-full bg-accent text-4xl text-white shadow-lg transition-opacity hover:opacity-90"
          aria-label="Start call"
        >
          🎙
        </button>
      ) : (
        <button
          onClick={onEnd}
          disabled={callState === "connecting"}
          className="flex h-32 w-32 items-center justify-center rounded-full border border-hairline text-4xl transition-colors hover:border-accent disabled:opacity-50"
          aria-label="End call"
        >
          ⏹
        </button>
      )}

      <p className="text-sm text-muted">
        {callState === "idle" && "Tap to start a call with the AgentFleet assistant."}
        {callState === "connecting" && "Requesting mic access and connecting…"}
        {callState === "in-call" && "Speak naturally — tap the button to hang up."}
        {callState === "ended" && "Call ended. Tap to start a new one."}
      </p>

      {error && (
        <p className="max-w-xs text-center text-sm text-red-400">⚠ {error}</p>
      )}
    </div>
  );
}
