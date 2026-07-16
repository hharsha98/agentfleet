import { test, expect, type Page } from "@playwright/test";

// Deterministic project: no LLM calls, just page loads and static content.
//
// NOTE (Phase 12): none of these pages are auth-gated yet — the auth wrapper
// lands in Phase 12. Until then there's no login flow to drive here, so the
// landing-page test below only asserts the sign-in *affordance* renders
// (the "Continue with Google" button), not a full OAuth round trip.

// Next.js always mounts a `<nextjs-portal>` custom element in dev mode (it's
// the dev-tools indicator, present even on a healthy page), so its mere
// presence isn't a signal. Its shadow DOM toast carries `data-error="true"`
// when a build/runtime error is showing, and a full-screen error dialog gets
// a `[data-nextjs-dialog]` node — Playwright's CSS engine pierces open
// shadow roots, so these locators reach inside it directly.
async function expectNoNextErrorOverlay(page: Page) {
  await expect(page.locator('[data-nextjs-toast][data-error="true"]')).toHaveCount(0);
  await expect(page.locator("[data-nextjs-dialog]")).toHaveCount(0);
  await expect(page.getByText(/Unhandled Runtime Error/i)).toHaveCount(0);
}

test("landing page renders the hero and a sign-in affordance", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "operations platform",
  );
  await expect(
    page.getByRole("button", { name: "Continue with Google" }),
  ).toBeVisible();
  await expectNoNextErrorOverlay(page);
});

test("changelog shows the release timeline", async ({ page }) => {
  await page.goto("/changelog");
  await expect(page.getByRole("heading", { name: "Changelog", level: 1 })).toBeVisible();
  await expect(page.locator("ol > li").first()).toBeVisible();
  await expectNoNextErrorOverlay(page);
});

test("voice page shows the not-configured empty state", async ({ page }) => {
  await page.goto("/voice");
  // Config is fetched client-side on mount — give it a moment.
  await expect(page.getByText("Voice is not configured")).toBeVisible({ timeout: 10_000 });
  await expectNoNextErrorOverlay(page);
});

const pageChecks: Array<{ path: string; check: (page: Page) => Promise<unknown> }> = [
  { path: "/chat", check: (p) => expect(p.getByText(/agents online/)).toBeVisible() },
  {
    path: "/documents",
    check: (p) =>
      expect(p.getByRole("heading", { name: "Knowledge base", level: 1 })).toBeVisible(),
  },
  {
    path: "/missions",
    check: (p) =>
      expect(p.getByPlaceholder(/Give the fleet a goal/)).toBeVisible(),
  },
  {
    path: "/agents",
    check: (p) =>
      expect(p.getByRole("heading", { name: "Agent builder", level: 1 })).toBeVisible(),
  },
  {
    path: "/templates",
    check: (p) =>
      expect(p.getByRole("heading", { name: "Template gallery", level: 1 })).toBeVisible(),
  },
  {
    path: "/evals",
    check: (p) =>
      expect(p.getByRole("heading", { name: "Eval Center", level: 1 })).toBeVisible(),
  },
  {
    path: "/usage",
    check: (p) =>
      expect(p.getByRole("heading", { name: "Usage & cost", level: 1 })).toBeVisible(),
  },
  {
    path: "/automations",
    check: (p) =>
      expect(p.getByRole("heading", { name: "Automations", level: 1 })).toBeVisible(),
  },
  {
    path: "/playground",
    check: (p) =>
      expect(p.getByRole("heading", { name: "Prompt Playground", level: 1 })).toBeVisible(),
  },
];

for (const { path, check } of pageChecks) {
  test(`${path} loads with its header and no Next error overlay`, async ({ page }) => {
    await page.goto(path);
    await check(page);
    await expectNoNextErrorOverlay(page);
  });
}
