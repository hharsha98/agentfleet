import type { ReactNode } from "react";

import { Reveal } from "./reveal";

type Hue = "blue" | "violet" | "cyan" | "amber" | "green" | "red";

const HUE_CLASSES: Record<Hue, { tile: string; icon: string; glow: string }> = {
  blue: {
    tile: "bg-hue-blue/10 border-hue-blue/25",
    icon: "text-hue-blue",
    glow: "bg-hue-blue/20",
  },
  violet: {
    tile: "bg-hue-violet/10 border-hue-violet/25",
    icon: "text-hue-violet",
    glow: "bg-hue-violet/20",
  },
  cyan: {
    tile: "bg-hue-cyan/10 border-hue-cyan/25",
    icon: "text-hue-cyan",
    glow: "bg-hue-cyan/20",
  },
  amber: {
    tile: "bg-hue-amber/10 border-hue-amber/25",
    icon: "text-hue-amber",
    glow: "bg-hue-amber/20",
  },
  green: {
    tile: "bg-hue-green/10 border-hue-green/25",
    icon: "text-hue-green",
    glow: "bg-hue-green/20",
  },
  red: {
    tile: "bg-hue-red/10 border-hue-red/25",
    icon: "text-hue-red",
    glow: "bg-hue-red/20",
  },
};

type IconName =
  | "chat"
  | "workflow"
  | "database"
  | "blocks"
  | "rocket"
  | "activity";

// Hand-inlined, Lucide-style (24x24, stroke-based, rounded caps) icons — no
// icon package dependency per the design constraints.
function Icon({ name, className }: { name: IconName; className?: string }) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className,
    "aria-hidden": true,
  };

  switch (name) {
    case "chat":
      return (
        <svg {...common}>
          <path d="M4 5.5h16a1 1 0 0 1 1 1V16a1 1 0 0 1-1 1H9l-4.5 4V17H4a1 1 0 0 1-1-1V6.5a1 1 0 0 1 1-1Z" />
          <path d="M7.5 9.5h9M7.5 12.5h5.5" />
        </svg>
      );
    case "workflow":
      return (
        <svg {...common}>
          <circle cx="5.5" cy="6" r="2.25" />
          <circle cx="5.5" cy="18" r="2.25" />
          <circle cx="18.5" cy="12" r="2.25" />
          <path d="M7.6 6.9 16.5 11M7.6 17.1 16.5 13" />
        </svg>
      );
    case "database":
      return (
        <svg {...common}>
          <ellipse cx="12" cy="6" rx="7" ry="2.75" />
          <path d="M5 6v6c0 1.52 3.13 2.75 7 2.75s7-1.23 7-2.75V6" />
          <path d="M5 12v6c0 1.52 3.13 2.75 7 2.75s7-1.23 7-2.75v-6" />
        </svg>
      );
    case "blocks":
      return (
        <svg {...common}>
          <rect x="3.5" y="3.5" width="7" height="7" rx="1.25" />
          <rect x="13.5" y="3.5" width="7" height="7" rx="1.25" />
          <rect x="8.5" y="13.5" width="7" height="7" rx="1.25" />
        </svg>
      );
    case "rocket":
      return (
        <svg {...common}>
          <path d="M12 3c2.8 1.6 4.5 4.6 4.5 8.5 0 2-1 4-2.3 5.3L12 19l-2.2-2.2C8.5 15.5 7.5 13.5 7.5 11.5 7.5 7.6 9.2 4.6 12 3Z" />
          <circle cx="12" cy="10.5" r="1.6" />
          <path d="M9.3 16.5 7 19M14.7 16.5 17 19" />
        </svg>
      );
    case "activity":
      return (
        <svg {...common}>
          <path d="M3 12h4l2-6 4 12 2-8 2 2h4" />
        </svg>
      );
    default:
      return null;
  }
}

function IconTile({ icon, hue }: { icon: IconName; hue: Hue }) {
  const c = HUE_CLASSES[hue];
  return (
    <div
      className={`relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border ${c.tile}`}
    >
      <div
        aria-hidden
        className={`pointer-events-none absolute -inset-2 rounded-full ${c.glow} blur-lg`}
      />
      <Icon name={icon} className={`relative h-5 w-5 ${c.icon}`} />
    </div>
  );
}

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
    <div className="grid grid-cols-3 gap-2 rounded-lg border border-hairline bg-black/20 p-3">
      {columns.map((col) => (
        <div key={col.label} className="flex flex-col gap-1.5">
          <span className="font-mono text-[9px] uppercase tracking-wide text-muted">
            {col.label}
          </span>
          <div className="flex flex-col gap-1 rounded-md border border-hairline bg-white/[0.03] p-1.5">
            <span className={`h-1.5 w-1.5 rounded-full ${col.tone}`} />
            <span className="h-1.5 w-3/4 rounded-full bg-white/10" />
            <span className="h-1.5 w-1/2 rounded-full bg-white/10" />
          </div>
        </div>
      ))}
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
