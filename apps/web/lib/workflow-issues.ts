// Human copy for the 9 workflow validation codes.
//
// The builder used to print the compiler's findings as `[cycle] Cycle
// detected among node(s): 'Draft' (n8kq…)` — an internal code plus a machine
// message, with no statement of what to actually DO about it. This module is
// the one place each code becomes a plain sentence plus a concrete fix.
//
// Codes are the complete set documented on WorkflowIssue
// (apps/api/app/schemas.py) and raised by
// apps/api/app/services/workflow_compiler.py:
//   errors:   duplicate_id, empty, self_loop, dangling_edge, unknown_agent, cycle
//   warnings: orphan_node, wide_fan_in, empty_instruction
//
// TEST CONTRACT — read before rewording anything here:
// workflow-builder.tsx renders `sentence` alongside the raw code in a small
// mono chip, and e2e/workflows.spec.ts asserts on both `/empty_instruction/`
// and `/cycle/i` via getByText. Playwright's text engine keeps only the
// INNERMOST element whose text matches (an ancestor whose child also matches
// is dropped), so a code string appearing in BOTH the chip and the sentence
// would produce two matches and trip strict mode. Therefore: no `sentence` or
// `fix` may contain its own code as a substring. In particular the `cycle`
// copy says "loop", never "cycle".
export type WorkflowIssueCopy = {
  /** What went wrong, in one sentence a first-time user can act on. */
  sentence: string;
  /** The concrete next click. Named after real controls in the builder. */
  fix: string;
};

const ISSUE_COPY: Record<string, WorkflowIssueCopy> = {
  // --- errors (compile fails, nothing runs) ---------------------------------
  duplicate_id: {
    sentence: "Two steps share the same internal id, so the app cannot tell them apart.",
    fix: "Delete one of them and add a fresh step from the Agents palette.",
  },
  empty: {
    sentence: "This workflow has no steps yet, so there is nothing to run.",
    fix: "Click an agent in the Agents palette to add your first step, or load an example.",
  },
  self_loop: {
    sentence: "A step is connected to itself, so it would be waiting for its own output.",
    fix: "Select that step and remove the connection listed under Outgoing edges.",
  },
  dangling_edge: {
    sentence: "A connection points at a step that no longer exists.",
    fix: "Select the step at the other end and remove the stale connection under Outgoing edges.",
  },
  unknown_agent: {
    sentence: "A step is assigned to an agent that no longer exists.",
    fix: "Select the step and pick a current agent from the Agent dropdown.",
  },
  cycle: {
    sentence: "These steps depend on each other in a loop, so none of them can go first.",
    fix: "Remove one connection in the loop — select a step and use Outgoing edges.",
  },

  // --- warnings (legal, but probably not what you meant) --------------------
  orphan_node: {
    sentence: "A step has no connections at all, so it runs on its own in the very first wave.",
    fix: "If it should wait for something, drag from that step's right dot to this step's left dot.",
  },
  wide_fan_in: {
    sentence:
      "A step waits on four or more others, and only the first 3000 characters of each one's result reaches it.",
    fix: "Add a middle step that condenses some of them first, or drop the connections that matter least.",
  },
  empty_instruction: {
    sentence: "A step has no instruction, so its agent only receives the step's title.",
    fix: "Select the step and write what it should actually do in the Instruction box.",
  },
};

// Fallback rather than a throw: the API owns this vocabulary and could add a
// code before the web app knows about it. An unknown code still shows the raw
// code chip and the compiler's own message on hover — which is all the
// builder showed for every code before this module existed, never a blank row.
const UNKNOWN: WorkflowIssueCopy = {
  sentence: "The workflow compiler reported a problem with this graph.",
  fix: "Hover this row to read the compiler's own wording.",
};

export function issueCopy(code: string): WorkflowIssueCopy {
  return ISSUE_COPY[code] ?? UNKNOWN;
}
