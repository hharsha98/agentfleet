"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import { AgentBoard, AgentBoardOverlay } from "@/components/agent-board";
import { AgentGlyph } from "@/components/agent-visual";
import { ArtifactPanel } from "@/components/artifact-panel";
import { HowItWorks, type ExplainerStep } from "@/components/explainer";
import { MicButton } from "@/components/mic-button";
import { Term } from "@/components/term";
import { apiFetch } from "@/lib/api";
import { parseMessageParts, type Artifact } from "@/lib/artifacts";

// The empty-state explainer, in the same three-card shape /agents, /evals,
// /guardrails and /voice already use. Descriptions are plain strings because
// that is what ExplainerStep takes — the words that needed a glossary
// definition live in the paragraph rendered underneath instead.
//
// Step 1's "they don't share history" is literal: selectAgent() below clears
// conversationId and messages, so switching agent opens a new conversation
// server-side too.
const CHAT_STEPS: ExplainerStep[] = [
  {
    hue: "blue",
    title: "Pick an agent",
    description:
      "Each card below is its own prompt, model, and set of tools. Switching agent starts a fresh conversation — they don't share history.",
  },
  {
    hue: "blue",
    title: "Ask in plain English",
    description:
      "It answers from the model, and reaches for a tool when the question needs one — searching the documents you uploaded, running a web search, reading a page.",
  },
  {
    hue: "blue",
    title: "Watch what it did",
    description:
      "Every tool it ran shows up as a card while it works, and anything long enough to be awkward inline arrives as a chip you can open.",
  },
];

// Concrete first messages. The third is deliberately a code request: it is
// the shortest reliable way to see an artifact chip appear, which is the one
// affordance on this screen nothing else explains by example.
const CHAT_STARTERS: { text: string; shows: string }[] = [
  { text: "What can you do, and which tools do you have?", shows: "the agent's own answer" },
  {
    text: "Search my uploaded documents and tell me what's in them.",
    shows: "a tool call card",
  },
  {
    text: "Write a short Python function that removes duplicates from a list.",
    shows: "an artifact chip",
  },
];

function ChartGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5"
      aria-hidden="true"
    >
      <path d="M3 12h4l2-6 4 12 2-8 2 2h4" />
    </svg>
  );
}

