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
  projects: [
    // mobile.spec.ts's assertions (e.g. a table header hidden at narrow
    // width) are specific to the mobile project's viewport and would fail
    // under this one's desktop width, so it's excluded here rather than
    // run twice.
    { name: "chromium", use: { ...devices["Desktop Chrome"] }, testIgnore: "**/mobile.spec.ts" },
    // Runs only e2e/mobile.spec.ts (not the whole suite a second time —
    // most flows have no mobile-specific behavior to verify) against a real
    // narrow viewport, checking the app's first-ever mobile breakpoint
    // (globals.css's @media (max-width: 640px) block) actually does
    // something, not just that pages load.
    // Pixel 5 (Chromium-based), not an iPhone preset (WebKit) — this
    // environment only has the Chromium browser installed, and the point
    // here is exercising the CSS breakpoint at a real narrow viewport, not
    // engine-specific behavior.
    { name: "mobile", use: { ...devices["Pixel 5"] }, testMatch: "**/mobile.spec.ts" },
  ],
  webServer: {
    // `next start` (pnpm start) doesn't work against an `output: "standalone"`
    // build (next.config.ts) — it warns and then the server destabilizes
    // under load (seen for real in CI: a mid-suite stream error cascading
    // into ~9 unrelated-looking test failures). The standalone build's own
    // server.js is the supported way to run it, but it doesn't copy
    // public/ or .next/static on its own (Next's docs say this is
    // deliberate, meant for a CDN) — copy them in first, via fs.cpSync
    // (stdlib, no new dependency) rather than a shell `cp` that Windows
    // local dev doesn't have.
    command:
      'pnpm build && node -e "const fs=require(\'fs\');fs.cpSync(\'public\',\'.next/standalone/public\',{recursive:true});fs.cpSync(\'.next/static\',\'.next/standalone/.next/static\',{recursive:true})" && node .next/standalone/server.js',
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
