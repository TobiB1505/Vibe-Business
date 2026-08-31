import { calculateProviderCost } from "@/modules/ai/pricing";
import { deriveSandboxCost, type SandboxUsage } from "@/modules/economy/sandbox-cost";
import { VERCEL_SANDBOX_RATES } from "@/modules/economy/infrastructure-rates";
import {
  EXECUTION_PRICING_CLASSES,
  type ExecutionPricingClass,
} from "@/modules/economy/execution-class";
import { RETAIL_OPERATION_KINDS, resolveRetailPrice, type RetailOperationKind } from "./retail";
import { CREDIT_UNITS_PER_CREDIT, type CreditUnits } from "./units";

/**
 * What `launch-v1` earns on each thing it sells, recomputed from live rates.
 *
 * ## The failure this exists to make loud
 *
 * On 2026-08-31, `retail-v1`'s prices had been correct for thirteen days and
 * were about to stop being correct overnight. `ai/pricing.ts` already carried
 * `claude-sonnet-5-standard-2026-09` — a 50% rise on every Sonnet token
 * dimension, effective the next midnight — and nothing anywhere connected that
 * scheduled fact to the fact that it moved every margin in the product from
 * roughly 80% to roughly 68%. Not a test, not a type, not an assertion. The
 * prices would simply have become wrong, silently, while every test stayed
 * green.
 *
 * This module is the missing connection. It reads the provider rates **in force
 * at the instant it is asked** — not a copy, not a constant, the same
 * `calculateProviderCost` the ledger uses — applies them to the measured token
 * and duration profiles below, and reports the contribution margin of each
 * price. Its test fails when one drops through the floor.
 *
 * The next scheduled rate change is therefore a red test with a date on it,
 * rather than a discovery made later from a bank statement.
 *
 * ## What this is not
 *
 * Not a pricing engine. Nothing here decides a price, and nothing reads it back
 * into `retail.ts` — a system that could adjust its own prices to hit a margin
 * would eventually do so instead of telling anybody. It computes and reports;
 * a human changes a policy.
 *
 * Not a cost report either. `economy/` owns that, in nanodollars, over real
 * rows. This works from frozen profiles precisely so it answers one narrow
 * question — "would today's rates still support today's prices?" — without
 * needing a database, and so a failure points at a rate change rather than at
 * whatever traffic happened to arrive this week.
 */

/**
 * What one Credit is worth, in nanodollars, on the plan that values it least.
 *
 * Pro: €49 ÷ 3,000 Credits = €0.016333, at EUR/USD 1.08 = $0.017640.
 *
 * The *cheapest* way to obtain a Credit is deliberately the one used, because a
 * margin that clears here clears on Builder (€0.019) and on every pack
 * (€0.0198–€0.0240). Using an average would let the pack buyers' margin
 * subsidise a number that is wrong for the customers who buy the most.
 *
 * The FX rate is a stated planning assumption, not a measurement — Vibe prices
 * in euro and pays its providers in dollars, and nothing in this repository
 * observes the rate. It is recorded in `docs/business/CREDIT_RATE_CARD_LAUNCH_V1.md`
 * and belongs to whoever revises the card, not to this file.
 */
export const CREDIT_VALUE_NANO_USD = 17_640_000;

/** EUR/USD used to derive {@link CREDIT_VALUE_NANO_USD}. Recorded, never computed with. */
export const ASSUMED_EUR_USD = 1.08;

/**
 * The floor a live price may not fall through: 70% contribution margin.
 *
 * Below the 80% the card is calibrated to, and above what would actually be
 * alarming, on purpose. A guard set at the target fires on every ordinary
 * rounding decision and gets muted; a guard set at break-even fires only once
 * the damage is done. 70% is the band in which a price is still profitable and
 * a human should look at it before it stops being.
 */
export const MARGIN_FLOOR = 0.7;

/**
 * A measured cost profile: what one delivered result of an operation consumed.
 *
 * ## Frozen quantities, live rates
 *
 * The token counts and durations are observations, taken from `ai_usage_events`
 * and `sandbox_usage_events` in the Vibe-Business project on 2026-08-31 and
 * frozen here. The *prices* applied to them are not frozen — they come from
 * `ai/pricing.ts` and `economy/infrastructure-rates.ts` at call time.
 *
 * That split is the whole design. A frozen cost would make this test a
 * tautology that passes forever; a live quantity would make it a report on last
 * week's traffic. Freezing what was measured and floating what is charged is
 * what turns it into a question about rates.
 *
 * Quantities are per *delivered* result and already carry the failure uplift:
 * spend on attempts divided by deliveries, not the mean of the successes. A
 * failed AI call still spends real provider money — a failed audit's measured
 * mean is higher than a successful one's — and pricing against the success mean
 * would claim a margin Vibe does not have.
 */
