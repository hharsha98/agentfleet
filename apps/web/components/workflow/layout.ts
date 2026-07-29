// Pure layout math for the workflow graph — no React, no external deps, so
// it's trivially testable and never pulls React Flow into a server bundle.
//
// Task.depends_on holds ordinals that only ever point BACKWARD (an earlier
// task's ordinal never depends on a later one), so the tasks array is
// already topologically sorted by ordinal. That means rank(i) — how many
// dependency "hops" deep a task sits — can be computed in a single forward
// pass: by the time we reach task i, every ordinal it depends on has
// already been assigned a rank.
import type { Task } from "./types";

export const NODE_W = 210;
export const NODE_H = 92;
export const H_GAP = 64;
export const V_GAP = 24;

export type LayoutPosition = { id: string; ordinal: number; x: number; y: number };

export function layoutTasks(tasks: Task[]): LayoutPosition[] {
  const rank: Record<number, number> = {};

  for (const t of tasks) {
    if (!t.depends_on || t.depends_on.length === 0) {
      rank[t.ordinal] = 0;
      continue;
    }
    let maxDepRank = 0;
    for (const dep of t.depends_on) {
      // Defensive: a dependency ordinal missing from `rank` (filtered out of
      // this run's tasks, or otherwise absent) degrades to 0 instead of
      // producing NaN — every downstream x/y is derived from this value, so
      // a NaN here would blank the whole canvas rather than just misplacing
      // one node.
      const depRank = rank[dep] ?? 0;
      if (depRank > maxDepRank) maxDepRank = depRank;
    }
    rank[t.ordinal] = 1 + maxDepRank;
  }

  const byRank = new Map<number, Task[]>();
  for (const t of tasks) {
    const r = rank[t.ordinal] ?? 0;
    const group = byRank.get(r);
    if (group) {
      group.push(t);
    } else {
      byRank.set(r, [t]);
    }
  }

  const positions: LayoutPosition[] = [];
  for (const [r, group] of byRank) {
    const count = group.length;
    group.forEach((t, i) => {
      positions.push({
        id: t.id,
        ordinal: t.ordinal,
        x: r * (NODE_W + H_GAP),
        y: i * (NODE_H + V_GAP) - ((count - 1) * (NODE_H + V_GAP)) / 2,
      });
    });
  }
  return positions;
}

// --- builder waves ----------------------------------------------------------
//
// The builder needs the same rank(i) number layoutTasks() computes above —
// that rank IS the wave: "one batch of steps that can run at the same time,
// because nothing in the batch depends on anything else in it", matching
// estimated_waves() in apps/api/app/services/workflow_compiler.py (longest
// dependency path + 1, i.e. one execute_run while-loop iteration per wave).
//
// It cannot reuse layoutTasks(), for one specific reason: layoutTasks relies
// on Task.depends_on holding ORDINALS that only point backward, which makes
// the array already topologically sorted and lets a single forward pass work.
// A hand-drawn builder graph has no ordinals at all — its nodes sit in
// whatever order they were clicked into existence, and an edge may point from
// a later node to an earlier one. So the relaxation rule here is identical
// (rank = 1 + max(rank of predecessors)); only the ORDER it is applied in has
// to be discovered, via Kahn's algorithm, instead of assumed.
export type WaveRanks = {
  /** node id -> zero-based wave index. Empty/partial when hasCycle is true. */
  rankById: Record<string, number>;
  /** True when some node never reached indegree 0 — a loop (or a self-loop)
   *  means no ordering exists, so every wave number is meaningless, not just
   *  the ones inside the loop. Callers must grey the whole set out. */
  hasCycle: boolean;
  /** Highest rank + 1, or 0 when the graph is empty or has a loop. */
  waveCount: number;
};

export function builderWaveRanks(
  nodeIds: string[],
  edges: { source: string; target: string }[],
): WaveRanks {
  const rankById: Record<string, number> = {};
  const present = new Set(nodeIds);
  const successors = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  for (const id of nodeIds) indegree.set(id, 0);

  const seenPairs = new Set<string>();
  for (const e of edges) {
    // Dangling endpoints are dropped rather than counted — same defensive
    // spirit as the `rank[dep] ?? 0` fallback in layoutTasks above. The
    // server still hard-errors `dangling_edge` on save/validate; degrading
    // here just avoids blanking every wave number over one stale edge.
    if (!present.has(e.source) || !present.has(e.target)) continue;
    // A self-loop is deliberately NOT skipped: it leaves its own node stuck
    // above indegree 0, so hasCycle comes out true and the wave numbers grey
    // out — which is honest, because the server rejects `self_loop` too.
    const key = `${e.source} ${e.target}`;
    if (seenPairs.has(key)) continue; // matches compile_workflow's edge dedupe
    seenPairs.add(key);
    const list = successors.get(e.source);
    if (list) list.push(e.target);
    else successors.set(e.source, [e.target]);
    indegree.set(e.target, (indegree.get(e.target) ?? 0) + 1);
  }

  // Kahn's algorithm over a plain array used as a FIFO queue (no shift() — an
  // index cursor keeps this O(V + E) instead of O(V²)).
  const queue = nodeIds.filter((id) => indegree.get(id) === 0);
  for (const id of queue) rankById[id] = 0;

  let processed = 0;
  for (let head = 0; head < queue.length; head++) {
    const id = queue[head];
    processed++;
    const rank = rankById[id] ?? 0;
    for (const succ of successors.get(id) ?? []) {
      // max, not assignment: a fan-in node's wave is set by its SLOWEST
      // predecessor — it cannot start until every input has landed.
      if (rank + 1 > (rankById[succ] ?? 0)) rankById[succ] = rank + 1;
      const remaining = (indegree.get(succ) ?? 0) - 1;
      indegree.set(succ, remaining);
      if (remaining === 0) queue.push(succ);
    }
  }

  const hasCycle = processed < nodeIds.length;
  let waveCount = 0;
  if (!hasCycle) {
    for (const id of nodeIds) {
      const rank = rankById[id] ?? 0;
      if (rank + 1 > waveCount) waveCount = rank + 1;
    }
  }
  return { rankById, hasCycle, waveCount };
}
