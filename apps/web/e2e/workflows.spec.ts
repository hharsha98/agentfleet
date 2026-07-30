import { test, expect } from "@playwright/test";

// Deterministic project: the workflow builder's Validate call and the
// canvas/inspector interactions below are all pure CRUD + a compile-check
// against the API — no LLM involved. This spec must NEVER click Run: that
// endpoint dispatches a real mission (real LLM tokens), so every scenario
// below stops at Validate.
//
// Node-selection trick used throughout: adding a node via the palette
// always selects it (see addNode() in workflow-builder.tsx), and React Flow
// itself adds a "selected" class to the corresponding `.react-flow__node`
// wrapper. So after adding two nodes, the *first* one added is always the
// one matching `.react-flow__node:not(.selected)` — no need to know either
// node's title or id up front.
//
// Locators: the agent palette and the "Connect to →" select are addressed by
// data-testid ("agent-palette" / "connect-select"). They used to be selected
// structurally (`ul.space-y-1\.5 li button`, and a `select` filtered by the
// option text "Choose a node…") — both silently break on a restyle, and there
// are four other `space-y-1.5` lists in the app.

test("builds a two-node graph, saves, and validates successfully", async ({ page }) => {
  page.on("dialog", (dialog) => dialog.accept());
  const name = `E2E workflow ${Date.now()}`;

  await page.goto("/workflows");
  await page.getByRole("button", { name: "New workflow" }).click();
  await expect(page).toHaveURL(/\/workflows\/[^/]+$/);

  // BuilderCanvas is a lazy, client-only chunk (next/dynamic ssr:false).
  await expect(page.locator(".react-flow")).toBeVisible();

  await page.getByPlaceholder("Workflow name").fill(name);

  const paletteButtons = page.locator('[data-testid="agent-palette"] li button');
  await expect(paletteButtons.first()).toBeVisible();
  await paletteButtons.first().click(); // node A — added and selected
  await paletteButtons.first().click(); // node B — added and selected

  // Node B is selected here, so this wires B -> A. Direction doesn't matter
  // for an acyclic-graph check — a single edge either way is still acyclic.
  const connectSelect = page.getByTestId("connect-select");
  await connectSelect.selectOption({ index: 1 });

  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Validate", exact: true }).click();
  await expect(page.getByText(/^Valid\b/)).toBeVisible();
  await expect(page.locator('[class*="ring-red-500"]')).toHaveCount(0);

  // Cleanup: delete from the workflows list page (not via a direct API
  // call) — this spec must not depend on, or leave behind, other data.
  await page.getByRole("link", { name: "← All workflows" }).click();
  const card = page.locator("div", { hasText: name }).last();
  await card.getByRole("button", { name: "Delete" }).click();
  await expect(card).not.toBeVisible();
});

test("an empty instruction warns but never blocks validation or rings the node", async ({
  page,
}) => {
  page.on("dialog", (dialog) => dialog.accept());
  const name = `E2E empty instruction ${Date.now()}`;

  await page.goto("/workflows");
  await page.getByRole("button", { name: "New workflow" }).click();
  await expect(page).toHaveURL(/\/workflows\/[^/]+$/);
  await expect(page.locator(".react-flow")).toBeVisible();

  await page.getByPlaceholder("Workflow name").fill(name);

  const paletteButtons = page.locator('[data-testid="agent-palette"] li button');
  await expect(paletteButtons.first()).toBeVisible();
  await paletteButtons.first().click(); // node A — added and selected, instruction left blank
  await paletteButtons.first().click(); // node B — added and selected, instruction left blank

  // This is the moment the mistake is made — the inspector hint should
  // already be visible for the selected node, before Validate is ever
  // clicked.
  await expect(
    page.getByText(/No instruction — the agent will only see the title/),
  ).toBeVisible();

  // B is selected here, so this wires B -> A. Direction doesn't matter for
  // an acyclic-graph check.
  const connectSelect = page.getByTestId("connect-select");
  await connectSelect.selectOption({ index: 1 });

  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Validate", exact: true }).click();
  await expect(page.getByText(/^Valid\b/)).toBeVisible();
  await expect(page.getByText("1 warning", { exact: true })).toBeVisible();
  await expect(page.getByText(/empty_instruction/)).toBeVisible();

  // A warning must never get NodeShell's error-only red ring.
  await expect(page.locator('[class*="ring-red-500"]')).toHaveCount(0);

  await page.getByRole("link", { name: "← All workflows" }).click();
  const card = page.locator("div", { hasText: name }).last();
  await card.getByRole("button", { name: "Delete" }).click();
  await expect(card).not.toBeVisible();
});

