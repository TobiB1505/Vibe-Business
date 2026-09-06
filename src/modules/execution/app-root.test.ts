import { describe, expect, it } from "vitest";
import type {
  RepositoryIntelligenceSnapshot,
  RouteIntelligence,
} from "@/modules/repository-intelligence/schema";
import { resolveAppRoot } from "./app-root";
import { fakeRepositorySnapshotFor } from "./test-support";

/**
 * Where a generator is allowed to write.
 *
 * This function had no test of its own while deciding which directory a
 * `robots.ts` lands in — the requirement its own docblock states is "do not
 * write to the wrong package", and a wrong answer here is a file that looks
 * correct in review and does nothing in production.
 */

function withRoutes(routes: RouteIntelligence): RepositoryIntelligenceSnapshot {
  return { ...fakeRepositorySnapshotFor(), routes };
}

describe("resolveAppRoot", () => {
  it("returns the directory the analyzer read the routes from", () => {
    expect(
      resolveAppRoot(
        withRoutes({ mode: "app_router", routes: [], truncated: false, root: "frontend/src/app/" }),
      ),
    ).toBe("frontend/src/app/");
  });

  it("refuses a router it cannot name", () => {
    // `app_router` with no root is not a shape the analyzer emits, and treating
    // it as "somewhere at the repository root" is exactly the assumption this
    // change removed.
    expect(
      resolveAppRoot(withRoutes({ mode: "app_router", routes: [], truncated: false })),
    ).toBeNull();
  });

  it.each(["pages_router", "limited", "none"] as const)("refuses %s", (mode) => {
    expect(
      resolveAppRoot(withRoutes({ mode, routes: [], truncated: false, root: "src/app/" })),
    ).toBeNull();
  });

  /**
   * Snapshots written before `repo-intelligence-v6` carry no recorded root, and
   * are read the way they were written.
   *
   * This is not a compromise. That analyzer only ever looked at `src/app/` and
   * `app/`, so deriving a root-relative answer from its route paths is the
   * correct reading of the data it produced — and any other answer would be an
   * assertion about files it never looked at.
   */
  describe("a snapshot from before the root was recorded", () => {
    const legacy = (sourcePaths: string[]) =>
      withRoutes({
        mode: "app_router",
        truncated: false,
        routes: sourcePaths.map((sourcePath) => ({
          path: "/",
          kind: "page" as const,
          dynamic: false,
          sourcePath,
        })),
      });

    it("derives the root from its route paths", () => {
      expect(resolveAppRoot(legacy(["src/app/page.tsx", "src/app/login/page.tsx"]))).toBe(
        "src/app/",
      );
      expect(resolveAppRoot(legacy(["app/page.tsx"]))).toBe("app/");
    });

    it("blocks on two roots rather than picking one", () => {
      expect(resolveAppRoot(legacy(["src/app/page.tsx", "app/page.tsx"]))).toBeNull();
    });

    it("has no answer for a path that analyzer could never have produced", () => {
      // A v5 snapshot cannot contain `frontend/src/app/…`, because that
      // analyzer did not look there. Returning null is the honest answer; the
      // repository needs re-analysing, which is what the version bump forces.
      expect(resolveAppRoot(legacy(["frontend/src/app/page.tsx"]))).toBeNull();
    });
  });
});
