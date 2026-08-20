import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  // Playwright's own default (half the logical CPU count, 10 on this
  // 20-core dev machine) runs 10 full browser sessions against one local
  // Postgres + one Next.js server process at once. That's fine against a
  // small dataset, but became a mass-timeout failure (nearly the whole
  // suite hitting the 30s test timeout, server responses stretching to
  // multiple seconds) once the dev DB held the full ~4,185-user legacy
  // migration dataset instead of just seed fixtures. Capped lower locally
  // so the suite stays reliable regardless of how much data the dev DB
  // currently holds; CI runs its own dedicated DB per run and keeps its
  // own default.
  workers: process.env.CI ? undefined : 4,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm build && pnpm start",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
