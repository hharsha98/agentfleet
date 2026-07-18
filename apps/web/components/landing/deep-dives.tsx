import type { ReactNode } from "react";

import { HeroTrace } from "./hero-trace";
import { Icon, IconTile, type Hue, type IconName } from "./icons";
import { Reveal } from "./reveal";

// --- Shared section shells -----------------------------------------------

type DeepDive = {
  eyebrow: string;
  title: string;
  description: string;
  bullets: string[];
  hue: Hue;
  icon: IconName;
};

function DeepDiveCopy({ dive }: { dive: DeepDive }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <IconTile icon={dive.icon} hue={dive.hue} />
        <span className="font-mono text-xs text-muted">{dive.eyebrow}</span>
      </div>
      <h3 className="text-xl font-medium tracking-tight text-foreground sm:text-2xl">
        {dive.title}
      </h3>
      <p className="max-w-md text-sm leading-relaxed text-muted">
        {dive.description}
      </p>
      <ul className="flex flex-wrap gap-2">
        {dive.bullets.map((bullet) => (
          <li
            key={bullet}
            className="rounded-full border border-hairline px-3 py-1 font-mono text-[11px] text-muted"
          >
            {bullet}
          </li>
        ))}
      </ul>
    </div>
  );
}

function BigDeepDive({
  dive,
  flip,
  vignette,
}: {
  dive: DeepDive;
  flip: boolean;
  vignette: ReactNode;
}) {
  return (
    <Reveal className="grid grid-cols-1 items-center gap-10 py-14 lg:grid-cols-2 lg:gap-16">
      <div className={flip ? "lg:order-2" : "lg:order-1"}>
        <DeepDiveCopy dive={dive} />
      </div>
      <div className={flip ? "lg:order-1" : "lg:order-2"}>{vignette}</div>
    </Reveal>
  );
}

function CompactDeepDive({
  dive,
  vignette,
  delay,
}: {
  dive: DeepDive;
  vignette: ReactNode;
  delay: number;
}) {
  return (
    <Reveal
      delay={delay}
      className="flex flex-col gap-5 rounded-xl border border-hairline p-6"
    >
      <DeepDiveCopy dive={dive} />
      {vignette}
    </Reveal>
  );
}

// --- BIG vignettes ---------------------------------------------------------

function ChatDeepVignette() {
  const bubbles = [
    { mine: true, text: "Plan a 90-day agent portfolio" },
    { mine: false, text: "Drafting 3 portfolio agents and an eval plan…" },
    { mine: false, text: "Calling search_documents() for prior notes" },
  ];
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-hairline bg-black/20 p-4">
      <span className="mx-auto mb-1 w-fit rounded-full border border-hairline bg-white/[0.03] px-2.5 py-1 font-mono text-[10px] text-muted">
        <span className="animate-pulse-node mr-1 inline-block h-1.5 w-1.5 rounded-full bg-accent align-middle" />
        search_documents()
      </span>
      {bubbles.map((b, i) => (
        <div
          key={i}
          className={`animate-rise-in max-w-[80%] rounded-md px-3 py-1.5 text-xs ${
            b.mine
              ? "ml-auto rounded-tr-sm bg-accent/15 text-foreground/80"
              : "rounded-tl-sm border border-hairline bg-white/[0.03] text-foreground/70"
          }`}
          style={{ animationDelay: `${i * 1.8}s` }}
        >
          {b.text}
        </div>
      ))}
    </div>
  );
}

function OrchestrationDeepVignette() {
  const columns = ["Backlog", "Doing", "Done"];
  return (
    <div className="relative grid grid-cols-3 gap-3 rounded-xl border border-hairline bg-black/20 p-4">
      {columns.map((col) => (
        <div key={col} className="flex flex-col gap-2">
          <span className="font-mono text-[9px] uppercase tracking-wide text-muted">
            {col}
          </span>
          <div className="flex h-16 flex-col justify-end gap-1.5 rounded-md border border-dashed border-hairline p-1.5">
            <span className="h-1.5 w-3/4 rounded-full bg-white/10" />
          </div>
        </div>
      ))}
      {/* Traveling card: migrates Backlog -> Doing -> Done, one column-width per hop. */}
      <div className="pointer-events-none absolute inset-4 grid grid-cols-3 gap-3">
        <div className="animate-slide-card flex h-10 w-full flex-col justify-center gap-1 rounded-md border border-accent/40 bg-accent/15 px-2">
          <span className="h-1.5 w-2/3 rounded-full bg-accent/60" />
        </div>
      </div>
    </div>
  );
}

// --- COMPACT vignettes ------------------------------------------------------

function BuilderVignette() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 220 70"
      className="h-16 w-full rounded-lg border border-hairline bg-black/20"
    >
      <circle cx="24" cy="35" r="8" fill="var(--hue-amber)" fillOpacity={0.25} stroke="var(--hue-amber)" strokeWidth={1.25} />
      <circle cx="110" cy="18" r="8" fill="var(--hue-amber)" fillOpacity={0.18} stroke="var(--hue-amber)" strokeWidth={1.25} />
      <circle cx="110" cy="52" r="8" fill="var(--hue-amber)" fillOpacity={0.18} stroke="var(--hue-amber)" strokeWidth={1.25} />
      <circle cx="196" cy="35" r="8" fill="var(--hue-amber)" fillOpacity={0.25} stroke="var(--hue-amber)" strokeWidth={1.25} />
      <path
        d="M32 35 Q 70 35 102 20"
        fill="none"
        stroke="var(--hue-amber)"
        strokeWidth={1.5}
        strokeLinecap="round"
        pathLength={100}
        className="animate-dash-draw"
      />
      <path
        d="M32 35 Q 70 35 102 50"
        fill="none"
        stroke="var(--hue-amber)"
        strokeWidth={1.5}
        strokeLinecap="round"
        pathLength={100}
        className="animate-dash-draw"
        style={{ animationDelay: "1.2s" }}
      />
      <path
        d="M118 20 Q 155 35 188 35"
        fill="none"
        stroke="var(--hue-amber)"
        strokeWidth={1.5}
        strokeLinecap="round"
        pathLength={100}
        className="animate-dash-draw"
        style={{ animationDelay: "2.4s" }}
      />
      <path
        d="M118 50 Q 155 35 188 35"
        fill="none"
        stroke="var(--hue-amber)"
        strokeWidth={1.5}
        strokeLinecap="round"
        pathLength={100}
        className="animate-dash-draw"
        style={{ animationDelay: "3.6s" }}
      />
    </svg>
  );
}

