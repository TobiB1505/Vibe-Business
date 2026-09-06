import { describe, expect, it } from "vitest";
import { buildIntelligenceCrossChecks, crossCheckIntelligence } from "./cross-check";
import type { RepositoryIntelligenceSnapshot } from "./schema";
import type { LiveProductIntelligenceSnapshot } from "@/modules/live-product-intelligence/schema";
import type { AuthenticatedProductIntelligenceSnapshot } from "@/modules/authenticated-product-intelligence/schema";

/**
 * Code against the live product, and the live product against the signed-in one
 * (Sprint UI-3.6 §11).
 *
 * The comparisons themselves are trivial. What the tests are really about is
 * the ways they could produce a false finding out of an absence of evidence: a
 * live check that saw nothing, a repository whose routes were never readable,
 * a Deep Scan that was never run, and a Deep Scan whose sign-in failed. Each
 * would manufacture a contradiction from a layer that simply did not look.
 */

/**
 * A Deep Scan result. `null` means none was ever run, which must stay silent.
 */
function deepScan(detected: string[]) {
  return {
    productSurfaces: ["app_shell", "dashboard", "billing", "settings"].map((id) => ({
      id,
      name: id,
      detected: detected.includes(id),
      confidence: "high",
      evidence: [],
    })),
  } as unknown as AuthenticatedProductIntelligenceSnapshot;
}

function repository(
  detected: string[],
  mode: RepositoryIntelligenceSnapshot["routes"]["mode"] = "app_router",
) {
  return {
    businessSurfaces: ["authentication", "payments", "pricing_page", "checkout_billing"].map(
      (id) => ({
        id,
        name: id,
        detected: detected.includes(id),
        confidence: "high",
        evidence: [],
      }),
    ),
    routes: { mode, routes: [], truncated: false },
  } as unknown as RepositoryIntelligenceSnapshot;
}

function live(detected: string[], observedPrices: number[] = []) {
  return {
    productSurfaces: ["homepage", "pricing", "checkout_billing", "login", "signup"].map((id) => ({
      id,
      name: id,
      detected: detected.includes(id),
      confidence: "high",
      evidence: [],
    })),
    pricing: {
      pricingPageReached: detected.includes("pricing"),
      declaredPricePoints: [],
      declaredCurrencies: [],
      hasFreeDeclaredTier: false,
      observedPricePoints: observedPrices.map((amount) => ({
        path: "/",
        amount,
        period: null,
        currencyToken: "€",
      })),
    },
  } as unknown as LiveProductIntelligenceSnapshot;
}

describe("a disagreement becomes a business finding", () => {
  it("says pricing exists but visitors cannot find it", () => {
    const checks = buildIntelligenceCrossChecks(
      repository(["pricing_page"]),
      live(["homepage", "login"]),
    );
    const pricing = checks.find((check) => check.id === "pricing-not-reachable");

    expect(pricing?.title).toContain("visitors may not be able to find it");
    // Never "repository signal: true / runtime signal: false".
    expect(pricing?.title).not.toContain("signal");
    expect(pricing?.nextStep?.target).toBe("live-product");
  });

  it("says payment code exists with no reachable way to buy", () => {
    const checks = buildIntelligenceCrossChecks(repository(["payments"]), live(["homepage"]));

    expect(checks.map((check) => check.id)).toContain("payments-not-reachable");
  });

  it("reports a live page that is not in this repository", () => {
    const checks = buildIntelligenceCrossChecks(repository([]), live(["homepage", "pricing"]));
    const outside = checks.find((check) => check.id === "pricing-outside-repository");

    expect(outside?.detail).toContain("different project");
    // Not a defect to fix — a fact about where the product is built.
    expect(outside?.nextStep).toBeNull();
  });

  it("stays silent when both layers agree", () => {
    const checks = buildIntelligenceCrossChecks(
      repository(["pricing_page", "payments", "authentication"]),
      live(["homepage", "pricing", "login"]),
    );

    expect(checks).toEqual([]);
  });
});

