import { test, expect } from "@playwright/test";

// Deterministic project: the ⌘K / Ctrl+K command palette is pure client
// routing, no LLM or API dependency.

test("command palette opens, filters, and navigates via Enter", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("ControlOrMeta+k");

  const dialog = page.getByRole("dialog", { name: "Command palette" });
  await expect(dialog).toBeVisible();

  const input = page.getByPlaceholder("Jump to…");
  await input.fill("voice");
  await expect(page.getByRole("option", { name: /Voice/ })).toBeVisible();
  // Filtering to "voice" should leave exactly the Voice command.
  await expect(page.getByRole("option")).toHaveCount(1);

  await input.press("Enter");
  await expect(page).toHaveURL(/\/voice$/);
  await expect(dialog).not.toBeVisible();
});

test("command palette closes on Escape after reopening", async ({ page }) => {
  await page.goto("/");
  const dialog = page.getByRole("dialog", { name: "Command palette" });

  await page.keyboard.press("ControlOrMeta+k");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();

  // Reopen after the first close to confirm the listener still works.
  await page.keyboard.press("ControlOrMeta+k");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
});
