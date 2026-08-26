import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Config for the real-PostgreSQL schema-authority suite (`pnpm db:test`).
 *
 * ## Why this is not `pnpm test`
 *
 * It provisions a PostgreSQL cluster with `initdb` and applies every migration
 * to it. That needs server binaries on the path and takes tens of seconds — a
 * unit suite that silently requires either is a unit suite people stop running,
 * which is the same reasoning `vitest.concurrency.config.mts` records.
 *
 * ## Why this is not the concurrency suite
 *
 * That one proves application code through PostgREST, on purpose. This one
 * proves privileges, trigger context and role behaviour, none of which
 * PostgREST can express. Keeping the names distinct keeps the cost of each
 * suite legible: `*.test.ts` is free and fast, `*.migration.ts` needs
 * PostgreSQL, `*.concurrency.ts` needs Docker, `*.probe.ts` spends money.
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
    include: ["supabase/tests/**/*.migration.ts"],
    // One cluster per file, and the port is random: two files running at once
    // would still be independent, but serial keeps failures readable.
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 300_000,
  },
});
