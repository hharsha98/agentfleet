# Demo script

A 3–5 minute walkthrough for a portfolio recording. Follow the scenes in order; each one names the exact click and what to say. Keep narration short — let the UI do the talking.

## Before you record

- [ ] Provider ready: either the free proxy is running and `FREE_LLM_KEY` is set in `.env`, **or** you've switched `FREE_LLM_BASE_URL`/`FREE_LLM_KEY` (or `ANTHROPIC_API_KEY`, see ADR-005) to a paid provider for a smoother take — free-tier models can 429 mid-recording.
- [ ] `cp .env.example .env` and fill in keys, if you haven't already.
- [ ] `docker compose -f docker/compose.full.yaml up --build` — wait for all containers healthy. The api container migrates the DB and seeds the built-in agent roster automatically; no manual seed step needed.
- [ ] Open `http://localhost:3002` once and confirm the landing page loads before you hit record — first load can be slow while fastembed downloads its model (~130MB, one time).
- [ ] Have a short PDF or text file on hand for the document-upload scene.
- [ ] Clear browser console / close dev tools so the recording is clean.

## Scene 1 — Landing page (20s)

1. Open `http://localhost:3002`.
2. Scroll slowly through the hero and the pillars grid.
3. **Say:** "AgentFleet is a self-hostable multi-agent operations platform — chat, orchestration, document intelligence, and an ops layer with evals, budgets, and guardrails, all running locally in Docker."

## Scene 2 — Sign in (10s)

1. Click **Launch app** (top right).
2. Sign in with Google via the Auth.js flow.
3. **Say:** "Auth is Google OAuth via Auth.js v5 — nothing custom to maintain."

## Scene 3 — Chat with a tool-using agent (45–60s)

1. Go to **Chat**, pick an agent that has `web_search` enabled (e.g. the research agent).
2. Ask something time-sensitive it can't know from training, e.g. *"What's the latest release version of Next.js?"*
3. Let it stream. **Point at the tool-call card** as it appears — the query it searched, then the result preview.
4. **Say:** "Every tool call is a real streamed event — you can see the agent's tool call and the result it got back before it writes the final answer. If a provider aborts mid-stream on a malformed call, there's a salvage path that still produces an answer from whatever was gathered."

## Scene 4 — Upload a document and ask about it (45s)

1. Go to **Documents**, upload the PDF/text file you prepared.
2. Wait for it to show `ready` (chunked + embedded locally — no cloud embedding call).
3. Go back to **Chat**, pick an agent with `search_documents` enabled, ask a question the document actually answers.
4. **Point at the citation** in the reply (which chunk/document it pulled from).
5. **Say:** "Documents are chunked and embedded on-CPU with fastembed — no per-token embedding cost, nothing leaves the machine — then retrieved from pgvector with a citation back to the source chunk."

## Scene 5 — Missions: goal → Kanban DAG → approval (60–75s)

1. Go to **Missions**, click **New mission**, give it a concrete goal (e.g. *"Research X and draft a two-paragraph summary"*).
2. Watch the board: tasks appear in **todo**, move to **in progress** as they run in parallel, land in **done**.
3. When a task lands in **review** (an orchestrator-flagged approval gate), open it, show the output, click **Approve**.
4. **Say:** "The orchestrator decomposes the goal into a task DAG and runs independent tasks in parallel — right now it's an in-process async executor, with Redis already in the stack for the queue-backed version. Anything consequential pauses for a human approval gate before the run continues."

## Scene 6 — Agents: build one, then red-team it (60s)

1. Go to **Agents**, click **New agent**. Give it a name, a short system prompt, pick a model, enable one tool.
2. Save, then click **Publish** — show the version number tick up.
3. Click into the agent's **Red-team** action. Watch it run the adversarial suite (prompt-injection, "reveal your system prompt," fake `[system]` override, base64-smuggled instruction, etc.).
4. **Point at a passed case** — the agent declining to leak its prompt or obey the injected instruction.
5. **Say:** "Every agent can be red-teamed on demand — six adversarial cases checking for prompt-injection compliance, jailbreak personas, and secret leakage, scored by deterministic checks plus an LLM judge."
6. Open the agent's version history, click **rollback** on an earlier version to show it restores instantly.

## Scene 7 — Usage: cost budgets (30s)

1. Go to **Usage**. Show today's token/cost totals ticking up from the calls made so far in the recording.
2. Point at the global budget and one agent-scoped budget (daily token limit / daily $ limit).
3. **Say:** "Every assistant message is metered for tokens, cost, and latency. Budgets are enforced per-agent and globally — cross the cap and the next call is blocked with a clear message instead of silently overspending."

## Scene 8 — Evals: run one, show the CI gate (30–45s)

1. Go to **Evals**, pick an agent with golden test cases, click **Run eval**.
2. Watch cases score (deterministic substring checks + LLM-as-judge where a rubric is set).
3. Cut to the GitHub repo's **Actions** tab (or just the CI badge in the README) and point at the green `evals` workflow — it runs the same test suite plus the eval gate against a live pgvector service on every push.
4. **Say:** "The same eval logic gates CI — 31 tests plus an LLM-judged regression check run on every push, so an agent config change that breaks behavior gets caught before it ships."

## Wrap (10s)

Cut back to the landing page or a clean chat view. **Say:** "That's AgentFleet — self-hosted, fully local, and built the way a production agent platform would need to be: traced, evaluated, budgeted, and guarded."

---

Total run time: roughly 4–5 minutes at a natural pace. If you need to trim, cut Scene 2 (sign-in) and shorten Scene 6 to just the red-team run.