export type CostProfile = {
  operation: RetailOperationKind;
  /** Set only for a class-priced operation. */
  pricingClass?: ExecutionPricingClass;
  model: string;
  /** Delivered-basis token counts, failure uplift included. */
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  /** Sandbox consumed per delivered result, or null when the operation uses none. */
  sandbox: SandboxUsage | null;
  /** Where the quantities came from, so a reader can weigh them. */
  provenance: string;
};

const SONNET = "claude-sonnet-5";

/** Vibe's own sandbox shape: 4 vCPU, and therefore 8 GB (`gbRamPerVcpu` is 2). */
const VIBE_SANDBOX = { vcpus: 4, vcpusBasis: "derived_from_configuration" } as const;

/**
 * The measured profiles behind `launch-v1`.
 *
 * `deep_scan` is deliberately absent. Its price has a `policy` basis precisely
 * because no browser-provider rate exists in this repository and every
 * `deep_scan_provider_usage.provider_cost_usd` is null — there is nothing to
 * recompute, and inventing a profile in order to produce a reassuring margin
 * would be the exact dishonesty `PriceBasis` was added to prevent. It is
 * excluded here and named in the test, so its absence is asserted rather than
 * overlooked.
 *
 * `product_understanding` is absent for the opposite reason: it is free, and a
 * margin on nothing is not a number.
 */
export const LAUNCH_V1_COST_PROFILES: readonly CostProfile[] = [
  {
    operation: "business_audit",
    model: SONNET,
    // 27 costed jobs. $0.1125 mean at the pre-rise rates; the delivered basis
    // adds the 13 failed calls that cost $0.4470 and produced nothing.
    inputTokens: 12_530,
    outputTokens: 9_680,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    sandbox: null,
    provenance: "ai_usage_events, operation=business_readiness_audit, n=27 delivered + 13 failed, 2026-08-31",
  },
  {
    operation: "opportunity_generation",
    model: SONNET,
    inputTokens: 10_858,
    outputTokens: 4_657,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    sandbox: null,
    provenance: "ai_usage_events, operation=opportunity_generation, n=13 delivered, 2026-08-31",
  },
  {
    operation: "action_plan",
    model: SONNET,
    // n=5, with a 1.2x delivered uplift for the one failed run whose cost was
    // never recorded. An unmeasured failure is not a free one.
    inputTokens: 10_111,
    outputTokens: 4_722,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    sandbox: null,
    provenance: "ai_usage_events, operation=action_planning, n=5 delivered, 2026-08-31",
  },
  {
    operation: "agent_execution",
    pricingClass: "standard",
    model: SONNET,
    // Per delivered run across 16 jobs and ~15.6 provider calls each, with the
    // 41.7% historical failure rate folded in (docs/business/ECONOMY_MODEL.md).
    // Cache tokens dominate: they are 55-70% of agentic provider cost.
    inputTokens: 4_040,
    outputTokens: 11_800,
    cacheReadInputTokens: 602_000,
    cacheCreationInputTokens: 60_600,
    sandbox: {
      purpose: "agent_execution",
      wallMs: 247_692,
      activeCpuMs: 126_845,
      ...VIBE_SANDBOX,
      creations: 1,
      outboundBytes: 3_774_874,
      snapshot: null,
    },
    provenance: "ai_usage_events operation=agentic_execution n=16 + sandbox_usage_events operation=agent_execution n=19, 2026-08-31",
  },
];

export type MarginReport = {
  operation: RetailOperationKind;
  pricingClass: ExecutionPricingClass | null;
  credits: CreditUnits;
  revenueNanoUsd: number;
  /** Provider cost known at today's rates. A floor when sandbox CPU is unknown. */
  costNanoUsd: number;
  /** `(revenue - cost) / revenue`. Never clamped: a negative margin must read as one. */
  margin: number;
  pricingVersion: string;
  provenance: string;
};

