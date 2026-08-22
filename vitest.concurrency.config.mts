import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Config for the real-database concurrency suite (`pnpm billing:concurrency`).
 *
 * ## Why this is not `pnpm test`
 *
 * It needs a running PostgreSQL, a running PostgREST and a running Auth server.
 * A unit suite that silently requires three containers is a unit suite people
 * stop running locally — the same reasoning `playwright.config.ts` records for
 * keeping the browser suite out of `pnpm test`.
 *
 * ## Why this is not a probe
 *
 * A probe makes real, billable provider requests and holds real credentials.
 * This makes none and holds none: the only database it can reach is a
 * disposable local stack, enforced by the target guard in
 * `src/modules/credits/concurrency/harness.ts`. Reusing
 * `vitest.probe.config.mts` would also sweep every `*.probe.ts` into the run,
 * including the ones that spend money.
 *
 * The names are kept distinct so nobody has to remember which suite costs
 * something: `*.test.ts` is free and fast, `*.canary.ts` is free and slow,
 * `*.concurrency.ts` is free and needs Docker, `*.probe.ts` spends money.
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
    include: ["src/**/*.concurrency.ts"],
    // Iteration counts are exact assertions, so two race classes must never
    // share a database concurrently — one class's fixtures would appear in the
    // other's reads.
    fileParallelism: false,
    testTimeout: 300_000,
    hookTimeout: 120_000,
  },
});
