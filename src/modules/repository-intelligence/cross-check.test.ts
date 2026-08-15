import { describe, expect, it } from "vitest";
import { buildIntelligenceCrossChecks } from "./cross-check";
import type { RepositoryIntelligenceSnapshot } from "./schema";
import type { LiveProductIntelligenceSnapshot } from "@/modules/live-product-intelligence/schema";

/**
 * Code against the live product (Sprint UI-3.6 §11).
 *
 * The comparison itself is trivial. What the tests are really about is the two
 * ways it could produce a false finding: a live check that saw nothing, and a
 * repository whose routes were never readable. Both would manufacture a
 * contradiction out of an absence of evidence.
 */

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
