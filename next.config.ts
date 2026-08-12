import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {
  /**
   * `playwright-core` must not be bundled.
   *
   * It resolves its own files at runtime, so a bundler that inlines it
   * produces a module that throws the moment it is loaded. Marking it external
   * keeps it a real package on disk with its layout intact, and — together
   * with the dynamic `import()` in `playwright/connector.ts` — puts it in its
   * own lazily-loaded chunk instead of the project page's eager one.
   *
   * That pairing is what fixed a production outage: a top-level import
   * compiled to a top-level `await externalImport(...)`, so *rendering the
   * project page* loaded Playwright and 500'd on a missing `browsers.json`,
   * even though no Deep Scan was running.
   *
   * Known gap: `browsers.json` is still not traced into the deployed function,
   * so the analysis step itself will fail on Vercel until that is solved.
   * `outputFileTracingIncludes` was tried and verified to have no effect under
   * Turbopack builds, so it is deliberately not configured here rather than
   * left in as config that looks like a fix. See
   * docs/sprints/0005-authenticated-live-product-intelligence.md.
   */
  serverExternalPackages: ["playwright-core"],
};

/**
 * `withWorkflow` compiles every `"use workflow"` / `"use step"` function into
 * the durable routes served under `/.well-known/workflow/` (Sprint 7 §3).
 * Without it those directives are inert and an audit would silently run
 * in-request again.
 */
export default withWorkflow(nextConfig);