test("a cycle fails validation, rings both nodes, and never creates a run", async ({ page }) => {
  page.on("dialog", (dialog) => dialog.accept());
  const name = `E2E cycle ${Date.now()}`;

  await page.goto("/workflows");
  await page.getByRole("button", { name: "New workflow" }).click();
  await expect(page).toHaveURL(/\/workflows\/[^/]+$/);
  await expect(page.locator(".react-flow")).toBeVisible();

  await page.getByPlaceholder("Workflow name").fill(name);

  const paletteButtons = page.locator('[data-testid="agent-palette"] li button');
  await paletteButtons.first().click(); // node A — added and selected
  await paletteButtons.first().click(); // node B — added and selected

  const connectSelect = page.getByTestId("connect-select");

  // B is selected -> B -> A.
  await connectSelect.selectOption({ index: 1 });

  // Re-select the other node (A, currently unselected) -> A -> B, closing
  // the cycle.
  await page.locator(".react-flow__node:not(.selected)").click();
  await connectSelect.selectOption({ index: 1 });

  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Validate", exact: true }).click();
  await expect(page.getByText("1 error", { exact: true })).toBeVisible();
  await expect(page.getByText(/cycle/i)).toBeVisible();

  // Both nodes in the cycle get NodeShell's red ring.
  await expect(page.locator('[class*="ring-red-500"]')).toHaveCount(2);

  // No Run button was ever clicked, and staying on the builder route (never
  // navigating to /missions) confirms nothing was dispatched.
  await expect(page).toHaveURL(/\/workflows\/[^/]+$/);

  await page.getByRole("link", { name: "← All workflows" }).click();
  const card = page.locator("div", { hasText: name }).last();
  await card.getByRole("button", { name: "Delete" }).click();
  await expect(card).not.toBeVisible();
});

test("dragging between two nodes' handles creates a real edge", async ({ page }) => {
  page.on("dialog", (dialog) => dialog.accept());
  const name = `E2E drag connect ${Date.now()}`;

  await page.goto("/workflows");
  await page.getByRole("button", { name: "New workflow" }).click();
  await expect(page).toHaveURL(/\/workflows\/[^/]+$/);
  await expect(page.locator(".react-flow")).toBeVisible();
  await page.getByPlaceholder("Workflow name").fill(name);

  const paletteButtons = page.locator('[data-testid="agent-palette"] li button');
  await expect(paletteButtons.first()).toBeVisible();
  await paletteButtons.first().click(); // node A
  await paletteButtons.first().click(); // node B — added and selected

  // A is the unselected node; B is the selected one. Drag A's SOURCE handle
  // (right dot) onto B's TARGET handle (left dot) => edge A -> B.
  const nodeA = page.locator(".react-flow__node:not(.selected)");
  const nodeB = page.locator(".react-flow__node.selected");
  const sourceHandle = nodeA.locator(".react-flow__handle-right");
  const targetHandle = nodeB.locator(".react-flow__handle-left");
  await expect(sourceHandle).toBeVisible();
  await expect(targetHandle).toBeVisible();

  const from = await sourceHandle.boundingBox();
  const to = await targetHandle.boundingBox();
  if (!from || !to) throw new Error("handles have no bounding box — canvas did not lay out");

  // Manual mouse steps rather than dragTo(): React Flow starts a connection
  // on pointerdown and tracks pointermove on the pane, so it needs at least
  // one intermediate move between press and release.
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
  await page.mouse.up();

  // A real React Flow edge now exists on the canvas.
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);

  // The Inspector still shows node B (selection is unchanged by a drag), so
  // switch to A to read ITS outgoing edges — the edge must be A -> B.
  await nodeA.click();
  await expect(page.getByTestId("outgoing-edges")).toBeVisible();
  await expect(page.getByTestId("outgoing-edges").locator("li")).toHaveCount(1);

  // Proof the dragged edge went through the SAME guards as the select: the
  // Inspector's "Connect to →" option for that target is now disabled
  // (addEdge's no-duplicate rule), which only happens if the edge really
  // landed in the builder's own `edges` state rather than React Flow's.
  await expect(page.getByTestId("connect-select").locator("option:not([value=''])")).toBeDisabled();

  // And it compiles: one edge between two nodes is acyclic.
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Validate", exact: true }).click();
  await expect(page.getByText(/^Valid\b/)).toBeVisible();

  await page.getByRole("link", { name: "← All workflows" }).click();
  const card = page.locator("div", { hasText: name }).last();
  await card.getByRole("button", { name: "Delete" }).click();
  await expect(card).not.toBeVisible();
});

