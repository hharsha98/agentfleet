import { test, expect } from "@playwright/test";

// "llm" project — needs the LLM proxy (http://localhost:3001) up. Skippable
// entirely via `E2E_SKIP_LLM=1` (see playwright.config.ts), since these
// tests stream real model output and can be slower/flakier than the
// deterministic suite.

test("sending a message streams an assistant reply and shows a usage line", async ({ page }) => {
  await page.goto("/chat");
  await page.getByRole("button", { name: "Creative Writer" }).click();

  await page.getByPlaceholder(/^Message /).fill("Reply with exactly the word OK.");
  await page.getByRole("button", { name: "Send" }).click();

  const messageList = page.locator("div.flex-1.space-y-4.overflow-y-auto");
  const assistantBubble = messageList.locator("> div").last();

  // The usage line (`↑… ↓… tok`) only renders once the stream's "done"
  // event lands, so waiting on it is also our signal streaming finished.
  await expect(page.getByText(/↑\d+ ↓\d+ tok/)).toBeVisible({ timeout: 60_000 });
  await expect(assistantBubble).not.toBeEmpty();
});

test("fenced-code replies render an artifact chip that opens the side panel", async ({
  page,
}) => {
  await page.goto("/chat");
  await page.getByRole("button", { name: "Creative Writer" }).click();

  const prompt = [
    "Reply with exactly three fenced code blocks and no other commentary:",
    '1) a fence tagged python containing: print("hi")',
    "2) a fence tagged vega-lite containing a minimal valid Vega-Lite JSON spec",
    "3) a fence tagged markdown containing: # Hello",
    "Use triple backticks for every fence, nothing outside the fences.",
  ].join("\n");

  await page.getByPlaceholder(/^Message /).fill(prompt);
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByText(/↑\d+ ↓\d+ tok/)).toBeVisible({ timeout: 60_000 });

  // LLM output isn't guaranteed to produce exactly three fenced blocks, so
  // this only requires at least one artifact chip to appear — see the
  // fence-classification rules in lib/artifacts.ts.
  const artifactChip = page.getByRole("button", { name: /open$/ }).first();
  await expect(artifactChip).toBeVisible();

  await artifactChip.click();
  await expect(page.getByRole("button", { name: "Copy" })).toBeVisible();
});
