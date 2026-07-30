"use client";

import type { CSSProperties, ReactNode } from "react";
import { useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";

import { AGENT_VISUALS, AgentGlyph, hueForSlug } from "@/components/agent-visual";
import { HUE_CLASSES, type Hue } from "@/components/landing/icons";
import { Term } from "@/components/term";
import { TASK_STATUS_GLOW } from "@/components/ui/glow";
import { WAVE_EXPLAINER } from "@/lib/glossary";

import { agentDisplayName } from "./format";
import { NODE_H, NODE_W } from "./layout";
import type { BuilderFlowNode, Task, TaskFlowNode } from "./types";

// Mirrors COLUMNS in missions/page.tsx — the board and this graph must never
// disagree about what color a status is. If COLUMNS changes, update this too.
//
// "superseded" gets "muted" rather than a real Hue: every one of the 6
// palette hues is already claimed by another status (see landing/icons.tsx's
// Hue union), and this task isn't a failure — reusing e.g. red or cyan would
// visually lie about that. NodeShell below special-cases "muted" to a
// neutral ring/dot/text treatment instead of indexing the Hue-keyed maps.
const STATUS_HUE: Record<Task["status"], Hue | "muted"> = {
  todo: "blue",
  in_progress: "violet",
  review: "amber",
  done: "green",
  failed: "red",
  skipped: "cyan",
  superseded: "muted",
};

const STATUS_LABEL: Record<Task["status"], string> = {
  todo: "To do",
  in_progress: "In progress",
  review: "Needs approval",
  done: "Done",
  failed: "Failed",
  skipped: "Skipped",
  superseded: "Replanned",
};

const HUE_DOT: Record<Hue, string> = {
  blue: "bg-hue-blue",
  violet: "bg-hue-violet",
  cyan: "bg-hue-cyan",
  amber: "bg-hue-amber",
  green: "bg-hue-green",
  red: "bg-hue-red",
};

// Tailwind's JIT scanner needs complete literal class names in source, so
// this hue->ring map (like HUE_DOT above) can't be built with a template
// string at render time.
const HUE_RING: Record<Hue, string> = {
  blue: "ring-hue-blue/40",
  violet: "ring-hue-violet/40",
  cyan: "ring-hue-cyan/40",
  amber: "ring-hue-amber/40",
  green: "ring-hue-green/40",
  red: "ring-hue-red/40",
};

// .react-flow__handle ships its own rules in style.css, loaded after
// globals.css at equal specificity — a Tailwind class here would lose that
// source-order tiebreak. Inline style always wins regardless of order.
const handleStyle: CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: 9999,
  background: "var(--accent)",
  border: "1px solid var(--background)",
};

// Builder-only handle. Deliberately NOT a change to `handleStyle` above: that
// one is shared with TaskNode, and the run DAG has no drag-to-connect, so
// growing its dots would be decoration with no affordance behind it.
//
// Why the size and the label live in React state instead of `hover:` classes:
// the width/height that beat React Flow's own stylesheet have to be INLINE
// (see the comment on handleStyle), and an inline style cannot be overridden
// by a Tailwind hover: class — the class loses to any inline value regardless
// of specificity. Tracking hover in state and recomputing the inline size is
// the only version that actually grows.
//
// The label is the whole point of this component. Before it, the two dots were
// visually identical and unexplained — the user's complaint ("which one to...
// which connect, is little bit more brain consuming") is exactly this. The
// left dot means "this step runs AFTER whatever connects into it"; the right
// dot means "this step runs BEFORE whatever it connects out to".
function BuilderHandle({ type }: { type: "source" | "target" }) {
  const [hovered, setHovered] = useState(false);
  const isSource = type === "source";
  const size = hovered ? 14 : 10;
  return (
    <Handle
      type={type}
      position={isSource ? Position.Right : Position.Left}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        ...handleStyle,
        width: size,
        height: size,
        transition: "width 120ms ease, height 120ms ease",
      }}
      // aria-label rather than visible text at rest: the dot is a
      // mouse-only affordance (React Flow has no keyboard connect gesture),
      // and the Inspector's "Connect to →" select remains the accessible
      // path — so this only has to name itself for anyone inspecting it.
      aria-label={isSource ? "Drag out: this step runs before" : "Drop here: this step runs after"}
    >
      {hovered && (
        <span
          className="pointer-events-none absolute top-1/2 -translate-y-1/2 whitespace-nowrap rounded border border-hairline bg-background px-1.5 py-0.5 font-mono text-[10px] text-muted"
          style={isSource ? { left: size + 6 } : { right: size + 6 }}
        >
          {isSource ? "runs before →" : "← runs after"}
        </span>
      )}
    </Handle>
  );
}

