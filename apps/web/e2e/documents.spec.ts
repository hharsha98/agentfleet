import path from "node:path";

import { test, expect } from "@playwright/test";

// Deterministic project: no LLM call, but the API's local fastembed model
// loads lazily on first use — the first upload in a fresh backend process
// can take a while, so this test gets a generous timeout.

test("uploading a document ingests it and lists it", async ({ page }) => {
  test.setTimeout(60_000);

  await page.goto("/documents");

  await page
    .locator('input[type="file"]')
    .setInputFiles(path.join(__dirname, "fixtures/sample.txt"));
  await page.getByRole("button", { name: "Upload" }).click();

  await expect(page.getByText(/ingested into \d+ chunks?/).first()).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByText("sample.txt").first()).toBeVisible();
});
