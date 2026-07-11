import type { ReactNode } from "react";

import { Reveal } from "./reveal";

type Feature = {
  label: string;
  title: string;
  description: string;
  wide?: boolean;
  visual: ReactNode;
};

const FEATURES: Feature[] = [
  {
    label: "CHAT",
    title: "Multi-agent chat",
    description:
      "Streaming responses with live tool calls across your whole fleet.",
    wide: true,
    visual: (
      <div className="flex flex-wrap gap-2 font-mono text-xs text-muted">
        <span className="rounded border border-hairline px-2 py-1">
          web_search()
        </span>
        <span className="rounded border border-hairline px-2 py-1">
          search_documents()
        </span>
        <span className="rounded border border-hairline px-2 py-1 text-accent">
          ✓ streaming
        </span>
      </div>
    ),
  },
  {
    label: "ORCHESTRATION",
    title: "Goal orchestration",
    description:
      "Turn a goal into a Kanban DAG with human-in-the-loop checkpoints.",
    visual: (
      <div className="flex gap-2 font-mono text-xs text-muted">
        <span>Backlog</span>
        <span>→</span>
        <span>Doing</span>
        <span>→</span>
        <span className="text-accent">Done</span>
      </div>
    ),
  },
  {
    label: "RAG",
    title: "Document intelligence",
    description:
      "Local pgvector search grounds every agent in your own docs.",
    visual: (
      <div className="font-mono text-xs text-muted">
        pgvector · cosine · top_k=8
      </div>
    ),
  },
  {
    label: "BUILDER",
    title: "Runtime agent builder",
    description:
      "Compose new agents at runtime and wire in external MCP tools.",
    visual: (
      <div className="font-mono text-xs text-muted">+ mcp_tool.connect()</div>
    ),
  },
  {
    label: "PUBLISH",
    title: "Publish",
    description:
      "Ship an agent behind an API key — or expose your fleet as an MCP server.",
    visual: (
      <div className="font-mono text-xs text-muted">
        POST /v1/agents/:id/run
      </div>
    ),
  },
  {
    label: "OBSERVABILITY",
    title: "Live observability",
    description: "Every step traced in Langfuse — latency, cost, and tool calls, live.",
    wide: true,
    visual: (
      <div className="flex items-end gap-1">
        {[40, 70, 30, 90, 55, 65, 45].map((h, i) => (
          <span
            key={i}
            className="w-2 rounded-sm bg-accent/50"
            style={{ height: `${h * 0.3}px` }}
          />
        ))}
      </div>
    ),
  },
];

export function FeatureGrid() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {FEATURES.map((feature, i) => (
        <Reveal
          key={feature.title}
          delay={i * 80}
          className={feature.wide ? "lg:col-span-2" : ""}
        >
          <div className="group flex h-full flex-col justify-between gap-6 rounded-lg border border-hairline p-6 transition-all duration-300 hover:-translate-y-0.5 hover:border-accent/40">
            <div className="flex flex-col gap-2">
              <span className="font-mono text-xs text-muted">
                {feature.label}
              </span>
              <h3 className="font-medium tracking-tight text-foreground">
                {feature.title}
              </h3>
              <p className="text-sm text-muted">{feature.description}</p>
            </div>
            {feature.visual}
          </div>
        </Reveal>
      ))}
    </div>
  );
}
