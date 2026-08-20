import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Spawning many fork-process workers at once is unreliable on this dev
    // machine — one occasionally misses vitest-pool-runner's worker-startup
    // handshake and times out (`[vitest-pool]: Failed to start forks worker`),
    // failing the whole run even though every test itself passes. Running
    // files sequentially isn't a slowdown here: the suite's actual test time
    // is under 2s, so process-spawn overhead dominated the parallel run
    // anyway (measured ~60s parallel-with-a-timeout vs ~9s sequential).
    fileParallelism: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      // .tsx components aren't unit-tested in this project (e2e covers UI
      // behavior) — including them would just pad the denominator with
      // untested files rather than reflect what this suite actually covers.
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts"],
    },
  },
});
