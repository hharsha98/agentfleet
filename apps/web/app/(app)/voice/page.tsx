"use client";

import { useEffect, useRef, useState } from "react";

import { StatCard } from "@/components/dash/stat-card";
import { EmptyState } from "@/components/empty-state";
import { HowItWorks, type ExplainerStep } from "@/components/explainer";
import { Icon } from "@/components/landing/icons";
import { PageHeader } from "@/components/page-header";
import { apiFetch } from "@/lib/api";

function MicIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <rect x="9" y="3.5" width="6" height="11" rx="3" />
      <path d="M6 11.5a6 6 0 0 0 12 0M12 17.5V21M9 21h6" />
    </svg>
  );
}

type VoiceConfig =
  | { enabled: false }
  | { enabled: true; public_key: string; assistant: Record<string, unknown> };

type CallState = "idle" | "connecting" | "in-call" | "ended";

// Shared by the Chunk D3 stat row and CallPanel's status line so the two
// never drift out of sync — same human labels, one source.
const STATUS_LABEL: Record<CallState, string> = {
  idle: "Ready",
  connecting: "Connecting…",
  "in-call": "In call",
  ended: "Call ended",
};

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
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 sm:px-6">
      <PageHeader
        icon={<Icon name="activity" />}
        hue="green"
        title="Voice Agent"
        description="Talk to your agents out loud. The browser handles your mic; Vapi handles speech — add a key to go live."
      />
      {note && <p className="mt-3 font-mono text-xs text-muted">{note}</p>}

      {/* Stat/status row — both values come straight from state this page
          already holds (config from GET /voice/config, callState from the
          Vapi SDK event handlers below), no fabricated numbers. */}
      <div className="mt-6 grid grid-cols-2 gap-3">
        <StatCard
          label="Voice provider"
          value={config?.enabled ? "Configured" : "Not configured"}
          sub={config?.enabled ? "Vapi" : "Add VAPI_PUBLIC_KEY to enable"}
          icon={<Icon name="plug" />}
          hue={config?.enabled ? "green" : "amber"}
          pulse={!!config?.enabled}
        />
        <StatCard
          label="Call status"
          value={STATUS_LABEL[callState]}
          icon={<Icon name="activity" />}
          hue={callState === "in-call" ? "green" : "blue"}
          delay={40}
        />
      </div>

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

      <HowItWorks
        title="How voice mode works"
        className="mt-6"
        delay={80}
        steps={VOICE_STEPS}
        hue="green"
      />
    </main>
  );
}

// Was a local NumberedCard + hand-written Panel; now data for the shared
// HowItWorks (components/explainer.tsx), which renders the identical markup.
const VOICE_STEPS: ExplainerStep[] = [
  {
    hue: "green",
    title: "Mic capture",
    description:
      "Your browser captures mic audio — nothing leaves the tab until a call starts.",
  },
  {
    hue: "green",
    title: "Vapi speech pipeline",
    description:
      "Vapi handles speech-to-text, text-to-speech, and telephony behind one web SDK.",
  },
  {
    hue: "green",
    title: "Same agent knowledge",
    description:
      "The assistant runs on the AgentFleet voice prompt, same platform knowledge as chat.",
  },
];

function DisabledState() {
  return (
    <div className="mt-6">
      <EmptyState
        glyph={<MicIcon className="h-7 w-7" />}
        title="Voice is not configured"
        description={`Add VAPI_PUBLIC_KEY to .env and restart the API to enable a live voice call with an AgentFleet assistant.`}
      />
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
        <p className="font-mono text-xs text-muted">{STATUS_LABEL[callState]}</p>
      </div>

      {callState === "idle" || callState === "ended" ? (
        <button
          onClick={onStart}
          className="flex h-32 w-32 cursor-pointer items-center justify-center rounded-full bg-accent text-4xl text-white shadow-lg transition-opacity duration-200 hover:opacity-90"
          aria-label="Start call"
        >
          🎙
        </button>
      ) : (
        <button
          onClick={onEnd}
          disabled={callState === "connecting"}
          className="flex h-32 w-32 cursor-pointer items-center justify-center rounded-full border border-hairline text-4xl transition-colors duration-200 hover:border-accent disabled:cursor-not-allowed disabled:opacity-50"
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
