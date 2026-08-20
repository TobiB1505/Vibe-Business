import { UnpricedModelError, resolvePricing } from "@/modules/ai/pricing";
import { type CostAmount, estimated, unknown } from "../cost";

/**
 * Model cost, without a provider baked in (Sprint 0054, PART L).
 *
 * ## Why not `ClaudeCost`
 *
 * Because the estimator would then be a Claude estimator, and the first time
 * Vibe routes one operation to a different provider the whole layer needs
 * rewriting rather than configuring. ADR 0005 already put inference behind
 * `AIProvider` for exactly this reason; economics has to hold the same line, or
 * the abstraction stops one layer short of the one that talks about money.
 *
 * ## Why this file states no price
 *
 * Rule 46: provider prices live in `src/modules/ai/pricing.ts` and nowhere
 * else. A second copy is not a redundancy, it is a second answer — and the one
 * that gets quoted is whichever the reader found first. So `anthropicRates`
 * delegates to `resolvePricing` and this file holds the *shape*, not the
 * numbers.
 *
 * For providers Vibe has never called, there is nothing to delegate to, and
 * inventing a plausible OpenAI rate here would be exactly the fabricated number
 * `cost.ts` exists to refuse. Those rates arrive as an argument, the same way
 * `run-economics.ts` takes its sandbox rate: supplied and labelled, or absent.
 */

export const MODEL_PROVIDERS = ["anthropic", "openai", "google"] as const;
export type ModelProviderId = (typeof MODEL_PROVIDERS)[number];

export type ModelProviderRates = {
  provider: ModelProviderId;
  model: string;
  /** The `ai/pricing.ts` row, or the caller's own label for a supplied rate. */
  pricingVersion: string;
  inputNanoUsdPerToken: number;
  outputNanoUsdPerToken: number;
  cacheReadNanoUsdPerToken: number;
  cacheWriteNanoUsdPerToken: number;
};

/**
 * Anthropic rates at an instant, from Vibe's one price book.
 *
 * Null rather than throwing when the model is unpriced: an estimate for an
 * unpriced model is a legitimate `unknown`, not an error, and the caller
 * already has to handle absence for every other signal.
 */
export function anthropicRates(model: string, at: Date): ModelProviderRates | null {
  try {
    const pricing = resolvePricing(model, at);

    return {
      provider: "anthropic",
      model: pricing.model,
      pricingVersion: pricing.pricingVersion,
      inputNanoUsdPerToken: pricing.inputNanoUsdPerToken,
      outputNanoUsdPerToken: pricing.outputNanoUsdPerToken,
      cacheReadNanoUsdPerToken: pricing.cacheReadNanoUsdPerToken,
      cacheWriteNanoUsdPerToken: pricing.cacheWriteNanoUsdPerToken,
    };
  } catch (error) {
    if (error instanceof UnpricedModelError) return null;
    throw error;
  }
}

/**
 * Tokens an execution is expected to consume.
 *
 * An *expectation*, never a measurement — which is why it is a separate type
 * from anything the usage ledger produces, and why the amount it prices out is
 * `estimated` and never `measured`.
 */
export type ExpectedTokenProfile = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

/**
 * Prices an expected token profile.
 *
 * Each component is rounded independently and then summed, matching
 * `calculateProviderCost` so an estimate and an actual are computed the same
 * way and their difference is a real difference rather than a rounding artefact.
 */
export function estimateModelSpend(
  rates: ModelProviderRates | null,
  tokens: ExpectedTokenProfile | null,
): CostAmount {
  if (!rates) return unknown("no_price_available");
  if (!tokens) return unknown("not_measured");

  const nanoUsd =
    Math.round(tokens.input * rates.inputNanoUsdPerToken) +
    Math.round(tokens.output * rates.outputNanoUsdPerToken) +
    Math.round(tokens.cacheRead * rates.cacheReadNanoUsdPerToken) +
    Math.round(tokens.cacheWrite * rates.cacheWriteNanoUsdPerToken);

  return estimated(nanoUsd);
}