function DocIntelVignette() {
  const chunks = [0, 1, 2];
  return (
    <div className="flex items-center gap-3 rounded-lg border border-hairline bg-black/20 p-3">
      <Icon name="file-text" className="h-6 w-6 shrink-0 text-hue-cyan" />
      <span className="text-hue-cyan/60">→</span>
      <div className="flex gap-1.5">
        {chunks.map((i) => (
          <span
            key={i}
            className="animate-drift block h-4 w-4 rounded-sm border border-hue-cyan/40 bg-hue-cyan/15"
            style={{ animationDelay: `${i * 0.8}s` }}
          />
        ))}
      </div>
    </div>
  );
}

function PublishVignette() {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-hairline bg-black/20 p-3 font-mono text-[11px]">
      <span className="flex w-fit items-center gap-1.5 rounded border border-hairline bg-white/[0.03] px-1.5 py-0.5 text-muted">
        <Icon name="key" className="h-3 w-3 text-hue-green" />
        sk_live_••••4f2a
      </span>
      <span className="text-foreground/70">
        curl fleet.dev/api/v1/invoke
        <span
          aria-hidden
          className="ml-0.5 inline-block h-3 w-[2px] translate-y-0.5 animate-blink-caret bg-accent align-middle"
        />
      </span>
    </div>
  );
}

// --- Section data ------------------------------------------------------

const CHAT: DeepDive = {
  eyebrow: "CHAT",
  hue: "blue",
  icon: "chat",
  title: "Multi-agent chat",
  description:
    "Talk to any agent in the fleet from one streaming chat. Tool calls show up live as they run — search queries, SQL, Slack posts — so you see what the agent actually did, not just its final answer.",
  bullets: ["Streaming responses", "Live tool-call cards", "Switch agents mid-conversation"],
};

const ORCHESTRATION: DeepDive = {
  eyebrow: "ORCHESTRATION",
  hue: "violet",
  icon: "workflow",
  title: "Goal orchestration",
  description:
    "Give the fleet a goal and the orchestrator turns it into a Kanban DAG — a chain of steps agents pick up, execute, and hand off. Human-in-the-loop checkpoints pause the run wherever you want a say.",
  bullets: ["Goal → step DAG", "Human-in-the-loop checkpoints", "Live mission board"],
};

const OBSERVABILITY: DeepDive = {
  eyebrow: "OBSERVABILITY",
  hue: "red",
  icon: "activity",
  title: "Live observability",
  description:
    "Every step is traced in Langfuse — latency, token usage, and cost per tool call, live as the run happens. When a run is slow or expensive, you see exactly which step, not just an aggregate number.",
  bullets: ["Per-step latency + cost", "Langfuse trace timeline", "p95 94ms under load"],
};

const BUILDER: DeepDive = {
  eyebrow: "BUILDER",
  hue: "amber",
  icon: "plug",
  title: "Runtime agent builder",
  description:
    "Compose a new agent at runtime — pick a system prompt, a model, and wire in external MCP tools — without touching code or redeploying.",
  bullets: ["No redeploy", "MCP tool wiring", "Model per agent"],
};

const DOC_INTEL: DeepDive = {
  eyebrow: "RAG",
  hue: "cyan",
  icon: "file-text",
  title: "Document intelligence",
  description:
    "Upload your own docs and every agent can search them through local pgvector retrieval — chunked and embedded on your machine, grounding answers in your content instead of the model's guesses.",
  bullets: ["Local pgvector search", "fastembed, on-device", "Grounded citations"],
};

const PUBLISH: DeepDive = {
  eyebrow: "PUBLISH",
  hue: "green",
  icon: "rocket",
  title: "Publish anywhere",
  description:
    "Ship an agent behind a versioned API key, embed it as a widget, or expose your whole fleet as an MCP server. Every publish is a version — roll back a bad one in one click.",
  bullets: ["Versioned publishing", "One-click rollback", "MCP server export"],
};

export function DeepDives() {
  return (
    <section className="mx-auto max-w-6xl px-6">
      <div className="flex flex-col divide-y divide-hairline">
        <BigDeepDive dive={CHAT} flip={false} vignette={<ChatDeepVignette />} />
        <BigDeepDive
          dive={ORCHESTRATION}
          flip={true}
          vignette={<OrchestrationDeepVignette />}
        />
        <BigDeepDive
          dive={OBSERVABILITY}
          flip={false}
          vignette={<HeroTrace />}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 py-14 sm:grid-cols-3">
        <CompactDeepDive dive={BUILDER} vignette={<BuilderVignette />} delay={0} />
        <CompactDeepDive dive={DOC_INTEL} vignette={<DocIntelVignette />} delay={80} />
        <CompactDeepDive dive={PUBLISH} vignette={<PublishVignette />} delay={160} />
      </div>
    </section>
  );
}
