// Playwright config for AgentFleet's web E2E suite (Phase 11 O).
//
// README (read before running):
//   These tests assume the dev stack is ALREADY running locally — this
//   config has NO `webServer` block, on purpose, so `playwright test` never
//   tries to build or start anything on its own. Before running `npm run
//   e2e` (or `e2e:fast`), make sure:
//     - API:       http://localhost:8000  (apps/api — uv run uvicorn app.main:app --port 8000)
//     - Web:       http://localhost:3010  (apps/web — npm run dev, pinned to 3010)
//     - LLM proxy: http://localhost:3001  (only required for the "llm" project)
//
// Two projects, split by whether a test needs the LLM proxy:
//   - "deterministic": smoke / command palette / documents / automations —
//     no LLM calls, fast, 0 retries.
//   - "llm": chat / playground — streams real model output, slower and can
//     be flaky, 1 retry. Skippable entirely via E2E_SKIP_LLM=1 (drops the
//     project from the run rather than skipping test-by-test), e.g.
//     `npm run e2e:fast`.
//
// See e2e/README.md for prerequisites and commands.

import { defineConfig, devices } from "@playwright/test";

const skipLlm = process.env.E2E_SKIP_LLM === "1";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  reporter: "list",
  // Phase 12 B2: forges a real Auth.js session cookie (see auth.setup.ts)
  // before any test runs, since every page below is now auth-gated. Both
  // projects start every test already signed in as e2e@test.local;
  // auth.spec.ts explicitly opts OUT of storageState for its fresh-context
  // signed-out assertions.
  globalSetup: "./e2e/auth.setup.ts",
  use: {
    baseURL: "http://localhost:3010",
    trace: "retain-on-failure",
    storageState: "./e2e/.auth/state.json",
  },
  projects: [
    {
      name: "deterministic",
      testMatch: [
        "smoke.spec.ts",
        "palette.spec.ts",
        "documents.spec.ts",
        "automations.spec.ts",
        "auth.spec.ts",
        "workflows.spec.ts",
      ],
      retries: 0,
      timeout: 30_000,
      use: { ...devices["Desktop Chrome"] },
    },
    ...(skipLlm
      ? []
      : [
          {
            name: "llm",
            testMatch: ["chat.spec.ts", "playground.spec.ts"],
            retries: 1,
            timeout: 60_000,
            use: { ...devices["Desktop Chrome"] },
          },
        ]),
  ],
});
