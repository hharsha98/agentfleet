import { test, expect } from "@playwright/test";

// "llm" project — needs the LLM proxy (http://localhost:3001) up. Skippable
// entirely via `E2E_SKIP_LLM=1` (see playwright.config.ts).

const API_URL = "http://localhost:8000";

test("running both variants shows two outputs and two usage footers", async ({
  page,
  request,
}) => {
  // Fetch real, currently-available models from the API rather than
  // hardcoding one that might not exist behind the proxy.
  const modelsRes = await request.get(`${API_URL}/api/v1/playground/models`);
  expect(modelsRes.ok()).toBeTruthy();
  const { models } = (await modelsRes.json()) as { models: string[] };
  expect(models.length).toBeGreaterThanOrEqual(2);

  await page.goto("/playground");

  await page
    .getByPlaceholder("What should both variants respond to?")
    .fill("Reply with exactly the word OK.");

  const modelInputs = page.locator('input[list="playground-models"]');
  await modelInputs.nth(0).fill(models[0]);
  await modelInputs.nth(1).fill(models[1]);

  await page.getByRole("button", { name: "Run both" }).click();

  await expect(page.getByText("No output yet.")).toHaveCount(0, { timeout: 60_000 });
  await expect(page.getByText(/↑\d+ ↓\d+ tok/)).toHaveCount(2, { timeout: 60_000 });
});
