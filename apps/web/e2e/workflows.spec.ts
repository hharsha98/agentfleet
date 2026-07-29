import { test, expect } from "@playwright/test";

// Deterministic project: the workflow builder's Validate call and the
// canvas/inspector interactions below are all pure CRUD + a compile-check
// against the API — no LLM involved. This spec must NEVER click Run: that
// endpoint dispatches a real mission (real LLM tokens), so both scenarios
// below stop at Validate.
//
// Node-selection trick used throughout: adding a node via the palette
// always selects it (see addNode() in workflow-builder.tsx), and React Flow
// itself adds a "selected" class to the corresponding `.react-flow__node`
// wrapper. So after adding two nodes, the *first* one added is always the
// one matching `.react-flow__node:not(.selected)` — no need to know either
// node's title or id up front.

test("builds a two-node graph, saves, and validates successfully", async ({ page }) => {
  page.on("dialog", (dialog) => dialog.accept());
  const name = `E2E workflow ${Date.now()}`;

  await page.goto("/workflows");
  await page.getByRole("button", { name: "New workflow" }).click();
  await expect(page).toHaveURL(/\/workflows\/[^/]+$/);

  // BuilderCanvas is a lazy, client-only chunk (next/dynamic ssr:false).
  await expect(page.locator(".react-flow")).toBeVisible();

  await page.getByPlaceholder("Workflow name").fill(name);

  const paletteButtons = page.locator("ul.space-y-1\\.5 li button");
  await expect(paletteButtons.first()).toBeVisible();
  await paletteButtons.first().click(); // node A — added and selected
  await paletteButtons.first().click(); // node B — added and selected

  // Node B is selected here, so this wires B -> A. Direction doesn't matter
  // for an acyclic-graph check — a single edge either way is still acyclic.
  const connectSelect = page.locator("select").filter({ hasText: "Choose a node…" });
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

test("a cycle fails validation, rings both nodes, and never creates a run", async ({ page }) => {
  page.on("dialog", (dialog) => dialog.accept());
  const name = `E2E cycle ${Date.now()}`;

  await page.goto("/workflows");
  await page.getByRole("button", { name: "New workflow" }).click();
  await expect(page).toHaveURL(/\/workflows\/[^/]+$/);
  await expect(page.locator(".react-flow")).toBeVisible();

  await page.getByPlaceholder("Workflow name").fill(name);

  const paletteButtons = page.locator("ul.space-y-1\\.5 li button");
  await paletteButtons.first().click(); // node A — added and selected
  await paletteButtons.first().click(); // node B — added and selected

  const connectSelect = page.locator("select").filter({ hasText: "Choose a node…" });

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
