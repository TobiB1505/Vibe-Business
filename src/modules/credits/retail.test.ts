import { describe, expect, it } from "vitest";
import { CREDIT_RATE_CARDS } from "./rating";
import {
  ExecutionClassRequiredError,
  RETAIL_OPERATION_KINDS,
  RETAIL_PRICE_POLICIES,
  resolveRetailPolicy,
  resolveRetailPrice,
  retailChargeFor,
  retailPricesByClass,
  type RetailPricePolicy,
} from "./retail";
import { creditsToUnits } from "./units";

/**
 * The approved customer prices, pinned (BILLING CORE-2 §36, §38, §86).
 *
 * These assertions exist so a price cannot drift by accident. Changing one is a
 * commercial decision, and a commercial decision should fail a test until
 * somebody deliberately updates it.
 *
 * Two eras are asserted, not one. `retail-v1` is closed but not gone — nine
 * settled charges name it — and a test that only checked the current policy
 * would let history be rewritten without noticing.
 */

/** Inside `retail-v1`. */
const DURING_V1 = new Date("2026-08-20T00:00:00.000Z");
/** Inside `launch-v1`, and the instant it takes effect. */
const DURING_LAUNCH = new Date("2026-09-01T00:00:00.000Z");

describe("approved launch-v1 retail prices", () => {
  it("charges 35 Credits for a Business Audit", () => {
    expect(retailChargeFor("business_audit", DURING_LAUNCH)).toEqual({
      kind: "charge",
      creditUnits: creditsToUnits(35),
      policyVersion: "launch-v1",
    });
  });

  it("charges 20 Credits for Opportunity Generation", () => {
    expect(retailChargeFor("opportunity_generation", DURING_LAUNCH)).toEqual({
      kind: "charge",
      creditUnits: creditsToUnits(20),
      policyVersion: "launch-v1",
    });
  });

  it("charges 20 Credits for an Action Plan — the one price that did not return to retail-v1", () => {
    // retail-v1's 15 came from a single observation of $0.044. Five deliveries
    // now say $0.056, which at 15 Credits is a 74.5% margin — above the guard
    // floor, below the target the card is derived against.
    expect(retailChargeFor("action_plan", DURING_LAUNCH)).toEqual({
      kind: "charge",
      creditUnits: creditsToUnits(20),
      policyVersion: "launch-v1",
    });
  });

  it("charges 25 Credits for an additional Deep Scan", () => {
    expect(retailChargeFor("deep_scan", DURING_LAUNCH)).toEqual({
      kind: "charge",
      creditUnits: creditsToUnits(25),
      policyVersion: "launch-v1",
    });
  });

  it("charges 150 / 200 / 350 Credits for an agent improvement, by class", () => {
    expect(retailPricesByClass("agent_execution", DURING_LAUNCH)).toEqual({
      small: creditsToUnits(150),
      standard: creditsToUnits(200),
      complex: creditsToUnits(350),
    });
  });

  it("keeps Product Understanding free rather than pricing it at zero (§56)", () => {
    // `free` is what forces the free path to be handled explicitly. A price of
    // 0 would flow through reservation and settlement and post a 0-Credit
    // charge on every product-understanding run.
    expect(retailChargeFor("product_understanding", DURING_LAUNCH)).toEqual({ kind: "free" });
    expect(resolveRetailPrice("product_understanding", DURING_LAUNCH)?.price).toEqual({
      kind: "free",
    });
  });

  it("prices every declared operation, so none can be silently unpriced", () => {
    for (const operation of RETAIL_OPERATION_KINDS) {
      expect(resolveRetailPrice(operation, DURING_LAUNCH)).not.toBeNull();
    }
  });
});

