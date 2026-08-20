import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Config for the runtime enforcement canaries (`pnpm agent:canary`).
 *
 * ## Why these are not in `pnpm test`
 *
 * They spawn the real 310 MB Claude Agent SDK binary and take tens of seconds
 * each. That is too slow for a gate that runs on every change, and the thing
 * they prove — that the SDK actually routes tool calls through Vibe's policy —
 * changes only when the SDK version or the runtime program does.
 *
 * ## Why these are not probes
 *
 * A probe makes real, billable provider requests. A canary makes **none**: it
 * points `ANTHROPIC_BASE_URL` at a local stub that returns canned responses, so
 * the SDK's whole control path runs against a server that costs nothing. The
 * names are kept distinct so nobody has to remember which one spends money.
 *
 * ## Why they exist at all
 *
 * Because `allowedTools` silently bypassed `canUseTool` for an entire paid run
 * and every unit test still passed — they asserted the shape of generated code,
 * not the SDK's behaviour. A test that proves a boundary has to run the thing
 * that enforces it.
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
    include: ["src/**/*.canary.ts"],
    fileParallelism: false,
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
});
