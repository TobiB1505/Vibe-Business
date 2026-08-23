import { describe, expect, it } from "vitest";
import { buildIntelligenceCrossChecks } from "./cross-check";
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
    businessSurfaces: [
      "authentication",
      "payments",
      "pricing_page",
      "checkout_billing",
    ].map((id) => ({
      id,
      name: id,
      detected: detected.includes(id),
      confidence: "high",
      evidence: [],
    })),
    routes: { mode, routes: [], truncated: false },
  } as unknown as RepositoryIntelligenceSnapshot;
}

function live(detected: string[]) {
  return {
    productSurfaces: ["homepage", "pricing", "checkout_billing", "login", "signup"].map((id) => ({
      id,
      name: id,
      detected: detected.includes(id),
      confidence: "high",
      evidence: [],
    })),
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

describe("it never contradicts an absence of evidence", () => {
  it("says nothing when there is no live check at all", () => {
    expect(buildIntelligenceCrossChecks(repository(["pricing_page"]), null)).toEqual([]);
  });

  it("says nothing when the live check identified no pages", () => {
    // A site behind a bot wall reports every surface undetected. Comparing
    // against it would contradict every capability the repository has.
    expect(buildIntelligenceCrossChecks(repository(["pricing_page", "payments"]), live([]))).toEqual(
      [],
    );
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
