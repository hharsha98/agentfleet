import { test, expect } from "@playwright/test";

// Deterministic project: automations UI is CRUD against the API only, no
// LLM call. Auto-accept the native `confirm()` dialog that gates Delete so
// cleanup doesn't need manual per-click dialog handling. Both rows created
// here ARE cleaned up via the UI's Delete button (it's exposed for both
// schedules and webhooks), unlike some other e2e specs in this suite.

test("creating a schedule automation lists it and can be deleted", async ({ page }) => {
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto("/automations");

  const name = `E2E schedule ${Date.now()}`;
  const scheduleForm = page.locator("form", { has: page.getByText("New automation") });
  await scheduleForm.getByPlaceholder("Name (e.g. Daily competitor scan)").fill(name);
  await scheduleForm
    .getByPlaceholder(/Goal — the same kind of thing/)
    .fill("Say good morning to the team.");
  await scheduleForm.getByPlaceholder("0 9 * * *").fill("0 9 * * *");
  await scheduleForm.getByRole("button", { name: "Create" }).click();

  const row = page.locator("li", { hasText: name });
  await expect(row).toBeVisible();

  await row.getByRole("button", { name: "Delete" }).click();
  await expect(row).not.toBeVisible();
});

test("creating a webhook lists it, shows the one-time secret, and can be deleted", async ({
  page,
}) => {
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto("/automations");

  const name = `E2E webhook ${Date.now()}`;
  const webhookForm = page.locator("form", { has: page.getByText("New webhook") });
  await webhookForm.getByPlaceholder("Name (e.g. Zendesk ticket triage)").fill(name);
  await webhookForm.getByPlaceholder(/Goal template/).fill("Handle this: {payload}");
  await webhookForm.getByRole("button", { name: "Create" }).click();

  await expect(page.getByText(/copy the secret now/i)).toBeVisible();

  const row = page.locator("li", { hasText: name });
  await expect(row).toBeVisible();

  await row.getByRole("button", { name: "Delete" }).click();
  await expect(row).not.toBeVisible();
});
