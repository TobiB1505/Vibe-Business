import type { ExecutionPricingClass } from "@/modules/economy/execution-class";
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
 * The first four are the Class A "predictable" operations: a single bounded AI
 * call with no user-directed variability. The customer does not choose how long
 * the audit thinks, so a fixed price is the honest shape (CREDIT_ECONOMICS.md
 * §Predictable-operation pricing).
 *
 * `deep_scan` and `agent_execution` joined them in `launch-v1` and behave
 * differently in one way each: Deep Scan is the one price in the card with no
 * measured cost behind it, and Agentic Execution is priced per execution class
 * rather than by a single number. Both facts are carried by the types below
 * rather than by this comment — see {@link PriceBasis} and {@link RetailPrice}.
 *
 * A kind listed here is *priceable*, not necessarily *priced*: `retail-v1`
 * carries `not_priced` for both of the newcomers, because that is what was true
 * while it was in force.
 */
export const RETAIL_OPERATION_KINDS = [
  "business_audit",
  "opportunity_generation",
  "action_plan",
  "product_understanding",
  "deep_scan",
  "agent_execution",
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
 *
 * `not_priced` is a third distinct case, and it is distinct from `free` for the
 * opposite reason: it must refuse. A policy that has no price for an operation
 * is saying "this cannot be bought under me", and collapsing that into `free`
 * would run the most expensive operation Vibe has for nothing. `retail-v1`
 * carries it for Deep Scan and Agentic Execution, which is exactly what was
 * true while `retail-v1` was in force.
 *
 * `by_execution_class` exists because Agentic Execution is the one operation
 * whose price is knowable before it runs but is *not* one number. The class
 * comes from `classifyExecutionPricingClass`, which reads only pre-execution
 * facts — risk class, change kind, Vibe-minted evidence ids, named surfaces —
 * so the price is fixed before a cent is spent and cannot move with how
 * inefficiently the agent happened to work (ADR 0038 §3).
 */
export type RetailPrice =
  | { kind: "free" }
  | { kind: "not_priced" }
  | { kind: "fixed"; creditUnits: CreditUnits }
  | {
      kind: "by_execution_class";
      creditUnitsByClass: Readonly<Record<ExecutionPricingClass, CreditUnits>>;
    };

/**
 * How a price came to be a number.
 *
 * Required per operation, not optional, and not a comment — because `launch-v1`
 * contains three genuinely different kinds of claim and a reader of a price
 * table has no way to tell them apart otherwise. This is the same discipline
 * `economy/infrastructure-rates.ts` applies to `RateSourceKind`, and that the
 * economy layer's own quote simulation applies with its literal
 * `activated: false`.
 *
 * - `measured`  — derived from Vibe's own recorded provider cost for delivered
 *                 results of this operation.
 * - `modelled`  — derived from a ratio against a tier that *was* measured. The
 *                 `complex` agent tier has zero cost observations of its own.
 * - `policy`    — a commercial judgment with no measured cost behind it at all.
 *                 Deep Scan is the only one, because no browser-provider rate
 *                 exists anywhere in this repository and every
 *                 `deep_scan_provider_usage.provider_cost_usd` is null.
 */
export const PRICE_BASES = ["measured", "modelled", "policy"] as const;
export type PriceBasis = (typeof PRICE_BASES)[number];

/** One operation's price under one policy, and how that number was arrived at. */
export type RetailPriceEntry = {
  price: RetailPrice;
  basis: PriceBasis;
};

/** A versioned, effective-dated retail price policy. */
export type RetailPricePolicy = {
  version: string;
  /** Inclusive ISO instant. */
  effectiveFrom: string;
  /** Exclusive ISO instant; null means "current". */
  effectiveTo: string | null;
  prices: Readonly<Record<RetailOperationKind, RetailPriceEntry>>;
};

/**
 * The instant `retail-v1` ends and `launch-v1` begins.
 *
 * Deliberately the same instant Anthropic's Sonnet 5 increase takes effect
 * (`claude-sonnet-5-standard-2026-09` in `ai/pricing.ts`). The two are the same
 * event seen from two sides: the cost of every Sonnet-priced operation rises
 * 50% at this instant, and `launch-v1` is what keeps the margin where
 * `retail-v1` was calibrated to put it. Splitting them would leave a window in
 * which Vibe knowingly sold below its own standard.
 */
const LAUNCH_V1_EFFECTIVE_FROM = "2026-09-01T00:00:00.000Z";

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
 *
 * Superseded by `launch-v1`, and kept forever: the nine charges already settled
 * under this version stay explainable only for as long as this object exists.
 */
const RETAIL_V1: RetailPricePolicy = {
  version: "retail-v1",
  effectiveFrom: "2026-08-18T00:00:00.000Z",
  effectiveTo: LAUNCH_V1_EFFECTIVE_FROM,
  prices: {
    business_audit: { price: { kind: "fixed", creditUnits: creditsToUnits(35) }, basis: "measured" },
    opportunity_generation: {
      price: { kind: "fixed", creditUnits: creditsToUnits(20) },
      basis: "measured",
    },
    action_plan: { price: { kind: "fixed", creditUnits: creditsToUnits(15) }, basis: "measured" },
    // Always free, never Credit-priced. It runs inside the onboarding flow
    // every new project passes through, is deliberately configured to be cheap,
    // and the answer to "should we run it?" is always yes.
    product_understanding: { price: { kind: "free" }, basis: "measured" },
    // Both were genuinely unpriced under this policy. Recording that as
    // `not_priced` rather than omitting the key is what makes a charge dated
    // inside this window answerable: "retail-v1 had no price for it", not
    // "somebody forgot to add one".
    deep_scan: { price: { kind: "not_priced" }, basis: "policy" },
    agent_execution: { price: { kind: "not_priced" }, basis: "measured" },
  },
};

/**
 * The launch rate card.
 *
 * ## Where every number came from
 *
 * One rule, applied uniformly with no per-operation special cases:
 *
 * ```
 * credits = effective provider cost per DELIVERED result
 *           ÷ 0.20                      (the 80% contribution margin retail-v1 was calibrated to)
 *           ÷ $0.017640                 (what one Credit is worth on the plan that values it least)
 *           rounded up to the nearest 5
 * ```
 *
 * The divisor is the Pro plan: €49 ÷ 3,000 Credits = €0.016333, converted at
 * EUR/USD 1.08. Pro is used because it is the *cheapest* way to obtain a
 * Credit, so a margin that clears here clears on Builder and on every pack. The
 * FX rate is a stated planning assumption, not a measurement — see
 * `docs/business/CREDIT_RATE_CARD_LAUNCH_V1.md`.
 *
 * "Effective cost per delivered result" is measured spend on *attempts* divided
 * by *deliveries*, not the mean of the successes. A failed AI call still spends
 * real provider money — the measured mean cost of a failed audit is higher than
 * that of a successful one — and pricing against the success mean would hand
 * Vibe a margin it does not have.
 *
 * Costs are the production figures from `ai_usage_events` and
 * `sandbox_usage_events`, restated at the post-2026-09-01 Sonnet rates:
 *
 * ```
 * Business Audit      $0.1899/delivered   →  53.8  →   55 Credits   (80.4% margin)
 * Next Moves          $0.1025/delivered   →  29.1  →   30 Credits   (80.6%)
 * Action Plan         $0.1012/delivered   →  28.7  →   30 Credits   (80.9%)
 * Agent, standard     $0.6507/delivered   → 184.4  →  200 Credits   (81.6%)
 * ```
 *
 * Next Moves and Action Plan land on the same number because their measured
 * effective costs are within 1% of each other. That is the arithmetic, not a
 * rounding convenience.
 *
 * ## What the two non-`measured` prices are
 *
 * **Deep Scan, 25 Credits, `policy`.** No browser-provider rate exists anywhere
 * in this repository, and `provider_cost_usd` is null for every row of
 * `deep_scan_provider_usage` and `review_browser_usage`. 25 Credits is a
 * commercial judgment sized to sit below the audit it feeds, and the `basis`
 * field is the only honest way to ship it. It replaces a typed refusal that
 * could not be acted on with a price that can.
 *
 * **The `complex` agent tier, 350 Credits, `modelled`.** Zero runs have ever
 * been classified `complex`, so its cost is a ratio against `standard`, not an
 * observation. `small` has one. Only `standard` is carried by a real sample,
 * and it is also the tier the classifier's own rules send most work to.
 *
 * ## What is deliberately still absent
 *
 * Validation, preview and review. They are bundled into the agent price, and
 * their measured cost (~$0.045 + ~$0.022 + browser) is inside the $0.6507
 * above. A customer bought a validated improvement, not a pipeline; line-item
 * them and the total price of an improvement stops being knowable in advance.
 */
const LAUNCH_V1: RetailPricePolicy = {
  version: "launch-v1",
  effectiveFrom: LAUNCH_V1_EFFECTIVE_FROM,
  effectiveTo: null,
  prices: {
    business_audit: { price: { kind: "fixed", creditUnits: creditsToUnits(55) }, basis: "measured" },
    opportunity_generation: {
      price: { kind: "fixed", creditUnits: creditsToUnits(30) },
      basis: "measured",
    },
    action_plan: { price: { kind: "fixed", creditUnits: creditsToUnits(30) }, basis: "measured" },
    product_understanding: { price: { kind: "free" }, basis: "measured" },
    deep_scan: { price: { kind: "fixed", creditUnits: creditsToUnits(25) }, basis: "policy" },
    agent_execution: {
      price: {
        kind: "by_execution_class",
        creditUnitsByClass: {
          small: creditsToUnits(150),
          standard: creditsToUnits(200),
          complex: creditsToUnits(350),
        },
      },
      // The tier that carries the sample is `standard`; the card as a whole is
      // anchored on it. `small` (n=1) and `complex` (n=0) are ratios off it —
      // stated here once rather than per-tier, because a `Record` has no room
      // for a per-key basis and inventing one would imply a precision the
      // dataset does not have either way.
      basis: "modelled",
    },
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
export const RETAIL_PRICE_POLICIES: readonly RetailPricePolicy[] = [RETAIL_V1, LAUNCH_V1];

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
  basis: PriceBasis;
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

  const entry = policy.prices[operation];
  return { operation, price: entry.price, basis: entry.basis, policyVersion: policy.version };
}

/**
 * Raised when a class-priced operation is resolved without a class.
 *
 * A thrown error rather than a fallback tier, and the choice is load-bearing.
 * Defaulting to `small` would sell every agent improvement at the cheapest
 * price Vibe has while every screen, test and ledger entry continued to look
 * correct — a revenue leak that presents as a working system. Defaulting to
 * `complex` would overcharge just as silently. There is no safe default, so
 * there is no default.
 */
export class ExecutionClassRequiredError extends Error {
  constructor(operation: RetailOperationKind, policyVersion: string) {
    super(
      `Operation "${operation}" is priced by execution class under policy "${policyVersion}", ` +
        `but no pricing class was supplied. Classify the step with ` +
        `classifyExecutionPricingClass before resolving its price.`,
    );
    this.name = "ExecutionClassRequiredError";
  }
}

/**
 * What a caller must do about an operation's price.
 *
 * Three outcomes rather than "a number or null", because the two null-shaped
 * cases require opposite behaviour and the old shape could not tell them apart:
 *
 * ```
 * free         run it, reserve nothing, charge nothing
 * charge       reserve this amount under this policy version
 * not_priced   refuse — this policy does not sell this operation
 * ```
 */
export type RetailChargeResolution =
  | { kind: "free" }
  | { kind: "not_priced"; policyVersion: string }
  | { kind: "charge"; creditUnits: CreditUnits; policyVersion: string };

/**
 * The Credit amount to reserve for an operation, and under which policy.
 *
 * `pricingClass` is required exactly when the resolved price is
 * `by_execution_class`, and ignored otherwise — passing one for a fixed-price
 * operation is harmless, omitting one for a class-priced operation throws. See
 * {@link ExecutionClassRequiredError} for why that is not a default.
 */
export function retailChargeFor(
  operation: RetailOperationKind,
  at: Date = new Date(),
  options: {
    pricingClass?: ExecutionPricingClass | null;
    policies?: readonly RetailPricePolicy[];
  } = {},
): RetailChargeResolution {
  const resolved = resolveRetailPrice(operation, at, options.policies ?? RETAIL_PRICE_POLICIES);

  // No policy in force at all. Nothing is for sale, and that is a refusal
  // rather than a giveaway — the same reasoning as `not_priced` below.
  if (!resolved) return { kind: "not_priced", policyVersion: "none" };

  switch (resolved.price.kind) {
    case "free":
      return { kind: "free" };
    case "not_priced":
      return { kind: "not_priced", policyVersion: resolved.policyVersion };
    case "fixed":
      return {
        kind: "charge",
        creditUnits: resolved.price.creditUnits,
        policyVersion: resolved.policyVersion,
      };
    case "by_execution_class": {
      if (!options.pricingClass) {
        throw new ExecutionClassRequiredError(operation, resolved.policyVersion);
      }
      return {
        kind: "charge",
        creditUnits: resolved.price.creditUnitsByClass[options.pricingClass],
        policyVersion: resolved.policyVersion,
      };
    }
  }
}

/**
 * Every Credit amount a class-priced operation can cost, for display.
 *
 * A price *table* has to show all three tiers; a *charge* only ever resolves
 * one. Kept separate from {@link retailChargeFor} so that rendering a table can
 * never accidentally become a way to charge without a class.
 */
export function retailPricesByClass(
  operation: RetailOperationKind,
  at: Date = new Date(),
  policies: readonly RetailPricePolicy[] = RETAIL_PRICE_POLICIES,
): Readonly<Record<ExecutionPricingClass, CreditUnits>> | null {
  const resolved = resolveRetailPrice(operation, at, policies);
  return resolved?.price.kind === "by_execution_class" ? resolved.price.creditUnitsByClass : null;
}
