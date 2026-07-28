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
