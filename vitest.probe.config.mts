import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Config for the dev-only provider probes (`pnpm ai:probe-audit-schema`).
 *
 * Separate from `vitest.config.mts` on purpose: probes make **real, billable**
 * provider requests, so they must never be reachable from `pnpm test`. Two
 * independent guards keep that true — the normal config includes only
 * `*.test.ts`, and probes are named `*.probe.ts`; and probes live only in this
 * config, which CI does not run.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./src/lib/test/server-only-stub.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.probe.ts"],
    // One provider call at a time, so cost and rate limits stay predictable.
    fileParallelism: false,
  },
});
