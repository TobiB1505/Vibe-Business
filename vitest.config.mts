import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // See src/lib/test/server-only-stub.ts for why.
      "server-only": fileURLToPath(new URL("./src/lib/test/server-only-stub.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    /*
     * `.tsx` as well, though none exists yet.
     *
     * A test file the runner does not match is indistinguishable from a test
     * file that passes: it produces no output, no failure and no count anybody
     * would miss. There is no reason a component test would be written as
     * `.ts`, so the first one written would have been silent — and the
     * environment here is `node`, so it will fail loudly for want of a DOM
     * rather than quietly for want of a match. Loud is the correct answer.
     */
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
