import { describe, expect, it } from "vitest";
import {
  CREDIT_PACK_KEYS,
  PAID_PLAN_KEYS,
  PLAN_KEYS,
  WELCOME_CREDIT_UNITS,
  WELCOME_CREDIT_VALIDITY_DAYS,
  getCreditPack,
  getPlan,
  listCreditPacks,
  parseCreditPackKey,
  parsePaidPlanKey,
  subscriptionGrantIdempotencyKey,
  topUpGrantIdempotencyKey,
  welcomeGrantIdempotencyKey,
} from "./catalog";
import { creditsToUnits } from "@/modules/credits/units";

/**
 * The approved V1 catalog, pinned (BILLING CORE-2 §69).
 *
 * Two separate things are proven here. First, that the numbers are the
 * founder-approved ones — a price or a Credit amount must not drift by
 * accident. Second, and more importantly, that a browser cannot influence any
 * of them: the parsing functions are the only way an untrusted string enters
 * this module, and they narrow to a key or return null.
 */

describe("subscription plans (§8)", () => {
  it("offers exactly Free, Builder and Pro", () => {
    expect(PLAN_KEYS).toEqual(["free", "builder", "pro"]);
    expect(PAID_PLAN_KEYS).toEqual(["builder", "pro"]);
  });

  it("prices Builder at €19 for 1,000 monthly Credits", () => {
    const builder = getPlan("builder");
    expect(builder.priceCents).toBe(1_900);
    expect(builder.currency).toBe("eur");
    expect(builder.monthlyCreditUnits).toBe(creditsToUnits(1_000));
  });

  it("prices Pro at €49 for 3,000 monthly Credits", () => {
    const pro = getPlan("pro");
    expect(pro.priceCents).toBe(4_900);
    expect(pro.currency).toBe("eur");
    expect(pro.monthlyCreditUnits).toBe(creditsToUnits(3_000));
  });

  it("gives Free no recurring monthly Credit grant", () => {
    const free = getPlan("free");
    expect(free.priceCents).toBe(0);
    expect(free.monthlyCreditUnits).toBe(creditsToUnits(0));
    expect(free.stripePriceEnvVar).toBeNull();
  });

  it("adds no Enterprise, Team, annual or seat-priced plan", () => {
    expect(PLAN_KEYS).toHaveLength(3);
  });
});

describe("top-up packs (§9)", () => {
  it("sells 500 Credits for €12", () => {
    const pack = getCreditPack("pack_500");
    expect(pack.credits).toBe(500);
    expect(pack.creditUnits).toBe(creditsToUnits(500));
    expect(pack.priceCents).toBe(1_200);
    expect(pack.currency).toBe("eur");
  });

  it("sells 1,500 Credits for €33", () => {
    const pack = getCreditPack("pack_1500");
    expect(pack.credits).toBe(1_500);
    expect(pack.creditUnits).toBe(creditsToUnits(1_500));
    expect(pack.priceCents).toBe(3_300);
  });

  it("sells 5,000 Credits for €99", () => {
    const pack = getCreditPack("pack_5000");
    expect(pack.credits).toBe(5_000);
    expect(pack.creditUnits).toBe(creditsToUnits(5_000));
    expect(pack.priceCents).toBe(9_900);
  });

  it("offers exactly three packs", () => {
    expect(CREDIT_PACK_KEYS).toHaveLength(3);
    expect(listCreditPacks().map((pack) => pack.key)).toEqual(["pack_500", "pack_1500", "pack_5000"]);
  });

  it("declares each pack's displayed Credits and internal units consistently", () => {
    for (const pack of listCreditPacks()) {
      expect(pack.creditUnits).toBe(creditsToUnits(pack.credits));
    }
  });
});

