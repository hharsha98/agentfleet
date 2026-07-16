import { test, expect } from "@playwright/test";

// Deterministic project: proves the auth gate actually gates, from a
// context with NO forged session cookie — every other spec in this suite
// runs authed via the global storageState (see auth.setup.ts +
// playwright.config.ts), so this is the one place that exercises the
// signed-out path.

test.use({ storageState: { cookies: [], origins: [] } });

test("signed-out visitors are redirected off gated pages, and the API 401s without a token", async ({
  page,
  request,
}) => {
  // 1. proxy.ts + auth.ts's `authorized` callback gate /chat — a signed-out
  // visitor should land on the Auth.js sign-in page, not the chat UI.
  await page.goto("/chat");
  await expect(page).toHaveURL(/\/api\/auth\/signin/);

  // 2. Belt-and-suspenders on the API side (B1): hitting the backend
  // directly with no Authorization header must 401, independent of
  // whatever the web app's gating does.
  const res = await request.get("http://localhost:8000/api/v1/agents");
  expect(res.status()).toBe(401);

  // 3. The token mint route self-guards: with no session cookie (this
  // test's `request` fixture inherits the empty storageState set above),
  // it must 401 rather than mint a token for nobody.
  const tokenRes = await request.get("http://localhost:3002/api/token");
  expect(tokenRes.status()).toBe(401);
});