test("the empty canvas explains itself and the overlay clears on the first step", async ({
  page,
}) => {
  page.on("dialog", (dialog) => dialog.accept());
  const name = `E2E empty canvas ${Date.now()}`;

  await page.goto("/workflows");
  await page.getByRole("button", { name: "New workflow" }).click();
  await expect(page).toHaveURL(/\/workflows\/[^/]+$/);
  await expect(page.locator(".react-flow")).toBeVisible();
  await page.getByPlaceholder("Workflow name").fill(name);

  // Zero nodes: the three-step explainer is the first thing on the canvas.
  const emptyState = page.getByText("Start your first workflow");
  await expect(emptyState).toBeVisible();

  // One palette click and it is gone, because there is now something to look
  // at instead.
  await page.locator('[data-testid="agent-palette"] li button').first().click();
  await expect(emptyState).toBeHidden();

  // Save before navigating away, otherwise the list still shows this workflow
  // under createBlank()'s "Untitled workflow" placeholder and the cleanup
  // below cannot find it by name.
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();

  await page.getByRole("link", { name: "← All workflows" }).click();
  const card = page.locator("div", { hasText: name }).last();
  await card.getByRole("button", { name: "Delete" }).click();
  await expect(card).not.toBeVisible();
});

test("an example from the workflows page opens a multi-step builder", async ({ page }) => {
  page.on("dialog", (dialog) => dialog.accept());

  await page.goto("/workflows");

  // "Competitor teardown" is the fan-out/fan-in example: 4 steps, 3 waves.
  // Its name is also the name the created workflow gets, which is what the
  // cleanup step below deletes.
  const exampleName = "Competitor teardown";
  await page.getByRole("button", { name: new RegExp(`^${exampleName}`) }).click();
  await expect(page).toHaveURL(/\/workflows\/[^/]+$/);
  await expect(page.locator(".react-flow")).toBeVisible();

  // More than one node, so "waves" is actually meaningful — and no empty
  // state, because the canvas arrived populated.
  await expect(page.locator(".react-flow__node")).toHaveCount(4);
  await expect(page.getByText("Start your first workflow")).toBeHidden();

  // Every step carries a real instruction, so validation must NOT produce the
  // empty_instruction warning. Nothing is dirty on arrival either — the graph
  // was persisted by the POST — so Validate runs against exactly this graph.
  await expect(page.getByRole("button", { name: "No changes to save" })).toBeDisabled();
  await page.getByRole("button", { name: "Validate", exact: true }).click();
  await expect(page.getByText(/^Valid\b/)).toBeVisible();
  await expect(page.getByText(/empty_instruction/)).toHaveCount(0);
  await expect(page.locator('[class*="ring-red-500"]')).toHaveCount(0);

  await page.getByRole("link", { name: "← All workflows" }).click();
  // NOT the `page.locator("div", { hasText: name }).last()` idiom the other
  // tests use: the example's name also appears in the "Start from an example"
  // row above the list, so once the workflow card is deleted `.last()`
  // re-resolves onto that row and the assertion never passes. `div.af-hover-nav`
  // is the workflow card itself (the example entries are <button>s, not divs).
  // hasNotText excludes the seeded demo dataset, which ships a workflow named
  // "[demo] Competitor teardown" — a plain hasText substring-matches that too,
  // so the strict-mode locator resolves to several cards. Without this, anyone
  // who has run scripts/seed_demo sees this test fail for reasons that have
  // nothing to do with the code under test.
  const card = page
    .locator("div.af-hover-nav")
    .filter({ hasText: exampleName })
    .filter({ hasNotText: "[demo]" });
  await card.getByRole("button", { name: "Delete" }).click();
  await expect(card).toHaveCount(0);
});
