/**
 * Model pricing metadata and provider-cost calculation (Sprint 4 §26).
 *
 * Two rules make this trustworthy:
 *
 *  1. **Effective-dated.** Provider prices change on a date, so a price is a
 *     row with a validity window, not a constant. This is not hypothetical:
 *     Claude Sonnet 5 is on introductory pricing ($2/$10 per MTok) through
 *     31 August 2026 and moves to $3/$15 on 1 September 2026. An audit run
 *     today and an identical one in September genuinely cost different
 *     amounts, and the ledger has to say so.
 *  2. **Integer arithmetic.** Costs are computed in whole nanodollars
 *     (1e-9 USD) and only rendered as a decimal string at the end. Floating
 *     point cannot represent $0.0000021 exactly, and a ledger that drifts in
 *     the seventh decimal place across thousands of calls is a ledger that
 *     silently disagrees with the provider's invoice.
 *
 * Prices live here and nowhere else. No dollar constant belongs in a route
 * handler, adapter, or component.
 */

export type ModelPricing = {
  /** Persisted with every usage event so a cost can always be re-derived. */
  pricingVersion: string;
  model: string;
  /** Inclusive ISO instant from which this pricing applies. */
  effectiveFrom: string;
  /** Exclusive ISO instant at which it stops applying; null means current. */
  effectiveTo: string | null;
  /** Nanodollars (1e-9 USD) per input token. $2/MTok = 2000. */
  inputNanoUsdPerToken: number;
  /** Nanodollars per output token. Thinking tokens are billed as output. */
  outputNanoUsdPerToken: number;
};

/**
 * Only models this application actually calls are listed. Adding a model
 * means adding its pricing here first — an unpriced model is a hard error
 * rather than a silently free one.
 */
export const MODEL_PRICING: ModelPricing[] = [
  {
    pricingVersion: "claude-sonnet-5-introductory-2026",
    model: "claude-sonnet-5",
    effectiveFrom: "2026-01-01T00:00:00.000Z",
    // Introductory pricing runs "through August 31, 2026", so it stops
    // applying at the first instant of 1 September 2026 UTC.
    effectiveTo: "2026-09-01T00:00:00.000Z",
    inputNanoUsdPerToken: 2_000, // $2 / MTok
    outputNanoUsdPerToken: 10_000, // $10 / MTok
  },
  {
    pricingVersion: "claude-sonnet-5-standard-2026-09",
    model: "claude-sonnet-5",
    effectiveFrom: "2026-09-01T00:00:00.000Z",
    effectiveTo: null,
    inputNanoUsdPerToken: 3_000, // $3 / MTok
    outputNanoUsdPerToken: 15_000, // $15 / MTok
  },
];

export class UnpricedModelError extends Error {
  constructor(model: string, at: string) {
    super(`No pricing is configured for model "${model}" at ${at}.`);
    this.name = "UnpricedModelError";
  }
}

/** Resolves the pricing row in force for `model` at instant `at`. */
export function resolvePricing(model: string, at: Date = new Date()): ModelPricing {
  const timestamp = at.getTime();

  const match = MODEL_PRICING.find((entry) => {
    if (entry.model !== model) return false;
    const from = Date.parse(entry.effectiveFrom);
    const to = entry.effectiveTo === null ? Number.POSITIVE_INFINITY : Date.parse(entry.effectiveTo);
    // Half-open interval: [from, to). An instant exactly on a boundary
    // belongs to the newer row, so a price change has no ambiguous second.
    return timestamp >= from && timestamp < to;
  });

  if (!match) throw new UnpricedModelError(model, at.toISOString());
  return match;
}

export type CostBreakdown = {
  pricingVersion: string;
  /** Exact integer nanodollars — the value all arithmetic is done in. */
  totalNanoUsd: number;
  /** Fixed-point USD string, e.g. "0.000042000". Safe to store as numeric. */
  totalUsd: string;
  inputNanoUsd: number;
  outputNanoUsd: number;
};

/** Renders integer nanodollars as a fixed-point USD decimal string, without floats. */
export function nanoUsdToUsdString(nanoUsd: number): string {
  const negative = nanoUsd < 0;
  const absolute = Math.abs(Math.trunc(nanoUsd));
  const whole = Math.floor(absolute / 1_000_000_000);
  const fraction = absolute % 1_000_000_000;
  return `${negative ? "-" : ""}${whole}.${fraction.toString().padStart(9, "0")}`;
}

/**
 * Computes provider cost from the token counts the provider actually
 * reported. Reported usage is the source of truth — never the pre-call
 * estimate (Sprint 4 §26).
 */
export function calculateProviderCost(params: {
  model: string;
  inputTokens: number;
  outputTokens: number;
  at?: Date;
}): CostBreakdown {
  const pricing = resolvePricing(params.model, params.at ?? new Date());

  const inputNanoUsd = Math.round(params.inputTokens * pricing.inputNanoUsdPerToken);
  // Thinking tokens are already included in `outputTokens` by the provider,
  // and are billed at the output rate — so they must not be added again.
  const outputNanoUsd = Math.round(params.outputTokens * pricing.outputNanoUsdPerToken);
  const totalNanoUsd = inputNanoUsd + outputNanoUsd;

  return {
    pricingVersion: pricing.pricingVersion,
    totalNanoUsd,
    totalUsd: nanoUsdToUsdString(totalNanoUsd),
    inputNanoUsd,
    outputNanoUsd,
  };
}
