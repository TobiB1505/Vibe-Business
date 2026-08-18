import { creditsToUnits, type CreditUnits } from "./units";

/**
 * Customer retail operation pricing (BILLING CORE-2 §3, §36, §37, §38).
 *
 * ## Why this is not the Core-1 rate card
 *
 * Billing Core-1 built `rating.ts`, and its shape is a deliberate answer to a
 * different question:
 *
 * ```
 * rating.ts   "what did this provider usage rate to?"   credits per token / ms / byte
 * retail.ts   "what does this operation cost?"          credits per delivered operation
 * ```
 *
 * A `CreditRateLine` is `creditUnitsPerUnit` against a `UsageSku` — per
 * Anthropic input token, per sandbox millisecond, per browser millisecond. It
 * exists to turn *measured provider consumption* into Credits, and it rates a
 * set of usage events that already happened.
 *
 * A fixed customer price is the opposite kind of fact. "A Business Audit costs
 * 35 Credits" is knowable **before** the operation runs, does not vary with how
 * many tokens the model happened to use, and has no SKU to attach to. Forcing
 * it into a rate line would mean inventing a fake SKU and a fake quantity of 1,
 * which would make `rateUsage` — the function that rates real provider
 * consumption — start returning customer prices for usage that never occurred.
 * That corrupts the one distinction Core-1's schema comment says the whole
 * module exists to protect:
 *
 * ```
 * Provider Cost Price Book  ≠  Customer Retail Credit Policy
 * ```
 *
 * So this is a separate, smaller layer. It shares Core-1's conventions exactly
 * — versioned, effective-dated, half-open intervals, integer credit units,
 * policy in reviewable code rather than an editable table — and shares none of
 * its semantics. Both remain live: provider usage keeps being rated internally
 * for cost telemetry, and customers keep paying a fixed price.
 *
 * ## Historical immutability (§38)
 *
 * A charge stores the policy version that produced it. When Audit v2 raises the
 * price to 45, an audit charged under `retail-v1` stays 35 forever — the
 * historical entry is never re-rated, because nothing ever recomputes a price
 * from the *current* policy for a *past* charge. The only way to read a past
 * charge's price is to read the charge.
 */

/* ---------------------------------------------------------------------------
 * Operations
 * ------------------------------------------------------------------------ */

/**
 * The customer-facing operations a retail price can apply to.
 *
 * These are the Class A "predictable" operations: a single bounded AI call with
 * no user-directed variability. The customer does not choose how long the audit
 * thinks, so a fixed price is the honest shape (CREDIT_ECONOMICS.md
 * §Predictable-operation pricing).
 *
 * Deliberately absent: Deep Scan and Agentic Execution. Neither has an approved
 * price, and both are blocked on cost inputs that do not exist yet — an
 * additional Deep Scan still returns the existing typed refusal with no price
 * shown, and the Agent will be quote-based when it exists (§4, §46, §87).
 */
export const RETAIL_OPERATION_KINDS = [
  "business_audit",
  "opportunity_generation",
  "action_plan",
  "product_understanding",
] as const;
export type RetailOperationKind = (typeof RETAIL_OPERATION_KINDS)[number];

/**
 * What an operation costs a customer.
 *
 * `free` is a distinct case rather than a price of zero, and the difference is
 * load-bearing (§56). A zero price would flow through reservation and
 * settlement like any other, and Vibe would post a 0-Credit charge every time
 * somebody's product understanding refreshed — filling a customer's Credit
 * history with entries that record nothing happening. `free` cannot do that,
 * because there is no amount to reserve.
 */
export type RetailPrice = { kind: "free" } | { kind: "fixed"; creditUnits: CreditUnits };

/** A versioned, effective-dated retail price policy. */
export type RetailPricePolicy = {
  version: string;
  /** Inclusive ISO instant. */
  effectiveFrom: string;
  /** Exclusive ISO instant; null means "current". */
  effectiveTo: string | null;
  prices: Readonly<Record<RetailOperationKind, RetailPrice>>;
};