function creditsToNanoUsd(credits: CreditUnits): number {
  return Math.round((credits / CREDIT_UNITS_PER_CREDIT) * CREDIT_VALUE_NANO_USD);
}

function priceFor(profile: CostProfile, at: Date): CreditUnits | null {
  const resolved = resolveRetailPrice(profile.operation, at);
  if (!resolved) return null;

  switch (resolved.price.kind) {
    case "free":
    case "not_priced":
      return null;
    case "fixed":
      return resolved.price.creditUnits;
    case "by_execution_class":
      return profile.pricingClass
        ? resolved.price.creditUnitsByClass[profile.pricingClass]
        : null;
  }
}

/**
 * The contribution margin of one price at the rates in force at `at`.
 *
 * Sandbox cost is taken at its **known floor**, not its upper bound. The floor
 * is what Vibe can defend having spent; using the upper bound would make the
 * guard fire on Vibe's own uncertainty rather than on a real rate move, and
 * `economy/cost.ts` keeps the two apart for exactly that reason. The direction
 * of the error is stated rather than hidden: a real margin is at or slightly
 * below what this reports, never above it by much, because the floor omits
 * idle CPU that was nonetheless provisioned.
 */
export function marginFor(profile: CostProfile, at: Date = new Date()): MarginReport | null {
  const credits = priceFor(profile, at);
  if (credits === null) return null;

  const ai = calculateProviderCost({
    model: profile.model,
    inputTokens: profile.inputTokens,
    outputTokens: profile.outputTokens,
    cacheReadInputTokens: profile.cacheReadInputTokens,
    cacheCreationInputTokens: profile.cacheCreationInputTokens,
    at,
  });

  const sandbox = profile.sandbox ? deriveSandboxCost(profile.sandbox, VERCEL_SANDBOX_RATES) : null;
  const sandboxNanoUsd = sandbox?.total.knownFloorNanoUsd ?? 0;

  const revenueNanoUsd = creditsToNanoUsd(credits);
  const costNanoUsd = ai.totalNanoUsd + sandboxNanoUsd;

  return {
    operation: profile.operation,
    pricingClass: profile.pricingClass ?? null,
    credits,
    revenueNanoUsd,
    costNanoUsd,
    margin: (revenueNanoUsd - costNanoUsd) / revenueNanoUsd,
    pricingVersion: ai.pricingVersion,
    provenance: profile.provenance,
  };
}

/** Every profile's margin at the rates in force. */
export function launchV1Margins(at: Date = new Date()): readonly MarginReport[] {
  return LAUNCH_V1_COST_PROFILES.map((profile) => marginFor(profile, at)).filter(
    (report): report is MarginReport => report !== null,
  );
}

/** One priced amount with no measured profile behind it. */
export type UncoveredPrice = {
  operation: RetailOperationKind;
  pricingClass: ExecutionPricingClass | null;
};

/**
 * Every priced amount that no cost profile covers.
 *
 * Returned rather than tolerated, so that a price whose margin cannot be
 * checked is something a test names out loud. Such prices are allowed to exist
 * — `PriceBasis` is the type that says so, and `launch-v1` has three of them:
 * Deep Scan, and the `small` and `complex` agent tiers — but they may not exist
 * *unnoticed*. The test asserts this list exactly, so adding a fourth is a
 * decision somebody makes rather than a gap that opens.
 *
 * Class-level, not operation-level: `agent_execution` is partly covered, and an
 * operation-level answer would report it as either fully checked or fully
 * unchecked, both of which are wrong.
 */
export function uncoveredPrices(at: Date = new Date()): readonly UncoveredPrice[] {
  const covered = new Set(
    LAUNCH_V1_COST_PROFILES.map((profile) => `${profile.operation}:${profile.pricingClass ?? ""}`),
  );

  const uncovered: UncoveredPrice[] = [];

  for (const operation of RETAIL_OPERATION_KINDS) {
    const resolved = resolveRetailPrice(operation, at);
    if (!resolved) continue;

    if (resolved.price.kind === "fixed") {
      if (!covered.has(`${operation}:`)) uncovered.push({ operation, pricingClass: null });
      continue;
    }

    if (resolved.price.kind === "by_execution_class") {
      for (const pricingClass of EXECUTION_PRICING_CLASSES) {
        if (!covered.has(`${operation}:${pricingClass}`)) uncovered.push({ operation, pricingClass });
      }
    }
  }

  return uncovered;
}
