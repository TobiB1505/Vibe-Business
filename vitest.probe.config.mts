import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { applyEnv, parseEnvFile } from "./src/lib/env/load-local-env";

/**
 * Loads `.env.local` the way `pnpm dev` already does, for the probe scripts.
 *
 * Next.js reads it automatically via its own bundled `dotenv`; Vitest does
 * not, and nothing in this repo's probe tooling did either — every
 * `pnpm agent:calibrate` invocation meant pasting five or six secrets onto the
 * command line, where they land in shell history. Ten invocations for one
 * calibration sprint is ten chances to leak a key.
 *
 * The parsing itself lives in `src/lib/env/load-local-env.ts`, with its own
 * tests. It went through two real bugs in production use before landing here
 * — an empty pre-set variable defeating the file, and a multiline quoted PEM
 * truncated to its first line — which is exactly why it is no longer inline
 * config-file logic that nothing exercised.
 */
function loadLocalEnv(): void {
  const path = fileURLToPath(new URL("./.env.local", import.meta.url));
  if (!existsSync(path)) return;

  applyEnv(parseEnvFile(readFileSync(path, "utf8")), process.env);
}

loadLocalEnv();

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
