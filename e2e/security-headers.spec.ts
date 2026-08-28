import { expect, test } from "@playwright/test";

/**
 * The headers, and the liveness route, on a real HTTP response (Wave 5).
 *
 * ## Why this is not covered by the unit tests that already exist
 *
 * `src/lib/security/headers.test.ts` asserts the header *table* — that the
 * function returns six entries with the right values. `documentation-currency`
 * asserts the route file's shape. Neither of them asks the only question that
 * matters to a browser: **does the server actually send them?**
 *
 * That gap is [CLAUDE.md](../CLAUDE.md) rule 69's named failure mode — the
 * domain state tested, the contract tested, and the thing a client actually
 * receives untested. A `headers()` block that never matched, a route that
 * throws on a real request, a `poweredByHeader` that was not switched off:
 * every one of those passes every test in `pnpm test`.
 *
 * The Playwright `webServer` runs `next start`, which is the production server,
 * so these are real responses from the built application.
 *
 * ## What it still does not prove
 *
 * Anything about the *deployed* site. Vercel's edge adds its own HSTS and may
 * add or strip others, and this session's egress policy refuses
 * `vibebusiness.de:443`, so the deployed response has not been read by anyone
 * here. What this proves is that the application's own configuration produces
 * these headers when it serves a page.
 */

const EXPECTED = {
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), browsing-topics=()",
} as const;

test.describe("security headers on a real response", () => {
  for (const [header, value] of Object.entries(EXPECTED)) {
    test(`sends ${header}`, async ({ request }) => {
      const response = await request.get("/e2e/merge_ready");

      expect(response.headers()[header]).toBe(value);
    });
  }

  /**
   * Report-only by the launch gate's own sequencing: a first policy written
   * from reading the code is a guess, and an enforced guess breaks whatever
   * its author missed (ADR 0059). The assertion is that it is present *and*
   * still report-only — an accidental promotion to enforcing is as much a
   * regression as its absence.
   */
  test("sends the CSP report-only, and not as an enforcing one", async ({ request }) => {
    const headers = (await request.get("/e2e/merge_ready")).headers();

    expect(headers["content-security-policy-report-only"]).toContain("default-src");
    expect(headers["content-security-policy"]).toBeUndefined();
  });

  test("does not announce the framework", async ({ request }) => {
    const headers = (await request.get("/e2e/merge_ready")).headers();

    expect(headers["x-powered-by"]).toBeUndefined();
  });
});

/**
 * VB-034's own "what has not been proved" line, closed locally.
 *
 * Sprint 0105 shipped the liveness route and recorded that it had never been
 * called over HTTP. It has now.
 */
test.describe("the liveness endpoint", () => {
  test("answers 200 with the closed set of fields and nothing else", async ({ request }) => {
    const response = await request.get("/api/health");

    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(Object.keys(body).sort()).toEqual(["commit", "environment", "status"]);
    expect(body.status).toBe("ok");
  });

  test("is not cached, because a cached liveness answer is about the past", async ({ request }) => {
    const response = await request.get("/api/health");

    expect(response.headers()["cache-control"]).toContain("no-store");
  });

  /**
   * It is reachable without a session — the whole point — and reaching it does
   * not redirect to login the way every `/app` route does.
   */
  test("does not redirect a caller who has no session", async ({ request }) => {
    const response = await request.get("/api/health", { maxRedirects: 0 });

    expect(response.status()).toBe(200);
  });

  test("answers a HEAD without a body", async ({ request }) => {
    const response = await request.head("/api/health");

    expect(response.status()).toBe(200);
  });
});
