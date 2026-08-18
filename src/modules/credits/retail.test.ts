import { describe, expect, it } from "vitest";
import { CREDIT_RATE_CARDS } from "./rating";
import {
  RETAIL_OPERATION_KINDS,
  RETAIL_PRICE_POLICIES,
  resolveRetailPolicy,
  resolveRetailPrice,
  retailChargeFor,
  type RetailPricePolicy,
} from "./retail";
import { creditsToUnits } from "./units";

/**
 * The approved V1 customer prices, pinned (BILLING CORE-2 §36, §38, §86).
 *
 * These assertions exist so a price cannot drift by accident. Changing one is a
 * commercial decision, and a commercial decision should fail a test until
 * somebody deliberately updates it.
 */

const DURING_V1 = new Date("2026-09-01T00:00:00.000Z");

describe("approved V1 retail prices", () => {
  it("charges 35 Credits for a Business Audit", () => {
    expect(retailChargeFor("business_audit", DURING_V1)).toEqual({
      creditUnits: creditsToUnits(35),
      policyVersion: "retail-v1",
    });
  });

  it("charges 20 Credits for Opportunity Generation", () => {
    expect(retailChargeFor("opportunity_generation", DURING_V1)).toEqual({
      creditUnits: creditsToUnits(20),
      policyVersion: "retail-v1",
    });
  });

  it("charges 15 Credits for an Action Plan", () => {
    expect(retailChargeFor("action_plan", DURING_V1)).toEqual({
      creditUnits: creditsToUnits(15),
      policyVersion: "retail-v1",
    });
  });

  it("keeps Product Understanding free rather than pricing it at zero (§56)", () => {
    // `null` is what forces the free path to be handled explicitly. A price of
    // 0 would flow through reservation and settlement and post a 0-Credit
    // charge on every product-understanding run.
    expect(retailChargeFor("product_understanding", DURING_V1)).toBeNull();
    expect(resolveRetailPrice("product_understanding", DURING_V1)?.price).toEqual({ kind: "free" });
  });

  it("prices every declared operation, so none can be silently unpriced", () => {
    for (const operation of RETAIL_OPERATION_KINDS) {
      expect(resolveRetailPrice(operation, DURING_V1)).not.toBeNull();
    }
  });
});

describe("policy resolution", () => {
  it("resolves the current policy", () => {
    expect(resolveRetailPolicy(DURING_V1)?.version).toBe("retail-v1");
  });

  it("has no policy before the first one takes effect", () => {
    expect(resolveRetailPolicy(new Date("2026-01-01T00:00:00.000Z"))).toBeNull();
  });

  it("treats the effective instant itself as inside the policy", () => {
    // Half-open `[from, to)`, matching resolveRateCard and resolvePricing so
    // the three layers cannot disagree at a boundary instant.
    expect(resolveRetailPolicy(new Date("2026-08-18T00:00:00.000Z"))?.version).toBe("retail-v1");
  });

  it("returns no price at all when no policy is in force, rather than a free one", () => {
    expect(retailChargeFor("business_audit", new Date("2026-01-01T00:00:00.000Z"))).toBeNull();
    expect(resolveRetailPrice("business_audit", new Date("2026-01-01T00:00:00.000Z"))).toBeNull();
  });
});

describe("historical immutability (§38)", () => {
  /** A hypothetical future repricing, used to prove history does not move. */
  const V2: RetailPricePolicy = {
    version: "retail-v2",
    effectiveFrom: "2026-12-01T00:00:00.000Z",
    effectiveTo: null,
    prices: {
      business_audit: { kind: "fixed", creditUnits: creditsToUnits(45) },
      opportunity_generation: { kind: "fixed", creditUnits: creditsToUnits(25) },
      action_plan: { kind: "fixed", creditUnits: creditsToUnits(20) },
      product_understanding: { kind: "free" },
    },
  };

  const V1_CLOSED: RetailPricePolicy = {
    ...RETAIL_PRICE_POLICIES[0],
    effectiveTo: "2026-12-01T00:00:00.000Z",
  };

  const BOTH = [V1_CLOSED, V2];

  it("charges the new price for new work after a repricing", () => {
    expect(retailChargeFor("business_audit", new Date("2026-12-02T00:00:00.000Z"), BOTH)).toEqual({
      creditUnits: creditsToUnits(45),
      policyVersion: "retail-v2",
    });
  });

  it("still resolves an audit run under v1 at 35 Credits, not 45", () => {
    // The property that matters: asking what the price *was* at the instant a
    // charge happened never returns the current policy's number.
    expect(retailChargeFor("business_audit", new Date("2026-09-01T00:00:00.000Z"), BOTH)).toEqual({
      creditUnits: creditsToUnits(35),
      policyVersion: "retail-v1",
    });
  });

  it("keeps a superseded policy resolvable so an old charge stays explainable", () => {
    expect(resolveRetailPolicy(new Date("2026-10-01T00:00:00.000Z"), BOTH)?.version).toBe("retail-v1");
  });
});

describe("the two price layers stay separate (§37)", () => {
  it("leaves Core-1's provider-usage rate card empty", () => {
    // Fixed customer prices deliberately did not go into `CREDIT_RATE_CARDS`.
    // That structure rates provider SKUs — credits per token, per millisecond,
    // per byte — and forcing an operation price into it would mean inventing a
    // fake SKU with a quantity of 1, making `rateUsage` return customer prices
    // for usage that never occurred.
    expect(CREDIT_RATE_CARDS).toEqual([]);
  });

  it("prices operations, never provider SKUs", () => {
    const policy = RETAIL_PRICE_POLICIES[0];
    expect(Object.keys(policy.prices).sort()).toEqual([...RETAIL_OPERATION_KINDS].sort());
  });

  it("carries a policy version on every priced operation, so a charge can name it", () => {
    for (const operation of RETAIL_OPERATION_KINDS) {
      expect(resolveRetailPrice(operation, DURING_V1)?.policyVersion).toBe("retail-v1");
    }
  });
});

describe("no unapproved prices exist (§4, §86, §87)", () => {
  it("prices no Deep Scan and no Agent operation", () => {
    // Neither has an approved price, and both are blocked on cost inputs that
    // do not exist. An operation kind appearing here would be a price invented
    // by implementation rather than decided commercially.
    expect(RETAIL_OPERATION_KINDS).toEqual([
      "business_audit",
      "opportunity_generation",
      "action_plan",
      "product_understanding",
    ]);
  });

  it("ships exactly one approved policy", () => {
    expect(RETAIL_PRICE_POLICIES).toHaveLength(1);
    expect(RETAIL_PRICE_POLICIES[0].version).toBe("retail-v1");
    expect(RETAIL_PRICE_POLICIES[0].effectiveTo).toBeNull();
  });
});