// Shared shell every workflow node type renders inside — keeps graph nodes
// visually identical to the board's TaskCard (rounded-md, hairline border,
// bg-background) instead of React Flow's default boxes, plus a hue ring
// carrying the status color the board conveys via column position instead.
export function NodeShell({
  hue,
  glyph,
  title,
  agentName,
  meta,
  ordinal,
  invalid = false,
  invalidReason,
  selected = false,
  glow = "",
  children,
}: {
  // "muted" (superseded tasks only) bypasses the Hue-keyed maps below
  // rather than adding a 7th member to the shared Hue union in
  // landing/icons.tsx — that union is also used by unrelated dash/landing
  // components, so widening it there would ripple into every exhaustive
  // Record<Hue, ...> across the app for one status this graph renders.
  hue: Hue | "muted";
  glyph: ReactNode;
  title: string;
  agentName: string;
  meta: ReactNode;
  // Run-DAG-only, like `glow` below. The board's TaskCard grew a "Step N"
  // pill (missions/page.tsx) because the app TALKS in ordinals — "→ step 7"
  // on a superseded node, the depends_on numbers behind "Waiting on N
  // tasks" — while no card or node ever printed one, so following the
  // pointer meant counting cards and hoping. The graph node had the same
  // gap and now closes it the same way, with the same markup, so the two
  // views of one task can't disagree. Printed verbatim (no +1): it has to
  // be the same integer superseded_by holds. BuilderNode never passes it —
  // a draft graph has no run and therefore no ordinals, only waves.
  ordinal?: number;
  invalid?: boolean;
  // What to say in the hover tooltip when `invalid` is true. The default
  // below ("Depends on a task not shown in this run") is RUN-graph copy: it
  // describes TaskNode's only cause of invalidity, a dependency ordinal
  // missing from the run. In the BUILDER there is no run and no ordinals, so
  // that sentence was simply untrue there — the real cause is whichever
  // compiler error named the node (a loop, an unknown agent, a self-loop…).
  // BuilderNode therefore passes the humanized sentence for that error and
  // TaskNode keeps the default by omitting this prop.
  invalidReason?: string;
  // Builder-only: the run DAG (TaskNode) never passes this, so it always
  // defaults to false there and the ring falls through to HUE_RING exactly
  // as before this prop was added.
  selected?: boolean;
  // Run-DAG-only, and the mirror image of `selected`: a status glow from
  // TASK_STATUS_GLOW. BuilderNode never passes it — a draft step has no
  // status, nothing has run, so there is no state for a glow to report.
  // Rendered on a dedicated overlay child rather than on the shell itself,
  // see the comment at that element.
  glow?: string;
  children?: ReactNode;
}) {
  const isMuted = hue === "muted";
  const ringClass = invalid
    ? "ring-2 ring-red-500/60"
    : selected
      ? "ring-2 ring-accent"
      : isMuted
        ? "ring-muted/30"
        : HUE_RING[hue];
  const dotClass = isMuted ? "bg-muted" : HUE_DOT[hue];
  const metaTextClass = isMuted ? "text-muted" : HUE_CLASSES[hue].icon;
  return (
    <div
      style={{ width: NODE_W, minHeight: NODE_H }}
      className={`relative rounded-md border border-hairline bg-background p-2.5 text-sm ring-1 ${ringClass}`}
      title={invalid ? (invalidReason ?? "Depends on a task not shown in this run") : undefined}
    >
      {/* The glow rides its own absolutely-positioned overlay instead of the
          shell above, for one hard reason: every ring-* utility on the shell
          (ring-1, ring-2 ring-red-500/60, ring-accent) is box-shadow based
          and LAYERED, while .af-glow-* is unlayered and therefore wins any
          box-shadow tie — putting the glow on the shell would silently erase
          the status ring, including the invalid-node red ring that three
          Playwright assertions depend on. A sibling element shares no
          box-shadow with the shell, so both render. inset-0 + the same
          rounded-md keeps the halo aligned to the card's real corners, and
          it never changes layout or the size React Flow measures. */}
      {glow && (
        <span aria-hidden className={`pointer-events-none absolute inset-0 rounded-md ${glow}`} />
      )}

      <p className="truncate leading-snug">{title}</p>

      {/* Agent chip + step number on one wrapping row — byte-identical
          treatment to the board's TaskCard (missions/page.tsx), so a task
          looks the same whichever view you are in. flex-wrap rather than a
          fixed row because NODE_W is only 210px: a long agent name pushes
          the pill to a second line instead of overflowing the card, and
          NODE_H is a MIN height, so React Flow measures the taller box. */}
      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        <span className="flex w-fit items-center gap-1 rounded-full border border-hairline bg-white/[0.03] px-1.5 py-0.5 font-mono text-[10px] text-muted">
          {glyph}
          {agentName}
        </span>
        {ordinal != null && (
          <span className="rounded-full border border-hairline px-1.5 py-0.5 font-mono text-[10px] text-muted">
            Step {ordinal}
          </span>
        )}
      </div>

      <span className="mt-1.5 flex items-center gap-1.5 font-mono text-[10px] text-muted">
        <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClass}`} />
        <span className={metaTextClass}>{meta}</span>
      </span>

      {children}
    </div>
  );
}

export function TaskNode({ data }: NodeProps<TaskFlowNode>) {
  const { task, agentName, invalid } = data;
  const hue = STATUS_HUE[task.status];
  const hasMeta = task.tokens_in > 0 || task.tokens_out > 0;
  // Self-heal marker — subtle text folded into the existing meta line
  // (not a new NodeShell element, per the "don't restructure NodeShell"
  // constraint) so a healed/gave-up node still reads at a glance.
  const healNote =
    task.attempts > 1
      ? task.status === "failed"
        ? ` · ↻ gave up ×${task.attempts}`
        : task.status === "superseded"
          ? ` · ↻ re-planned ×${task.attempts}`
          : ` · ↻ healed ×${task.attempts}`
      : "";
  // No result, no tokens for a superseded node most of the time (it never
  // finished its own work) — but it still points forward at whatever
  // replaced it, which is the one thing worth saying here.
  const supersededNote =
    task.status === "superseded" && task.superseded_by != null
      ? ` · → step ${task.superseded_by}`
      : "";

  return (
    <NodeShell
      hue={hue}
      invalid={invalid}
      // Same map the board's TaskCard reads, so a task cannot glow green in
      // one view and nothing in the other.
      glow={TASK_STATUS_GLOW[task.status]}
      title={task.title}
      agentName={agentName}
      ordinal={task.ordinal}
      glyph={<AgentGlyph slug={task.agent_slug} name={agentName} size="xs" />}
      meta={
        hasMeta ? (
          // Byte-identical format to missions/page.tsx's meta line, down to
          // the <Term> around "tok": the board explains what a token is on
          // click/focus, and this line said the same three characters with
          // no explanation at all. NodeShell's root has no overflow-hidden
          // (the only clip in this component is `truncate` on the title, a
          // SIBLING of the meta line), so the tooltip is free to escape the
          // card — it is bounded only by React Flow's own pane, exactly
          // like the board's is bounded by the viewport.
          <>
            {STATUS_LABEL[task.status]}
            {healNote}
            {supersededNote} · ↑{task.tokens_in} ↓{task.tokens_out}{" "}
            <Term k="tokens">tok</Term>
            {task.latency_ms != null && ` · ${task.latency_ms}ms`}
          </>
        ) : (
          <>
            {STATUS_LABEL[task.status]}
            {healNote}
            {supersededNote}
          </>
        )
      }
    >
      <Handle type="target" position={Position.Left} style={handleStyle} />
      <Handle type="source" position={Position.Right} style={handleStyle} />
    </NodeShell>
  );
}

// Builder node — same NodeShell chrome as the run DAG's TaskNode above, but
// backed by a draft BuilderNodeData instead of a run Task (no status, no
// tokens: nothing has executed yet). Hue comes from the agent itself
// (AGENT_VISUALS / hueForSlug, the same source AgentGlyph uses) rather than
// a run status, since a builder node has no status to color by.
export function BuilderNode({ data, selected }: NodeProps<BuilderFlowNode>) {
  const hue = AGENT_VISUALS[data.agentSlug]?.hue ?? hueForSlug(data.agentSlug);
  const agentName = agentDisplayName(data.agentSlug);

  // The wave number is the answer to "which step runs when?" — the thing the
  // builder previously only hinted at, in a single "{n} waves" summary that
  // appeared after a successful validate and nowhere else. `wave` is a
  // zero-based rank from layout.ts's builderWaveRanks(), so it renders +1.
  // `waveUnknown` means the graph has a loop: there is no valid ordering at
  // all, so printing any number would be a lie — it greys out instead.
  const waveLabel = data.waveUnknown ? "Wave —" : `Wave ${(data.wave ?? 0) + 1}`;

  return (
    <NodeShell
      hue={hue}
      selected={selected}
      invalid={data.invalid}
      invalidReason={data.invalidReason}
      title={data.title || "Untitled step"}
      agentName={agentName}
      glyph={<AgentGlyph slug={data.agentSlug} name={agentName} size="xs" />}
      meta={
        <>
          <span
            className={data.waveUnknown ? "text-muted" : undefined}
            title={
              data.waveUnknown
                ? "These steps depend on each other in a loop, so there is no order to run them in yet."
                : WAVE_EXPLAINER
            }
          >
            {waveLabel}
          </span>
          {" · "}
          {data.needsApproval ? "Needs approval" : "Runs automatically"}
        </>
      }
    >
      <BuilderHandle type="target" />
      <BuilderHandle type="source" />
    </NodeShell>
  );
}