describe("a class-priced operation refuses to guess its tier", () => {
  it("throws rather than defaulting when no class is supplied", () => {
    // Not a fallback. Defaulting to `small` would sell every agent improvement
    // at the cheapest price Vibe has while every screen and ledger entry looked
    // correct; defaulting to `complex` would overcharge just as silently.
    expect(() => retailChargeFor("agent_execution", DURING_LAUNCH)).toThrow(
      ExecutionClassRequiredError,
    );
  });

  it("charges the supplied tier and no other", () => {
    expect(
      retailChargeFor("agent_execution", DURING_LAUNCH, { pricingClass: "complex" }),
    ).toEqual({
      kind: "charge",
      creditUnits: creditsToUnits(350),
      policyVersion: "launch-v1",
    });
  });

  it("ignores a class supplied for a fixed-price operation", () => {
    expect(retailChargeFor("business_audit", DURING_LAUNCH, { pricingClass: "complex" })).toEqual({
      kind: "charge",
      creditUnits: creditsToUnits(35),
      policyVersion: "launch-v1",
    });
  });

  it("has no class prices to show for an operation priced flat", () => {
    expect(retailPricesByClass("business_audit", DURING_LAUNCH)).toBeNull();
  });
});

describe("not_priced is a refusal, never a giveaway", () => {
  it("refuses an agent run under retail-v1, which never sold one", () => {
    // The distinction the whole three-outcome shape exists for: collapsing this
    // into the free path would have run the most expensive operation Vibe has
    // for nothing, under a policy that never priced it.
    expect(retailChargeFor("agent_execution", DURING_V1, { pricingClass: "standard" })).toEqual({
      kind: "not_priced",
      policyVersion: "retail-v1",
    });
  });

  it("refuses a Deep Scan under retail-v1", () => {
    expect(retailChargeFor("deep_scan", DURING_V1)).toEqual({
      kind: "not_priced",
      policyVersion: "retail-v1",
    });
  });

  it("refuses everything when no policy is in force, rather than running it free", () => {
    const before = new Date("2026-01-01T00:00:00.000Z");
    expect(retailChargeFor("business_audit", before).kind).toBe("not_priced");
    expect(resolveRetailPrice("business_audit", before)).toBeNull();
  });
});

describe("policy resolution", () => {
  it("resolves the current policy", () => {
    expect(resolveRetailPolicy(DURING_LAUNCH)?.version).toBe("launch-v1");
  });

  it("has no policy before the first one takes effect", () => {
    expect(resolveRetailPolicy(new Date("2026-01-01T00:00:00.000Z"))).toBeNull();
  });

  it("treats the effective instant itself as inside the policy", () => {
    // Half-open `[from, to)`, matching resolveRateCard and resolvePricing so
    // the three layers cannot disagree at a boundary instant.
    expect(resolveRetailPolicy(new Date("2026-08-18T00:00:00.000Z"))?.version).toBe("retail-v1");
    expect(resolveRetailPolicy(new Date("2026-09-01T00:00:00.000Z"))?.version).toBe("launch-v1");
  });

  it("hands the boundary instant to the newer policy, not the older", () => {
    const lastInstantOfV1 = new Date("2026-08-31T23:59:59.999Z");
    expect(resolveRetailPolicy(lastInstantOfV1)?.version).toBe("retail-v1");
  });
});