describe("a browser cannot influence price, currency or Credit amount (§23, §102.4)", () => {
  it("refuses a fabricated Credit amount posted as a SKU", () => {
    expect(parseCreditPackKey("500000")).toBeNull();
    expect(parseCreditPackKey("pack_500000")).toBeNull();
    expect(parseCreditPackKey("credits=500000")).toBeNull();
  });

  it("refuses an unknown or malformed pack key", () => {
    expect(parseCreditPackKey("pack_9999")).toBeNull();
    expect(parseCreditPackKey("")).toBeNull();
    expect(parseCreditPackKey(null)).toBeNull();
    expect(parseCreditPackKey(undefined)).toBeNull();
    expect(parseCreditPackKey(500)).toBeNull();
    expect(parseCreditPackKey({ key: "pack_500" })).toBeNull();
  });

  it("accepts only an approved pack key", () => {
    expect(parseCreditPackKey("pack_500")).toBe("pack_500");
    expect(parseCreditPackKey("pack_1500")).toBe("pack_1500");
    expect(parseCreditPackKey("pack_5000")).toBe("pack_5000");
  });

  it("refuses a plan key that is not a paid plan, including Free", () => {
    // Free has no Stripe Price and no Checkout; accepting it would produce a
    // Checkout Session for a product that does not exist.
    expect(parsePaidPlanKey("free")).toBeNull();
    expect(parsePaidPlanKey("enterprise")).toBeNull();
    expect(parsePaidPlanKey("")).toBeNull();
    expect(parsePaidPlanKey(null)).toBeNull();
    expect(parsePaidPlanKey(19)).toBeNull();
  });

  it("accepts only an approved paid plan key", () => {
    expect(parsePaidPlanKey("builder")).toBe("builder");
    expect(parsePaidPlanKey("pro")).toBe("pro");
  });

  it("exposes no function that accepts a caller-supplied amount or price", () => {
    // The structural guarantee: every export takes a key or an id, never a
    // number of Credits and never a price. A caller has nothing to lie with.
    const takesOnlyKeys = [getPlan, getCreditPack, parsePaidPlanKey, parseCreditPackKey];
    expect(takesOnlyKeys.every((fn) => fn.length === 1)).toBe(true);
  });
});

describe("Welcome Credits (§5)", () => {
  it("grants 100 Credits valid for 30 days", () => {
    expect(WELCOME_CREDIT_UNITS).toBe(creditsToUnits(100));
    expect(WELCOME_CREDIT_VALIDITY_DAYS).toBe(30);
  });

  it("computes one account-scoped identity, so projects cannot farm Credits", () => {
    // The same user always produces the same key regardless of how many
    // projects they create — the ledger's unique index does the rest.
    expect(welcomeGrantIdempotencyKey("user-a")).toBe("welcome-credit-v1:user-a");
    expect(welcomeGrantIdempotencyKey("user-a")).toBe(welcomeGrantIdempotencyKey("user-a"));
    expect(welcomeGrantIdempotencyKey("user-a")).not.toBe(welcomeGrantIdempotencyKey("user-b"));
  });

  it("versions the identity so a future welcome offer is a different grant", () => {
    expect(welcomeGrantIdempotencyKey("user-a")).toContain("-v1:");
  });
});

describe("grant identities bind to real external payment facts (§28, §30)", () => {
  it("binds a subscription grant to the invoice, not the subscription", () => {
    // A subscription stays `active` for a month. Keying on it would grant
    // repeatedly; keying on the invoice grants once per paid period.
    expect(subscriptionGrantIdempotencyKey("in_123")).toBe("subscription-period-v1:in_123");
    expect(subscriptionGrantIdempotencyKey("in_123")).toBe(subscriptionGrantIdempotencyKey("in_123"));
    expect(subscriptionGrantIdempotencyKey("in_123")).not.toBe(subscriptionGrantIdempotencyKey("in_124"));
  });

  it("binds a top-up grant to the Checkout Session", () => {
    expect(topUpGrantIdempotencyKey("cs_abc")).toBe("topup-v1:cs_abc");
    expect(topUpGrantIdempotencyKey("cs_abc")).not.toBe(topUpGrantIdempotencyKey("cs_abd"));
  });

  it("keeps the three grant identities in separate namespaces", () => {
    // A collision between a welcome key and a purchase key would let one
    // suppress the other.
    const keys = [
      welcomeGrantIdempotencyKey("x"),
      subscriptionGrantIdempotencyKey("x"),
      topUpGrantIdempotencyKey("x"),
    ];
    expect(new Set(keys).size).toBe(3);
  });
});