// "{ }" and "M↓" are already crisp mono glyphs — only chart swaps its old
// 📊 emoji for an SVG, matching artifact-panel.tsx's TYPE_LABEL.
const ARTIFACT_ICON: Record<Artifact["type"], ReactNode> = {
  code: "{ }",
  markdown: "M↓",
  chart: <ChartGlyph />,
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

export function ChatUI({ agents }: { agents: AgentInfo[] }) {
  const [agent, setAgent] = useState<AgentInfo | null>(agents[0] ?? null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [activeArtifact, setActiveArtifact] = useState<Artifact | null>(null);
  const [boardOpen, setBoardOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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
        const res = await apiFetch("/api/v1/conversations", {
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
      const res = await apiFetch(`/api/v1/conversations/${convId}/messages`, {
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
      {messages.length > 0 && (
        <div className="flex gap-2 overflow-x-auto py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {agents.map((a) => (
            <button
              key={a.id}
              onClick={() => selectAgent(a)}
              title={a.description}
              className={`flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-sm transition-colors duration-200 ${
                a.id === agent?.id
                  ? "border-accent bg-accent/15 text-foreground"
                  : "border-hairline text-muted hover:text-foreground"
              }`}
            >
              <AgentGlyph slug={a.slug} name={a.name} size="sm" />
              {a.name}
            </button>
          ))}
          <button
            type="button"
            disabled={streaming}
            onClick={() => setBoardOpen(true)}
            className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border border-hairline px-3 py-1 text-sm text-muted transition-colors duration-200 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
          >
            All agents
          </button>
        </div>
      )}

      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto py-4">
        {messages.length === 0 && (
          <div>
            {/* Everything in this block disappears the moment the first
                message lands — it is the empty state, not chrome. Before it
                existed the window opened on a bare agent grid and the words
                "Ask anything", which tells a newcomer neither what these
                agents can reach nor what the cards and chips in a reply are
                going to mean. */}
            <HowItWorks title="How a conversation here works" steps={CHAT_STEPS} />
            <p className="mt-3 text-xs leading-relaxed text-muted">
              A <Term k="tool_call">tool call</Term>{" "}
              is the agent doing something instead of describing it — expand the card to read
              exactly what came back. An <Term k="artifact">artifact</Term>{" "}
              is output big enough to deserve its own panel: code, a chart, a document. It arrives
              as a chip you click, so it opens beside the conversation instead of scrolling past
              you. The line under each reply is what that one turn cost in{" "}
              <Term k="tokens">tokens</Term>, time, and money.
            </p>

            <div className="mt-5 rounded-lg border border-hairline p-4">
              <p className="text-sm font-medium text-foreground">Not sure what to ask?</p>
              <p className="mt-0.5 text-xs text-muted">
                These drop into the message box rather than sending — edit one before you press
                Send.
              </p>
              <div className="mt-3 flex flex-col gap-1.5">
                {CHAT_STARTERS.map((starter) => (
                  <button
                    key={starter.text}
                    type="button"
                    onClick={() => {
                      setInput(starter.text);
                      inputRef.current?.focus();
                    }}
                    className="cursor-pointer rounded-lg border border-hairline px-3 py-2 text-left text-sm text-muted transition-colors duration-200 hover:border-accent/40 hover:bg-accent/15 hover:text-foreground"
                  >
                    {starter.text}
                    <span className="ml-2 font-mono text-[10px] text-muted">{starter.shows}</span>
                  </button>
                ))}
              </div>
            </div>

            <p className="mt-5 mb-4 text-sm text-muted">
              {agent
                ? `Ask ${agent.name} anything, or switch agent below`
                : "Pick an agent to start"}
            </p>
            <AgentBoard
              agents={agents}
              selectedId={agent?.id}
              onSelect={(a) => {
                selectAgent(a);
                inputRef.current?.focus();
              }}
            />
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div
              className={`max-w-[85%] whitespace-pre-wrap rounded-lg border px-3 py-2 text-sm leading-relaxed transition-colors duration-200 ${
                m.role === "user"
                  ? "border-accent/40 bg-accent/10"
                  : "border-hairline bg-white/[0.02]"
              }`}
            >
              {m.tools?.map((t, j) => (
                <details
                  key={j}
                  className="mb-2 rounded-md border border-hairline bg-black/10 px-2 py-1.5"
                >
                  <summary className="flex cursor-pointer items-center gap-1.5 font-mono text-xs text-muted">
                    <span
                      className={
                        t.done
                          ? "text-hue-green"
                          : "inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-accent"
                      }
                    >
                      {t.done ? "✓" : ""}
                    </span>
                    <span>{t.name}</span>
                    {typeof t.args.query === "string" ? `: ${t.args.query}` : ""}
                  </summary>
                  <pre className="mt-1.5 overflow-x-auto whitespace-pre-wrap rounded border border-hairline bg-black/20 p-1.5 font-mono text-[10px] leading-relaxed text-muted">
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
                        className="mx-1 inline-flex cursor-pointer items-center gap-1 rounded-full border border-hairline px-2 py-0.5 align-middle font-mono text-[11px] text-muted transition-colors duration-200 hover:border-accent hover:text-foreground"
                      >
                        <span className="flex items-center">{ARTIFACT_ICON[part.artifact.type]}</span>
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
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={agent ? `Message ${agent.name}…` : "Pick an agent first"}
          className="flex-1 rounded-md border border-hairline bg-transparent px-3 py-2 text-sm outline-none transition-colors duration-200 placeholder:text-muted focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/30"
        />
        <MicButton onTranscript={(t) => setInput((v) => (v ? v + " " + t : t))} />
        {streaming ? (
          <button
            type="button"
            onClick={stop}
            className="cursor-pointer rounded-md border border-hairline px-4 py-2 text-sm text-muted transition-colors duration-200 hover:text-foreground"
          >
            Stop
          </button>
        ) : (
          <button
            type="submit"
            disabled={!input.trim()}
            className="cursor-pointer rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-opacity duration-200 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Send
          </button>
        )}
      </form>
      </div>
      {boardOpen && (
        <AgentBoardOverlay
          agents={agents}
          selectedId={agent?.id}
          onSelect={(a) => {
            selectAgent(a);
            setBoardOpen(false);
            inputRef.current?.focus();
          }}
          onClose={() => setBoardOpen(false)}
        />
      )}
      {activeArtifact && (
        <ArtifactPanel artifact={activeArtifact} onClose={() => setActiveArtifact(null)} />
      )}
      {/* Chunk D3 right rail — lg+ only, and only when the artifact panel
          isn't already occupying that space. Pure read of state ChatUI
          already tracks (agent, messages); no new fetches, no touch to the
          streaming/SSE loop above. */}
      {!activeArtifact && <ConversationInfoRail agent={agent} messageCount={messages.length} />}
    </div>
  );
}

function ConversationInfoRail({
  agent,
  messageCount,
}: {
  agent: AgentInfo | null;
  messageCount: number;
}) {
  return (
    <aside className="hidden w-64 shrink-0 flex-col gap-4 border-l border-hairline px-4 py-4 lg:flex">
      <p className="font-mono text-xs uppercase tracking-wide text-muted">Conversation</p>
      <dl className="space-y-3 text-sm">
        <div className="flex items-center justify-between gap-2">
          <dt className="text-muted">Active agent</dt>
          <dd className="truncate font-medium">{agent?.name ?? "—"}</dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="text-muted">Model</dt>
          <dd className="truncate font-mono text-xs text-muted">{agent?.model ?? "—"}</dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="text-muted">Messages</dt>
          <dd className="font-mono">{messageCount}</dd>
        </div>
      </dl>
    </aside>
  );
}