/**
 * The approved V1 customer prices.
 *
 * Founder-approved, calibrated against the effective per-result provider cost
 * measured in CREDIT_ECONOMICS.md at roughly an 80% contribution margin, then
 * rounded to numbers a customer can hold in their head. The document
 * recommended ~33 / ~16 / ~11; V1 ships 35 / 20 / 15.
 *
 * These are **fixed customer prices**. They are deliberately not derived from
 * any individual run's token usage (§88) — a customer told "Claude used 20,413
 * tokens, therefore 17.29 Credits" has been handed Vibe's cost structure as
 * their problem. Provider usage continues to be measured separately, for
 * Vibe's economics rather than the customer's bill.
 */
const RETAIL_V1: RetailPricePolicy = {
  version: "retail-v1",
  effectiveFrom: "2026-08-18T00:00:00.000Z",
  effectiveTo: null,
  prices: {
    business_audit: { kind: "fixed", creditUnits: creditsToUnits(35) },
    opportunity_generation: { kind: "fixed", creditUnits: creditsToUnits(20) },
    action_plan: { kind: "fixed", creditUnits: creditsToUnits(15) },
    // Always free, never Credit-priced. It runs inside the onboarding flow
    // every new project passes through, is deliberately configured to be cheap,
    // and the answer to "should we run it?" is always yes.
    product_understanding: { kind: "free" },
  },
};

/**
 * Every approved retail price policy, newest last.
 *
 * Unlike Core-1's `CREDIT_RATE_CARDS`, this array is **not** empty: Billing
 * Product-1 made the commercial decision and Core-2 activates it. Adding an
 * entry is still a commercial decision rather than an implementation detail,
 * and a superseded policy is never deleted — a charge that names it must stay
 * explainable forever.
 */
export const RETAIL_PRICE_POLICIES: readonly RetailPricePolicy[] = [RETAIL_V1];

/**
 * The policy in force at an instant, or null when none is.
 *
 * Half-open `[effectiveFrom, effectiveTo)`, matching `resolveRateCard` and
 * `resolvePricing` exactly so the three layers cannot develop subtly different
 * date semantics at a boundary instant.
 */
export function resolveRetailPolicy(
  at: Date = new Date(),
  policies: readonly RetailPricePolicy[] = RETAIL_PRICE_POLICIES,
): RetailPricePolicy | null {
  const timestamp = at.getTime();

  for (const policy of policies) {
    const from = Date.parse(policy.effectiveFrom);
    const to = policy.effectiveTo === null ? Number.POSITIVE_INFINITY : Date.parse(policy.effectiveTo);
    if (timestamp >= from && timestamp < to) return policy;
  }

  return null;
}

/** A resolved price and the policy identity that must be stored with a charge. */
export type ResolvedRetailPrice = {
  operation: RetailOperationKind;
  price: RetailPrice;
  policyVersion: string;
};

/**
 * What an operation costs right now, and under which policy (§36, §38).
 *
 * Returns the policy version alongside the price because the two must always
 * travel together: a charge that recorded an amount without the policy that
 * produced it could not be defended later, and a future price change would
 * make it unexplainable. Every caller that reserves or settles stores this
 * version on the ledger entry.
 */
export function resolveRetailPrice(
  operation: RetailOperationKind,
  at: Date = new Date(),
  policies: readonly RetailPricePolicy[] = RETAIL_PRICE_POLICIES,
): ResolvedRetailPrice | null {
  const policy = resolveRetailPolicy(at, policies);
  if (!policy) return null;

  return { operation, price: policy.prices[operation], policyVersion: policy.version };
}

/**
 * The Credit amount to reserve for an operation, or null when it is free.
 *
 * A convenience over {@link resolveRetailPrice} for the common case, kept
 * narrow so a caller cannot accidentally reserve zero for a free operation —
 * `null` forces the free path to be handled explicitly rather than flowing
 * into the reservation machinery with an amount of 0.
 */
export function retailChargeFor(
  operation: RetailOperationKind,
  at: Date = new Date(),
  policies: readonly RetailPricePolicy[] = RETAIL_PRICE_POLICIES,
): { creditUnits: CreditUnits; policyVersion: string } | null {
  const resolved = resolveRetailPrice(operation, at, policies);
  if (!resolved || resolved.price.kind === "free") return null;

  return { creditUnits: resolved.price.creditUnits, policyVersion: resolved.policyVersion };
}
