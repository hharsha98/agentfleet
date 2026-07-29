// The words this UI puts in front of people. Every one of these appears on
// screen somewhere — on the mission board, the workflow canvas, the eval
// form, an agent card — and until now none of them was defined anywhere the
// user could reach. Render one with <Term k="wave">wave</Term>.
//
// House style for the definitions below: write like a colleague explaining it
// at your desk, not like reference docs. Say what the thing IS in the first
// clause, then the one consequence worth knowing. No "refers to", no
// restating the word inside its own definition, no marketing.
//
// Where a term names real backend behaviour, the definition is ground truth
// from that code — not a plausible-sounding guess. Sources are cited inline
// so the next person can re-check them when the behaviour changes.

// Kept as its own export because it predates this file: workflow-builder.tsx
// defined it, and the canvas legend, each node's wave tooltip in nodes.tsx,
// and the Validate success line all show this exact sentence. Moving it here
// and importing it back keeps that one wording instead of growing a second.
// Semantics: estimated_waves() in apps/api/app/services/workflow_compiler.py
// — one execute_run while-loop iteration, i.e. every step whose dependencies
// are already satisfied.
export const WAVE_EXPLAINER =
  "A wave is one batch of steps that can run at the same time, because nothing in the batch depends on anything else in it.";

export const GLOSSARY = {
  // --- Workflow builder vocabulary ---------------------------------------
  wave: WAVE_EXPLAINER,

  node: "One box on the workflow canvas: an agent, plus what you're asking that agent to do. A node is a step you've drawn but not yet run.",

  edge: "A line between two boxes on the canvas. It means one thing — the step at the arrow's head waits for the step at its tail to finish.",

  step: "One unit of work in a workflow you built: an agent and an instruction. Steps are what you draw; when the workflow runs, each one becomes a task.",

  task: "A step that is actually running, or has run, inside a mission. Same work as the step, now with a live status, a result, and a token count attached.",

  ordinal: "A task's position number inside a mission, counting from 0. Dependencies only ever point at smaller ordinals, so a task can never be replaced in place — when the orchestrator repairs a stuck task it appends the replacement with a higher number.",

  dag: "Directed acyclic graph — jargon for \"steps with dependencies and no loops\". Acyclic is the half that matters: if A waits for B and B waits for A, nothing can ever start, so the builder refuses to run it.",

  // --- Orchestration --------------------------------------------------
  orchestrator: "The backend piece that turns your goal into tasks, works out which ones are ready, hands each to the best-suited agent, and keeps the rest moving when one fails. It's what drives the mission board.",

  mission: "One execution of a goal — its tasks, its board, its results, its cost. Anything you launched and that has a status is a mission.",

  run: "The API's older name for a mission; same thing. The screens say \"mission\", but run_id and the /runs endpoints keep the original word so existing links and traces don't break.",

  // Semantics from execute_run in apps/api/app/services/orchestrator.py:
  // "done" only if every task succeeded directly or via a successful
  // replacement (_effectively_done); otherwise this.
  done_with_issues: "The mission finished and there's nothing left to run, but not everything worked: at least one task failed or got skipped. It's the honest middle ground between done and failed.",

  awaiting_approval: "The mission has stopped at a checkpoint and is waiting on you. Nothing else runs until you approve that task — which is the point of putting one there.",

  // Layer 3 of orchestrator.py's self-healing: append-and-supersede.
  superseded: "A task got stuck, so the orchestrator wrote a repair plan and appended replacement steps rather than retrying the same losing approach. The old task points at whatever replaced it, so its dependents wait for the replacement instead of being skipped. Shown as \"Replanned\" — it is not a failure.",

  // Propagated to a fixed point through the DAG in execute_run.
  skipped: "This task never ran and never will, because something it depended on failed or was skipped first. Skipping travels down the chain; branches that don't depend on the failure keep going.",

  artifact: "A file a task produced — a report, a CSV, a chart — kept with the mission so you can download it afterwards instead of fishing it out of a transcript.",

  // --- Agents, tools, models ------------------------------------------
  tool_call: "The moment an agent stopped writing text and actually did something: ran a search, executed SQL, posted to Slack. Chat shows these as they happen, so you see what the agent did and not only what it says it did.",

  mcp_server: "Model Context Protocol server — an outside process that hands an agent a set of tools. Wire one in and the agent gains those tools with no code change and no redeploy. AgentFleet can be one too, exposing your whole fleet to other MCP clients.",

  temperature: "How much randomness the model may use when choosing each next word. Near 0 it's literal and repeatable; higher is more varied and less predictable. Turn it down for extraction and classification, up for drafting.",

  tokens: "The chunks of text models are billed in, roughly word-pieces. ↑ is what went to the model — your prompt plus retrieved context and history — and ↓ is what it generated back. ↑ is usually much the bigger half, and the cheaper one.",

  // --- Testing and safety ---------------------------------------------
  golden_case: "A test case saved together with the answer you already know is good. Golden cases are how you find out that a prompt tweak quietly broke behaviour that used to work.",

  judge_rubric: "Grading instructions, in plain English, handed to a second model that scores the agent's answer against them. Use it when \"correct\" is a judgement call; leave it blank and the case is only checked for a literal match.",

  red_team: "Attacking your own agent on purpose — feeding it jailbreak and prompt-injection attempts and counting how many it refuses. Worth doing before you publish, not after.",

  injection_flag: "A phrase in some text that looks like an attempt to hijack the model's instructions: \"ignore previous instructions\", a faked system role, and so on. It names the pattern that matched — a reason to look, not a verdict on the whole text.",

  // --- Shipping -------------------------------------------------------
  publish: "Freezing an agent's current prompt, model, and tools as a numbered version and putting it behind an API key. Editing the agent afterwards changes nothing for callers until you publish again.",

  version: "A numbered snapshot of a published agent. Versions are what make a bad change survivable — the previous one still exists and still works.",

  rollback: "Pointing a published agent back at an earlier version, in one click. Nothing is deleted; you're only changing which version answers calls.",
} as const;

export type GlossaryKey = keyof typeof GLOSSARY;
