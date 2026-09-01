import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";
import { withWorkflow } from "workflow/next";
import { securityHeaders } from "./src/lib/security/headers";
import { retiredAddressRedirects } from "./src/lib/routing/retired-addresses";

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

  /**
   * `X-Powered-By: Next.js` names the framework and its major version to every
   * caller, which is free reconnaissance and buys nothing (VB-005).
   */
  poweredByHeader: false,

  /**
   * VB-005 / ADR 0059. Vibe served no security headers at all. The set and the
   * reasoning behind each directive live in `src/lib/security/headers.ts`; this
   * only applies them to every route.
   *
   * Built here rather than in `proxy.ts` so they reach every response including
   * the ones the proxy does not match — static assets, and any route excluded
   * from the matcher.
   */
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders() }];
  },

  /**
   * The workspace addresses that used to exist (PERF-023).
   *
   * The table and the reasoning live in `src/lib/routing/retired-addresses.ts`,
   * where a test can reach them: this file cannot be loaded outside a Next
   * build, so a redirect written only here is a redirect nothing asserts.
   */
  async redirects() {
    return retiredAddressRedirects();
  },
};

/**
 * `withWorkflow` compiles every `"use workflow"` / `"use step"` function into
 * the durable routes served under `/.well-known/workflow/` (Sprint 7 §3).
 * Without it those directives are inert and an audit would silently run
 * in-request again.
 */
export default withSentryConfig(withWorkflow(nextConfig), {
  // Build-time metadata only. The auth token remains a server-side Vercel
  // secret and is never bundled into the application.
  authToken: process.env.SENTRY_AUTH_TOKEN,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,

  // Keep production stack traces readable. Without a build token, source-map
  // work is disabled explicitly so local and CI builds remain deterministic.
  widenClientFileUpload: true,
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },

  // The plugin injects this exact release into every runtime and creates the
  // matching Sentry release during an authenticated production build.
  release: {
    name: process.env.SENTRY_RELEASE ?? process.env.VERCEL_GIT_COMMIT_SHA,
  },

  // Do not send build-tool usage telemetry. Application events and traces are
  // governed separately by the runtime DSN and the sampling policy in ADR 0022.
  telemetry: false,
  silent: !process.env.CI,
});
