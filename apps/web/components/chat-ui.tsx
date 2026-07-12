"use client";

import { useEffect, useRef, useState } from "react";

import { ArtifactPanel } from "@/components/artifact-panel";
import { EmptyState } from "@/components/empty-state";
import { parseMessageParts, type Artifact } from "@/lib/artifacts";

const ARTIFACT_ICON: Record<Artifact["type"], string> = {
  code: "{ }",
  markdown: "M↓",
  chart: "📊",
};

export type AgentInfo = {
  id: string;
  slug: string;
  name: string;
  description: string;
  model: string;
};

type Usage = {
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  latency_ms: number;
};

type ToolActivity = {
  name: string;
  args: Record<string, unknown>;
  preview?: string;
  done: boolean;
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  usage?: Usage;
  tools?: ToolActivity[];
};

export function ChatUI({ agents, apiUrl }: { agents: AgentInfo[]; apiUrl: string }) {
  const [agent, setAgent] = useState<AgentInfo | null>(agents[0] ?? null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [activeArtifact, setActiveArtifact] = useState<Artifact | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    // Follow the stream only while the reader is already near the bottom —
    // never yank someone who scrolled up to re-read (review finding).
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [messages]);

  function selectAgent(next: AgentInfo) {
    if (streaming || next.id === agent?.id) return;
    setAgent(next);
    setConversationId(null);
    setMessages([]);
  }

  function patchLast(patch: (m: ChatMessage) => ChatMessage) {
    setMessages((all) => {
      const copy = [...all];
      copy[copy.length - 1] = patch(copy[copy.length - 1]);
      return copy;
    });
  }

  async function send() {
    const text = input.trim();
    if (!text || streaming || !agent) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", content: text }, { role: "assistant", content: "" }]);
    setStreaming(true);
    try {
      let convId = conversationId;
      if (!convId) {
        const res = await fetch(`${apiUrl}/api/v1/conversations`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agent_id: agent.id }),
        });
        if (!res.ok) throw new Error(`create conversation failed (${res.status})`);
        convId = (await res.json()).id as string;
        setConversationId(convId);
      }

      const controller = new AbortController();
      abortRef.current = controller;
      const res = await fetch(`${apiUrl}/api/v1/conversations/${convId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: text }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) throw new Error(`send failed (${res.status})`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";
        for (const event of events) {
          const line = event.trim();
          if (!line.startsWith("data: ")) continue;
          let data;
          try {
            data = JSON.parse(line.slice(6));
          } catch {
            continue; // one malformed frame must not kill the stream
          }
          if (data.type === "token") {
            patchLast((m) => ({ ...m, content: m.content + data.content }));
          } else if (data.type === "tool_call") {
            patchLast((m) => ({
              ...m,
              tools: [...(m.tools ?? []), { name: data.name, args: data.arguments, done: false }],
            }));
          } else if (data.type === "tool_result") {
            patchLast((m) => {
              const tools = [...(m.tools ?? [])];
              const idx = tools.findIndex((t) => t.name === data.name && !t.done);
              if (idx >= 0) tools[idx] = { ...tools[idx], done: true, preview: data.preview };
              return { ...m, tools };
            });
          } else if (data.type === "done") {
            patchLast((m) => ({ ...m, usage: data.usage }));
          } else if (data.type === "error") {
            patchLast((m) => ({ ...m, content: `${m.content}\n⚠ ${data.message}` }));
          }
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        patchLast((m) => ({ ...m, content: `${m.content}\n⏹ stopped` }));
      } else {
        patchLast((m) => ({ ...m, content: `${m.content}\n⚠ ${String(err)}` }));
      }
    } finally {
      abortRef.current = null;
      setStreaming(false);
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

  if (agents.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="max-w-sm text-center text-sm text-muted">
          No agents available — is the API running? Start it, seed the agents,
          then reload this page.
        </p>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-1 overflow-hidden">
      <div
        className={`flex min-w-0 flex-1 flex-col px-4 ${
          activeArtifact ? "" : "mx-auto max-w-3xl"
        }`}
      >
      <div className="flex gap-2 overflow-x-auto py-3">
        {agents.map((a) => (
          <button
            key={a.id}
            onClick={() => selectAgent(a)}
            title={a.description}
            className={`whitespace-nowrap rounded-full border px-3 py-1 text-sm transition-colors ${
              a.id === agent?.id
                ? "border-accent bg-accent/15 text-foreground"
                : "border-hairline text-muted hover:text-foreground"
            }`}
          >
            {a.name}
          </button>
        ))}
      </div>

      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto py-4">
        {messages.length === 0 && (
          <EmptyState
            glyph="💬"
            title={agent ? "Ask anything" : "Pick an agent to start"}
            description={
              agent
                ? `Chat with ${agent.name} — tool calls, artifacts, and usage show up right here.`
                : "Choose an agent above, then send your first message."
            }
          />
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div
              className={`max-w-[85%] whitespace-pre-wrap rounded-lg border px-3 py-2 text-sm leading-relaxed ${
                m.role === "user" ? "border-accent/40 bg-accent/10" : "border-hairline"
              }`}
            >
              {m.tools?.map((t, j) => (
                <details
                  key={j}
                  className="mb-2 rounded-md border border-hairline px-2 py-1"
                >
                  <summary className="cursor-pointer font-mono text-xs text-muted">
                    {t.done ? "✓" : "⏳"} {t.name}
                    {typeof t.args.query === "string" ? `: ${t.args.query}` : ""}
                  </summary>
                  <pre className="mt-1 overflow-x-auto whitespace-pre-wrap font-mono text-[10px] text-muted">
                    {t.preview ?? "running…"}
                  </pre>
                </details>
              ))}
              {m.role === "assistant"
                ? parseMessageParts(m.content).map((part, k) =>
                    part.kind === "text" ? (
                      <span key={k}>{part.value}</span>
                    ) : (
                      <button
                        key={k}
                        type="button"
                        onClick={() => setActiveArtifact(part.artifact)}
                        className="mx-1 inline-flex items-center gap-1 rounded-full border border-hairline px-2 py-0.5 align-middle font-mono text-[11px] text-muted transition-colors hover:border-accent hover:text-foreground"
                      >
                        <span>{ARTIFACT_ICON[part.artifact.type]}</span>
                        <span>{part.artifact.lang}</span>
                        <span className="text-accent">open</span>
                      </button>
                    )
                  )
                : m.content}
              {m.role === "assistant" && streaming && i === messages.length - 1 && (
                <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-accent align-middle" />
              )}
              {m.usage && (
                <div className="mt-2 border-t border-hairline pt-1 font-mono text-[10px] text-muted">
                  ↑{m.usage.tokens_in} ↓{m.usage.tokens_out} tok · {m.usage.latency_ms}ms · $
                  {m.usage.cost_usd.toFixed(4)}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        className="sticky bottom-0 flex gap-2 border-t border-hairline bg-background py-3"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={agent ? `Message ${agent.name}…` : "Pick an agent first"}
          className="flex-1 rounded-md border border-hairline bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted focus:border-accent"
        />
        {streaming ? (
          <button
            type="button"
            onClick={stop}
            className="rounded-md border border-hairline px-4 py-2 text-sm text-muted transition-colors hover:text-foreground"
          >
            Stop
          </button>
        ) : (
          <button
            type="submit"
            disabled={!input.trim()}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-opacity disabled:opacity-40"
          >
            Send
          </button>
        )}
      </form>
      </div>
      {activeArtifact && (
        <ArtifactPanel artifact={activeArtifact} onClose={() => setActiveArtifact(null)} />
      )}
    </div>
  );
}