describe("historical immutability (§38)", () => {
  it("still resolves an audit run under retail-v1 at its own policy's price", () => {
    // The property that matters, and it is now a fact about shipped policy
    // rather than a fixture: nine charges name `retail-v1`, and asking what the
    // price was when they happened must return that policy's number and its
    // version — even where `launch-v1` happens to have landed on the same
    // figure, as it does for the audit and for Next Moves.
    expect(retailChargeFor("business_audit", DURING_V1)).toEqual({
      kind: "charge",
      creditUnits: creditsToUnits(35),
      policyVersion: "retail-v1",
    });
    expect(retailChargeFor("opportunity_generation", DURING_V1)).toEqual({
      kind: "charge",
      creditUnits: creditsToUnits(20),
      policyVersion: "retail-v1",
    });
    expect(retailChargeFor("action_plan", DURING_V1)).toEqual({
      kind: "charge",
      creditUnits: creditsToUnits(15),
      policyVersion: "retail-v1",
    });
  });

  it("never deletes a superseded policy", () => {
    expect(RETAIL_PRICE_POLICIES.map((policy) => policy.version)).toEqual([
      "retail-v1",
      "launch-v1",
    ]);
  });

  it("charges a new price for new work after a repricing", () => {
    /** A hypothetical future repricing, used to prove the mechanism still holds. */
    const V2: RetailPricePolicy = {
      version: "retail-v2",
      effectiveFrom: "2026-12-01T00:00:00.000Z",
      effectiveTo: null,
      prices: {
        business_audit: { price: { kind: "fixed", creditUnits: creditsToUnits(70) }, basis: "measured" },
        opportunity_generation: { price: { kind: "fixed", creditUnits: creditsToUnits(40) }, basis: "measured" },
        action_plan: { price: { kind: "fixed", creditUnits: creditsToUnits(40) }, basis: "measured" },
        product_understanding: { price: { kind: "free" }, basis: "measured" },
        deep_scan: { price: { kind: "fixed", creditUnits: creditsToUnits(30) }, basis: "policy" },
        agent_execution: { price: { kind: "not_priced" }, basis: "measured" },
      },
    };

    const closedLaunch: RetailPricePolicy = {
      ...RETAIL_PRICE_POLICIES[1]!,
      effectiveTo: "2026-12-01T00:00:00.000Z",
    };
    const policies = [RETAIL_PRICE_POLICIES[0]!, closedLaunch, V2];

    expect(
      retailChargeFor("business_audit", new Date("2026-12-02T00:00:00.000Z"), { policies }),
    ).toEqual({ kind: "charge", creditUnits: creditsToUnits(70), policyVersion: "retail-v2" });

    expect(retailChargeFor("business_audit", DURING_LAUNCH, { policies })).toEqual({
      kind: "charge",
      creditUnits: creditsToUnits(35),
      policyVersion: "launch-v1",
    });
  });
});

describe("the two price layers stay separate (§37)", () => {
  it("leaves Core-1's provider-usage rate card empty", () => {
    // Activating operation prices deliberately did not fill `CREDIT_RATE_CARDS`.
    // That structure rates provider SKUs — credits per token, per millisecond,
    // per byte — and forcing an operation price into it would mean inventing a
    // fake SKU with a quantity of 1, making `rateUsage` return customer prices
    // for usage that never occurred.
    expect(CREDIT_RATE_CARDS).toEqual([]);
  });

  it("prices operations, never provider SKUs", () => {
    for (const policy of RETAIL_PRICE_POLICIES) {
      expect(Object.keys(policy.prices).sort()).toEqual([...RETAIL_OPERATION_KINDS].sort());
    }
  });

  it("carries a policy version on every priced operation, so a charge can name it", () => {
    for (const operation of RETAIL_OPERATION_KINDS) {
      expect(resolveRetailPrice(operation, DURING_LAUNCH)?.policyVersion).toBe("launch-v1");
    }
  });
});

describe("every price says how it came to be a number", () => {
  it("marks Deep Scan as a policy judgment, because no browser rate is measured", () => {
    // No browser-provider rate exists anywhere in this repository, and every
    // `deep_scan_provider_usage.provider_cost_usd` is null. The type carries
    // that rather than a docblock.
    expect(resolveRetailPrice("deep_scan", DURING_LAUNCH)?.basis).toBe("policy");
  });

  it("marks the Agent as modelled, because two of its three tiers are", () => {
    expect(resolveRetailPrice("agent_execution", DURING_LAUNCH)?.basis).toBe("modelled");
  });

  it("marks every other price as measured", () => {
    for (const operation of ["business_audit", "opportunity_generation", "action_plan"] as const) {
      expect(resolveRetailPrice(operation, DURING_LAUNCH)?.basis).toBe("measured");
    }
  });
});
