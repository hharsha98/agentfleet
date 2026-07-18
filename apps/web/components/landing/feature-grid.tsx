import type { ReactNode } from "react";

import { IconTile, type Hue, type IconName } from "./icons";
import { Reveal } from "./reveal";

// --- Product vignettes: small, hand-built faux-UI, no screenshots -------

function ChatVignette() {
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-hairline bg-black/20 p-3">
      <div className="flex items-center gap-1.5 font-mono text-[10px] text-muted">
        <span className="rounded border border-hairline bg-white/[0.03] px-1.5 py-0.5">
          web_search()
        </span>
        <span className="rounded border border-hairline bg-white/[0.03] px-1.5 py-0.5">
          search_documents()
        </span>
      </div>
      <div className="ml-auto max-w-[75%] rounded-md rounded-tr-sm bg-accent/15 px-2.5 py-1.5 text-xs text-foreground/80">
        Plan a 90-day agent portfolio
      </div>
      <div className="max-w-[80%] rounded-md rounded-tl-sm border border-hairline bg-white/[0.03] px-2.5 py-1.5 text-xs text-foreground/70">
        Drafting 3 portfolio agents
        <span
          aria-hidden
          className="ml-0.5 inline-block h-3 w-[2px] translate-y-0.5 animate-blink-caret bg-accent align-middle"
        />
      </div>
    </div>
  );
}

function MissionBoardVignette() {
  const columns: { label: string; tone: string; cards: number }[] = [
    { label: "Backlog", tone: "bg-muted/40", cards: 1 },
    { label: "Doing", tone: "bg-hue-amber/70", cards: 1 },
    { label: "Done", tone: "bg-hue-green/70", cards: 1 },
  ];

  return (
    <div className="relative grid grid-cols-3 gap-2 rounded-lg border border-hairline bg-black/20 p-3">
      {columns.map((col) => (
        <div key={col.label} className="flex flex-col gap-1.5">
          <span className="font-mono text-[9px] uppercase tracking-wide text-muted">
            {col.label}
          </span>
          <div className="flex h-9 flex-col justify-end gap-1 rounded-md border border-dashed border-hairline bg-white/[0.02] p-1.5">
            <span className="h-1.5 w-3/4 rounded-full bg-white/10" />
          </div>
        </div>
      ))}
      {/* One card slowly migrates Backlog -> Doing -> Done, looping. */}
      <div className="pointer-events-none absolute inset-3 grid grid-cols-3 gap-2">
        <div className="animate-slide-card flex h-9 w-full flex-col gap-1 rounded-md border border-hairline bg-white/[0.03] p-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-hue-amber/70" />
          <span className="h-1.5 w-3/4 rounded-full bg-white/10" />
          <span className="h-1.5 w-1/2 rounded-full bg-white/10" />
        </div>
      </div>
    </div>
  );
}

function SparklineVignette() {
  // Smooth-ish path baked as static points — purely decorative, honest
  // labels sit alongside it rather than implying a live data feed.
  const points = "0,28 14,22 28,24 42,12 56,16 70,6 84,10 98,2 112,8";
  return (
    <div className="flex items-center gap-4 rounded-lg border border-hairline bg-black/20 p-3">
      <svg viewBox="0 0 112 30" className="h-10 w-28 shrink-0" aria-hidden>
        <defs>
          <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polyline
          points={`${points} 112,30 0,30`}
          fill="url(#spark-fill)"
          stroke="none"
        />
        <polyline
          points={points}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          pathLength={100}
          className="animate-dash-draw-once"
        />
      </svg>
      <div className="flex flex-col gap-0.5 font-mono text-xs">
        <span className="text-foreground/80">p95 94ms</span>
        <span className="text-muted">under load</span>
      </div>
    </div>
  );
}

type Feature = {
  icon: IconName;
  hue: Hue;
  label: string;
  title: string;
  description: string;
  span: string;
  vignette?: ReactNode;
};

const FEATURES: Feature[] = [
  {
    icon: "chat",
    hue: "blue",
    label: "CHAT",
    title: "Multi-agent chat",
    description:
      "Streaming responses with live tool calls across your whole fleet.",
    span: "lg:col-span-2",
    vignette: <ChatVignette />,
  },
  {
    icon: "workflow",
    hue: "violet",
    label: "ORCHESTRATION",
    title: "Goal orchestration",
    description:
      "Turn a goal into a Kanban DAG with human-in-the-loop checkpoints.",
    span: "lg:col-span-1",
    vignette: <MissionBoardVignette />,
  },
  {
    icon: "database",
    hue: "cyan",
    label: "RAG",
    title: "Document intelligence",
    description:
      "Local pgvector search grounds every agent in your own docs.",
    span: "lg:col-span-1",
  },
  {
    icon: "blocks",
    hue: "amber",
    label: "BUILDER",
    title: "Runtime agent builder",
    description:
      "Compose new agents at runtime and wire in external MCP tools.",
    span: "lg:col-span-1",
  },
  {
    icon: "rocket",
    hue: "green",
    label: "PUBLISH",
    title: "Publish",
    description:
      "Ship an agent behind an API key — or expose your fleet as an MCP server.",
    span: "lg:col-span-1",
  },
  {
    icon: "activity",
    hue: "red",
    label: "OBSERVABILITY",
    title: "Live observability",
    description:
      "Every step traced in Langfuse — latency, cost, and tool calls, live.",
    span: "lg:col-span-3",
    vignette: <SparklineVignette />,
  },
];

export function FeatureGrid() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {FEATURES.map((feature, i) => (
        <Reveal key={feature.title} delay={i * 80} className={feature.span}>
          <div className="group flex h-full flex-col justify-between gap-5 rounded-xl border border-hairline p-6 transition-all duration-300 hover:-translate-y-0.5 hover:border-accent/40 hover:bg-white/[0.02]">
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-3">
                <IconTile icon={feature.icon} hue={feature.hue} />
                <span className="font-mono text-xs text-muted">
                  {feature.label}
                </span>
              </div>
              <div className="flex flex-col gap-1.5">
                <h3 className="font-medium tracking-tight text-foreground">
                  {feature.title}
                </h3>
                <p className="text-sm text-muted">{feature.description}</p>
              </div>
            </div>
            {feature.vignette}
          </div>
        </Reveal>
      ))}
    </div>
  );
}
