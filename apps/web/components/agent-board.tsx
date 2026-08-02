"use client";

// "All agents" board — a colorful grid of every agent, reused both inline
// (chat's empty state, before any message has been sent) and as a modal
// overlay (opened from the agent strip's trailing "All agents" chip once a
// conversation is underway). One card renderer (AgentCard) backs both so
// the look never drifts between the two surfaces.

import { useEffect, useMemo, useRef, useState } from "react";

import { AGENT_VISUALS, AgentGlyph, hueForSlug } from "@/components/agent-visual";
import type { AgentInfo } from "@/components/chat-ui";
import { HUE_CLASSES } from "@/components/landing/icons";

function AgentCard({
  agent,
  selected,
  onSelect,
}: {
  agent: AgentInfo;
  selected: boolean;
  onSelect: (a: AgentInfo) => void;
}) {
  const hue = AGENT_VISUALS[agent.slug]?.hue ?? hueForSlug(agent.slug);
  const c = HUE_CLASSES[hue];

  return (
    <button
      type="button"
      onClick={() => onSelect(agent)}
      aria-pressed={selected}
      className={`rounded-lg border p-3 text-left transition-colors duration-200 hover:border-accent ${c.tile} ${
        selected ? "border-accent ring-2 ring-accent/40" : ""
      }`}
    >
      {/* min-w-0 + truncate: 17 builtin agents include names like "Meeting
          Notes → CRM" and "Competitor Monitor" that used to wrap to a
          second line, making every row of the grid a different height (see
          the chat-page UX pass that flagged this — "wall of uneven cards").
          A single clipped line keeps every card the same height; the card's
          title="" already carries the description as a tooltip, and CSS
          truncation never touches the accessible name a screen reader gets. */}
      <div className="flex min-w-0 items-center gap-2">
        <AgentGlyph slug={agent.slug} name={agent.name} size="md" />
        <span className="truncate text-sm font-medium">{agent.name}</span>
      </div>
      <p className="mt-2 line-clamp-2 text-xs text-muted">{agent.description}</p>
      <span className="mt-2 inline-block rounded-full border border-hairline px-2 py-0.5 font-mono text-[10px] text-muted">
        {agent.model}
      </span>
    </button>
  );
}

// Dense, single-line-per-row picker — the chat right rail's home for agent
// switching (see chat-ui.tsx's ConversationInfoRail). Same data and the same
// onSelect contract as AgentBoard above, but a dense list scales to 17+
// agents in a narrow 256px column where a card grid never would, and the
// search box means "scannable" doesn't depend on remembering where an agent
// sits. Each agent keeps its own hue (AgentGlyph's colour, plus a matching
// dot before the name) — the one thing the redesign was told not to lose.
export function AgentPickerList({
  agents,
  selectedId,
  onSelect,
}: {
  agents: AgentInfo[];
  selectedId?: string;
  onSelect: (a: AgentInfo) => void;
}) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return agents;
    return agents.filter(
      (a) => a.name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q),
    );
  }, [agents, query]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={`Filter ${agents.length} agents…`}
        // Distinct from AgentBoardOverlay's own "Filter agents" below: this
        // rail list stays mounted while that modal is open (it has no focus
        // trap), so the two inputs can legitimately coexist in the a11y
        // tree at once — same label would make them indistinguishable to
        // getByLabel() and to a screen reader's form-field list.
        aria-label="Filter agents to switch to"
        className="rounded-md border border-hairline bg-transparent px-2.5 py-1.5 text-xs outline-none transition-colors duration-200 placeholder:text-muted focus:border-accent"
      />
      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto pr-0.5">
        {filtered.map((a) => {
          const selected = a.id === selectedId;
          return (
            <button
              key={a.id}
              type="button"
              onClick={() => onSelect(a)}
              aria-pressed={selected}
              title={a.description}
              className={`flex min-w-0 cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 text-left text-xs transition-colors duration-200 ${
                selected
                  ? "border-accent bg-accent/10 text-foreground"
                  : "border-transparent text-muted hover:border-hairline hover:text-foreground"
              }`}
            >
              <AgentGlyph slug={a.slug} name={a.name} size="sm" />
              <span className="truncate">{a.name}</span>
            </button>
          );
        })}
        {filtered.length === 0 && (
          <p className="px-2 py-3 text-xs text-muted">No agent matches “{query}”.</p>
        )}
      </div>
    </div>
  );
}

export function AgentBoard({
  agents,
  selectedId,
  onSelect,
}: {
  agents: AgentInfo[];
  selectedId?: string;
  onSelect: (a: AgentInfo) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
      {agents.map((a) => (
        <AgentCard key={a.id} agent={a} selected={a.id === selectedId} onSelect={onSelect} />
      ))}
    </div>
  );
}

export function AgentBoardOverlay({
  agents,
  selectedId,
  onSelect,
  onClose,
}: {
  agents: AgentInfo[];
  selectedId?: string;
  onSelect: (a: AgentInfo) => void;
  onClose: () => void;
}) {
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return agents;
    return agents.filter(
      (a) => a.name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q),
    );
  }, [agents, query]);

  // Save focus on mount, restore it on unmount — this overlay is
  // conditionally mounted (not toggled via internal `open` state like
  // command-palette.tsx), so mount/unmount IS open/close here.
  useEffect(() => {
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    return () => {
      (previouslyFocused.current ?? document.body).focus();
    };
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // Autofocus the selected agent's card, falling back to the first card.
  useEffect(() => {
    const target =
      gridRef.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]') ??
      gridRef.current?.querySelector<HTMLButtonElement>("button");
    target?.focus();
  }, []);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/60 pt-[10vh]"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="All agents"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl rounded-lg border border-hairline bg-background p-4 shadow-2xl max-h-[70vh] overflow-y-auto"
      >
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-medium">All agents</h2>
          <p className="text-xs text-muted">Switching agents starts a new conversation</p>
        </div>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Filter ${agents.length} agents…`}
          aria-label="Filter agents"
          className="mb-3 w-full rounded-md border border-hairline bg-transparent px-2.5 py-1.5 text-sm outline-none transition-colors duration-200 placeholder:text-muted focus:border-accent"
        />
        <div ref={gridRef}>
          {filtered.length > 0 ? (
            <AgentBoard agents={filtered} selectedId={selectedId} onSelect={onSelect} />
          ) : (
            <p className="py-6 text-center text-sm text-muted">No agent matches “{query}”.</p>
          )}
        </div>
      </div>
    </div>
  );
}