/**
 * The distinction the empty array cannot carry.
 *
 * Every assertion above reads `[]` as "nothing to report", and for the checks
 * themselves that is right. On screen it is not: "your code and your live
 * product agree" and "nothing has been compared" are opposite sentences, and
 * only one of them may be said out loud. `crossCheckIntelligence` is where the
 * guards stop being invisible.
 */
describe("saying nothing and finding nothing are different answers", () => {
  it("reports a real comparison that found no disagreement", () => {
    const result = crossCheckIntelligence(
      repository(["pricing_page", "payments", "authentication"]),
      live(["homepage", "pricing", "login"]),
    );

    expect(result.compared).toBe(true);
    expect(result.checks).toEqual([]);
  });

  it("reports that no comparison happened when there is no live scan", () => {
    const result = crossCheckIntelligence(repository(["pricing_page"]), null);

    expect(result).toEqual({ compared: false, reason: "no_live_scan", checks: [] });
  });

  it("reports that no comparison happened when the live scan reached nothing", () => {
    const result = crossCheckIntelligence(repository(["pricing_page", "payments"]), live([]));

    expect(result).toEqual({
      compared: false,
      reason: "live_scan_detected_nothing",
      checks: [],
    });
  });

  it("keeps the checks-only caller returning exactly what it returned before", () => {
    const args = [
      repository(["pricing_page", "payments"]),
      live(["homepage", "login"]),
    ] as const;

    expect(buildIntelligenceCrossChecks(...args)).toEqual(
      crossCheckIntelligence(...args).checks,
    );
  });
});

describe("it never contradicts an absence of evidence", () => {
  it("says nothing when there is no live check at all", () => {
    expect(buildIntelligenceCrossChecks(repository(["pricing_page"]), null)).toEqual([]);
  });

  it("says nothing when the live check identified no pages", () => {
    // A site behind a bot wall reports every surface undetected. Comparing
    // against it would contradict every capability the repository has.
    expect(
      buildIntelligenceCrossChecks(repository(["pricing_page", "payments"]), live([])),
    ).toEqual([]);
  });

  it("does not compare pages when repository routes were never readable", () => {
    const checks = buildIntelligenceCrossChecks(
      repository(["payments"], "limited"),
      live(["homepage", "pricing"]),
    );

    expect(checks.map((check) => check.id)).not.toContain("pricing-outside-repository");
  });
});

describe("it is deterministic", () => {
  it("produces identical output for identical input", () => {
    const a = buildIntelligenceCrossChecks(repository(["payments"]), live(["homepage"]));
    const b = buildIntelligenceCrossChecks(repository(["payments"]), live(["homepage"]));

    expect(a).toEqual(b);
  });
});

/**
 * The public site against the signed-in product.
 *
 * Both layers are runtime, so neither of these findings is reachable from code
 * however carefully the repository is read — which is the reason they exist.
 */
describe("the public site against the signed-in product", () => {
  it("names a product that can be paid for but never offers it", () => {
    const checks = buildIntelligenceCrossChecks(
      repository([]),
      live(["homepage"]),
      deepScan(["app_shell", "billing"]),
    );

    expect(checks.map((check) => check.id)).toContain("billing-not-offered-publicly");
  });

  it("names pricing the signed-in product cannot act on", () => {
    const checks = buildIntelligenceCrossChecks(
      repository(["pricing_page"]),
      live(["homepage", "pricing"]),
      deepScan(["app_shell", "dashboard"]),
    );

    expect(checks.map((check) => check.id)).toContain("pricing-without-billing");
  });

  it("says nothing about billing when both halves agree", () => {
    const checks = buildIntelligenceCrossChecks(
      repository(["pricing_page"]),
      live(["homepage", "pricing"]),
      deepScan(["app_shell", "billing"]),
    );

    expect(checks.map((check) => check.id)).not.toContain("billing-not-offered-publicly");
    expect(checks.map((check) => check.id)).not.toContain("pricing-without-billing");
  });
});

