import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Loads `.env.local` the way a developer expects it to be loaded.
 *
 * Next.js reads `.env.local` automatically; vitest does not, and nothing here
 * did either — so every probe invocation meant pasting five or six secrets onto
 * the command line, where they land in shell history. For the calibration
 * workflow that is ten invocations, which is ten chances to leak a key or fat-
 * finger one and read the resulting failure as a fact about the run.
 *
 * Three deliberate properties:
 *
 * - **An explicit variable always wins.** Anything already in `process.env` is
 *   left alone, so `FOO=bar pnpm agent:calibrate` still overrides the file.
 * - **Escapes are not interpreted.** `GITHUB_APP_PRIVATE_KEY` is stored as one
 *   line with literal `\n` sequences, and `src/lib/env/github.ts` converts them
 *   back itself. Unescaping here would hand it a key it then mangles again.
 * - **Absence is fine.** CI has no `.env.local`, and CI never runs probes.
 */
function loadLocalEnv(): void {
  const path = fileURLToPath(new URL("./.env.local", import.meta.url));
  if (!existsSync(path)) return;

  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;

    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;

    const key = trimmed.slice(0, separator).trim();
    if (process.env[key] !== undefined) continue;

    const raw = trimmed.slice(separator + 1).trim();
    const quoted =
      (raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"));

    process.env[key] = quoted ? raw.slice(1, -1) : raw;
  }
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
