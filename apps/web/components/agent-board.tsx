"use client";

// "All agents" board — a colorful grid of every agent, reused both inline
// (chat's empty state, before any message has been sent) and as a modal
// overlay (opened from the agent strip's trailing "All agents" chip once a
// conversation is underway). One card renderer (AgentCard) backs both so
// the look never drifts between the two surfaces.

import { useEffect, useRef } from "react";

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
      <div className="flex items-center gap-2">
        <AgentGlyph slug={agent.slug} name={agent.name} size="md" />
        <span className="text-sm font-medium">{agent.name}</span>
      </div>
      <p className="mt-2 line-clamp-2 text-xs text-muted">{agent.description}</p>
      <span className="mt-2 inline-block rounded-full border border-hairline px-2 py-0.5 font-mono text-[10px] text-muted">
        {agent.model}
      </span>
    </button>
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
        <div ref={gridRef}>
          <AgentBoard agents={agents} selectedId={selectedId} onSelect={onSelect} />
        </div>
      </div>
    </div>
  );
}
