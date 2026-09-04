import { existsSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every signed-in route paints a first frame (PERF-015).
 *
 * ## Why this is asserted centrally rather than per route
 *
 * A missing `loading.tsx` is invisible in review. The route works, the tests
 * pass, and the only symptom is that a click does nothing for as long as the
 * reads take — which nobody sees locally, where the database is a few
 * milliseconds away. Sprint UI-4 added ten of these files and the audit found
 * four routes that had since been built without one, including both halves of
 * onboarding: the screens a founder meets before they have any reason to
 * believe the product works.
 *
 * Asserting presence, not shape. What a skeleton should look like is a
 * judgement each route makes; that it exists is not.
 */

const APP_DIR = join(process.cwd(), "src/app/app");

/**
 * Routes that deliberately have no `loading.tsx`, with the reason.
 *
 * An exemption is a decision, so it is written down here rather than expressed
 * as the absence of a check. Anything not listed needs a first frame.
 */
const WITHOUT_FIRST_FRAME: readonly { route: string; why: string }[] = [];

function routesWithAPage(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const child = join(dir, entry.name);
    if (existsSync(join(child, "page.tsx"))) found.push(child);
    routesWithAPage(child, found);
  }
  return found;
}

describe("app routes", () => {
  it("gives every customer-facing route a first frame", () => {
    const exempt = new Set(WITHOUT_FIRST_FRAME.map((entry) => entry.route));

    const missing = routesWithAPage(APP_DIR)
      .map((dir) => ({ dir, route: relative(APP_DIR, dir).split("\\").join("/") }))
      .filter((entry) => !exempt.has(entry.route))
      .filter((entry) => !existsSync(join(entry.dir, "loading.tsx")))
      .map((entry) => entry.route);

    expect(
      missing,
      "a route with no loading.tsx answers a click with nothing until its reads finish",
    ).toEqual([]);
  });

  it("keeps the app index's own first frame", () => {
    expect(existsSync(join(APP_DIR, "(account)", "loading.tsx"))).toBe(true);
  });

  it("names a reason for every route that has none", () => {
    for (const entry of WITHOUT_FIRST_FRAME) {
      expect(existsSync(join(APP_DIR, entry.route, "page.tsx")), entry.route).toBe(true);
      expect(entry.why.length, entry.route).toBeGreaterThan(40);
    }
  });
});
