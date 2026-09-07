import { describe, expect, it } from "vitest";
import { DEFAULT_AUTHENTICATED_BUDGETS } from "./budgets";

/**
 * The page budget, tied to the thing it is for.
 *
 * It was 8 for a reason that stopped being true — "a real browser is expensive
 * in provider seconds", which was Browserbase — and the first real scan on
 * Vibe's own sandbox found **72 candidates and inspected 8**, reaching depth 1
 * of an allowed 2. It ran out of pages before it ran out of product.
 *
 * The number is asserted against the surface list rather than against itself,
 * because that is what makes it wrong when the job grows: adding an eleventh
 * surface without room to find it fails here.
 */
describe("the page budget is sized against what the analysis is looking for", () => {
  /** Every surface `AuthenticatedSurfaceId` names. */
  const SURFACES = [
    "app_shell",
    "dashboard",
    "onboarding",
    "project_workspace",
    "settings",
    "billing",
    "analytics",
    "empty_state",
    "data_table",
    "integrations",
  ] as const;

  it("can visit more pages than there are surfaces to find", () => {
    // Eight pages could not describe ten surfaces even in the best case: one
    // page each, none of them the landing page, no surface needing two.
    expect(DEFAULT_AUTHENTICATED_BUDGETS.maxPages).toBeGreaterThan(SURFACES.length);
  });

  it("allows about two pages per surface, because a list and a detail is one surface", () => {
    expect(DEFAULT_AUTHENTICATED_BUDGETS.maxPages).toBeGreaterThanOrEqual(SURFACES.length * 2);
  });

  it("considers more candidates than one real product offered", () => {
    // 50 truncated a list of 72 before prioritisation, so it did not shorten
    // the crawl — it changed which pages were eligible to be chosen.
    expect(DEFAULT_AUTHENTICATED_BUDGETS.maxCandidates).toBeGreaterThan(72);
  });

  it("gives every page it may visit room to be a slow one", () => {
    // A page can take the whole navigation ceiling. A duration budget under
    // that product is one that ends scans by clock rather than by decision.
    const pages = DEFAULT_AUTHENTICATED_BUDGETS.maxPages;
    const measuredSecondsPerPage = 2;

    expect(DEFAULT_AUTHENTICATED_BUDGETS.maxDurationMs).toBeGreaterThan(
      pages * measuredSecondsPerPage * 1000,
    );
  });

  it("stays under the ceiling the route function allows", () => {
    // `product/deep-scan/page.tsx` exports maxDuration = 240. The budget must
    // stay below it, so a scan ends because Vibe decided it had seen enough
    // rather than because the platform killed the function mid-analysis.
    const ROUTE_MAX_DURATION_SECONDS = 240;

    expect(DEFAULT_AUTHENTICATED_BUDGETS.maxDurationMs).toBeLessThan(
      ROUTE_MAX_DURATION_SECONDS * 1000,
    );
  });
});