/**
 * The guards, which are the point.
 *
 * A Deep Scan is optional and can fail. Either way the honest output is
 * silence: "Vibe did not look" and "Vibe looked and found nothing" are
 * opposite facts, and only the second can contradict anything.
 */
describe("a layer that did not look contradicts nothing", () => {
  it("stays silent when no Deep Scan was ever run", () => {
    const withScan = buildIntelligenceCrossChecks(
      repository([]),
      live(["homepage"]),
      deepScan(["billing"]),
    );
    const withoutScan = buildIntelligenceCrossChecks(repository([]), live(["homepage"]), null);

    // Guards the guard: the fixture must actually produce a finding, or the
    // assertion below passes for the wrong reason.
    expect(withScan.map((check) => check.id)).toContain("billing-not-offered-publicly");
    expect(withoutScan.map((check) => check.id)).not.toContain("billing-not-offered-publicly");
  });

  it("stays silent when the Deep Scan reached nothing at all", () => {
    // A failed sign-in reports every surface undetected. Reading that as "this
    // product has no billing" would turn one broken credential into a finding
    // about the founder's business.
    const checks = buildIntelligenceCrossChecks(
      repository(["pricing_page"]),
      live(["homepage", "pricing"]),
      deepScan([]),
    );

    expect(checks.map((check) => check.id)).not.toContain("pricing-without-billing");
  });

  it("keeps the existing comparisons working with no Deep Scan argument", () => {
    // The parameter is optional, so every existing caller and every existing
    // finding is unchanged by its addition.
    const checks = buildIntelligenceCrossChecks(repository(["pricing_page"]), live(["homepage"]));
    expect(checks.map((check) => check.id)).toContain("pricing-not-reachable");
  });
});

/**
 * The incident this guard was written for.
 *
 * A contradiction says one of two inputs is wrong; it does not say which. These
 * checks read "code has pricing, live does not" as a fact about the business
 * and mint it at the highest evidence priority — so a detector that missed a
 * pricing surface becomes the most heavily weighted finding in the audit.
 *
 * That happened to Vibe Business's own audit. An anchor-section pricing page
 * went unclassified, `payments-not-reachable` fired, and the founder was told
 * twice that nothing on their site leads to paying, on a page that was at that
 * moment displaying €0, €19 and €49. The prices were in the same snapshot the
 * whole time.
 */
describe("a reading Vibe disproved itself is not a finding", () => {
  it("does not accuse the business when it read prices off the live product", () => {
    const checks = buildIntelligenceCrossChecks(
      repository(["payments", "pricing_page"]),
      live(["homepage"], [0, 19, 49]),
    );

    expect(checks.map((check) => check.id)).not.toContain("payments-not-reachable");
    expect(checks.map((check) => check.id)).not.toContain("pricing-not-reachable");
  });

  /** The guard must not silence the real finding it was built to report. */
  it("still reports it when no price was read anywhere", () => {
    const checks = buildIntelligenceCrossChecks(
      repository(["payments", "pricing_page"]),
      live(["homepage"], []),
    );

    expect(checks.map((check) => check.id)).toContain("payments-not-reachable");
    expect(checks.map((check) => check.id)).toContain("pricing-not-reachable");
  });

  /** One observed price is enough to make "no pricing anywhere" not credible. */
  it("is disproved by a single price", () => {
    const checks = buildIntelligenceCrossChecks(repository(["payments"]), live(["homepage"], [19]));

    expect(checks.map((check) => check.id)).not.toContain("payments-not-reachable");
  });

  /** A detected pricing surface was never the contradiction's trigger anyway. */
  it("says nothing when the pricing surface was classified normally", () => {
    const checks = buildIntelligenceCrossChecks(
      repository(["payments", "pricing_page"]),
      live(["homepage", "pricing"], [19]),
    );

    expect(checks.map((check) => check.id)).not.toContain("payments-not-reachable");
  });
});
