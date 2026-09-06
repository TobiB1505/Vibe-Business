import { describe, expect, it } from "vitest";
import type { StepChangeKind } from "@/modules/action-plans/schema";
import { resolveChainPricingClass, resolveStepPricingClass } from "./pricing-class";
import type { ExecutionRiskClass } from "./schema";

/**
 * What a chain costs (`build-chain-v1`).
 *
 * Two properties carry this file. Declining a chain must price *exactly* as it
 * does today, or the offer changes what a founder pays for work they already
 * understood. And a chain must never be sold under a single step's blast
 * radius, because that ceiling is what the run would then die at.
 */

type Step = { changeKind: StepChangeKind; evidenceIds: string[] };

function step(evidenceIds: string[], changeKind: StepChangeKind = "product_change"): Step {
  return { changeKind, evidenceIds };
}

/** Every shape the single-step classifier can be pushed through. */
const MATRIX: { name: string; step: Step; risk: ExecutionRiskClass }[] = [
  { name: "public pages only", step: step(["live.conversion.primary_cta_missing"]), risk: "low" },
  { name: "no evidence at all", step: step([]), risk: "low" },
  { name: "one named surface", step: step(["live.surface_absent.pricing"]), risk: "low" },
  {
    name: "two named surfaces",
    step: step(["live.surface_absent.pricing", "live.surface_absent.dashboard_app"]),
    risk: "moderate",
  },
  { name: "sensitive evidence", step: step(["repo.surface_absent.payments"]), risk: "moderate" },
  { name: "high risk", step: step(["live.conversion.primary_cta_missing"]), risk: "high" },
  {
    name: "not a product change",
    step: step(["live.conversion.primary_cta_missing"], "analysis"),
    risk: "low",
  },
];

describe("a chain of one prices exactly as the step does", () => {
  it.each(MATRIX)("$name", ({ step: only, risk }) => {
    // The founder who declines the chain is buying what they were always
    // buying. If this ever diverges, the decline is a different product.
    expect(resolveChainPricingClass({ members: [only], riskClasses: [risk] })).toEqual(
      resolveStepPricingClass({ step: only, riskClass: risk }),
    );
  });
});

describe("a chain of more than one", () => {
  it("is never small, whatever its members would each have been", () => {
    // Both of these classify `small` alone — the narrowest real case there is.
    const members = [
      step(["live.conversion.primary_cta_missing"]),
      step(["live.conversion.secondary_cta_missing"]),
    ];

    expect(resolveStepPricingClass({ step: members[0], riskClass: "low" }).pricingClass).toBe(
      "small",
    );

    const chain = resolveChainPricingClass({ members, riskClasses: ["low", "low"] });
    expect(chain.pricingClass).toBe("complex");
    expect(chain.reason).toBe("chained_delivery");
  });

  it("is never standard either, because standard's ceiling is small's ceiling", () => {
    const members = [step(["live.surface_absent.pricing"]), step(["live.surface_absent.pricing"])];

    expect(resolveStepPricingClass({ step: members[0], riskClass: "low" }).pricingClass).toBe(
      "standard",
    );
    expect(resolveChainPricingClass({ members, riskClasses: ["low", "low"] }).pricingClass).toBe(
      "complex",
    );
  });

  it("takes the highest risk among its members, not the head's", () => {
    // The head is `low`; a member is `moderate`. Reading the head's would be
    // the escalate-first order the classifier exists to preserve, undone.
    const chain = resolveChainPricingClass({
      members: [
        step(["live.conversion.primary_cta_missing"]),
        step(["live.surface_absent.dashboard_app"]),
      ],
      riskClasses: ["low", "moderate"],
    });

    expect(chain.pricingClass).toBe("complex");
  });

  it("unions the evidence rather than reading only the head's", () => {
    // Deduplicated across members, and the same answer whatever order they
    // arrive in — the classifier is order-independent and this must not undo it.
    const a = step(["live.surface_absent.pricing"]);
    const b = step(["live.surface_absent.pricing", "live.surface_absent.dashboard_app"]);

    expect(resolveChainPricingClass({ members: [a, b], riskClasses: ["low", "low"] })).toEqual(
      resolveChainPricingClass({ members: [b, a], riskClasses: ["low", "low"] }),
    );
  });

  it("still has no class at all when the union is not mutating", () => {
    // Escalating this would price work that never executes. The chain resolver
    // admits only product changes, so this is unreachable in production and is
    // asserted anyway — a guard that fails open on an impossible input is how
    // an impossible input becomes a charge.
    const members = [
      step(["live.conversion.primary_cta_missing"], "analysis"),
      step([], "analysis"),
    ];

    const chain = resolveChainPricingClass({ members, riskClasses: ["low", "low"] });
    expect(chain.pricingClass).toBeNull();
    expect(chain.reason).toBe("not_mutating");
  });

  it("refuses members that do not share one change kind", () => {
    expect(() =>
      resolveChainPricingClass({
        members: [step(["live.conversion.primary_cta_missing"]), step([], "analysis")],
        riskClasses: ["low", "low"],
      }),
    ).toThrow(/one change kind/);
  });
});
