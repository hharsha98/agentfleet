import { test, expect, type Page } from "@playwright/test";

// Deterministic project: the ⌘K / Ctrl+K command palette is pure client
// routing, no LLM or API dependency.

async function openPalette(page: Page) {
  // CommandPalette is a client component. Pressing the shortcut before it
  // hydrates is a silent no-op (the dialog never appears). Wait for the
  // landing heading, then focus the page so Chromium actually delivers the
  // key to our window listener.
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.locator("body").click();
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
}

test("command palette opens, filters, and navigates via Enter", async ({ page }) => {
  await page.goto("/");
  await openPalette(page);

  const dialog = page.getByRole("dialog", { name: "Command palette" });
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

  await openPalette(page);
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();

  // Reopen after the first close to confirm the listener still works.
  await openPalette(page);
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
});
