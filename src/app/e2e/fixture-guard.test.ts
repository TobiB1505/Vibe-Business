import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The browser-fixture route cannot exist in production (VB-043).
 *
 * ## Why a source assertion and not a call
 *
 * Because the route's guard runs before anything this suite can render — it is
 * a server component that calls `notFound()`, and the case worth proving is
 * the one where the module is deployed at all. What can be checked here is the
 * shape of the guard, and specifically that it does not rest on a single
 * environment variable.
 *
 * ## Why two reasons for the same 404
 *
 * `VIBE_E2E_FIXTURES` is set by the Playwright web server and by nothing else.
 * That is true, and it is an argument about a dashboard nobody has typed the
 * wrong thing into yet. `VERCEL_ENV` is set by the platform and a production
 * deployment cannot unset it — so the two fail independently, and the route is
 * a 404 in production even if the flag is somehow present.
 */

const SOURCE = readFileSync(
  join(process.cwd(), "src/app/e2e/[scenario]/page.tsx"),
  "utf8",
);

describe("the fixture route's guard", () => {
  it("refuses production regardless of the flag", () => {
    expect(SOURCE).toContain('process.env.VERCEL_ENV === "production"');
  });

  it("still requires the flag everywhere else", () => {
    expect(SOURCE).toContain('process.env.VIBE_E2E_FIXTURES === "1"');
  });

  it("checks the platform's answer before the repository's", () => {
    // The order is the point: the check that does not depend on anyone
    // remembering anything runs first, so a future edit to the flag logic
    // cannot accidentally open production.
    const platform = SOURCE.indexOf('VERCEL_ENV === "production"');
    const flag = SOURCE.indexOf('VIBE_E2E_FIXTURES === "1"', platform);

    expect(platform).toBeGreaterThan(-1);
    expect(flag).toBeGreaterThan(platform);
  });

  it("refuses before it reads the scenario name", () => {
    // An unset flag must produce the same 404 for a valid name and a probe;
    // reading the name first would make the two distinguishable by timing.
    const guard = SOURCE.indexOf("if (!fixturesEnabled()) notFound();");
    const read = SOURCE.indexOf("const { scenario } = await params;");

    expect(guard).toBeGreaterThan(-1);
    expect(read).toBeGreaterThan(guard);
  });
});
