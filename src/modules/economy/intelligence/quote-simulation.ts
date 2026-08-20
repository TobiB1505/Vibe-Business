import { formatNanoUsd } from "../cost";
import type { CreditRateCardModel, CreditRateCardScenario } from "../credit-rate-card";
import type { EstimateConfidence } from "./confidence";
import type { ExecutionEconomicsEstimate } from "./pre-execution-estimate";

/**
 * What a quote would look like, if quotes existed (Sprint 0054, PART G).
 *
 * ## Nothing here is a price
 *
 * `activated: false` is a literal type, not a flag — a `SimulatedQuote` that
 * claimed otherwise would not compile. `CREDIT_RATE_CARDS` in
 * `credits/rating.ts` is still `[]` and this file never reads it; the Credit
 * figures come from `credit-rate-card.ts`'s A/B/C **simulation** scenarios,
 * which have been explicitly hypothetical since Sprint 0052.
 *
 * ## Why a Credit number is optional and null by default
 *
 * Because "350 Credits" with nothing attached is a price, and Vibe has not
 * decided one. A caller who wants Credits has to name which hypothetical rate
 * card produced them, and the answer carries that name back so the figure can
 * never be quoted without it.
 *
 * ## Why Credits come from the class and not from the estimated cost
 *
 * `credits = cost * factor` would make a quote for the same work move every
 * time the repository grew — which is exactly what run #6 -> #9 did, at 2.16x,
 * for an identical step. The execution-class model exists to keep the quote
 * stable while the cost moves underneath it, and the estimated cost's job is to
 * tell Vibe whether that class is still priced sanely.
 *
 * ## Why the protected cost is absent
 *
 * `safety-margin.ts` produces an internally buffered figure for Vibe's own
 * planning. It is deliberately not read here: the buffer exists because Vibe is
 * unsure, and charging a customer for Vibe's uncertainty is a separate decision
 * that nobody has made.
 */

export type SimulatedQuote = {
  expectedCostNanoUsd: number | null;
  /** Formatted from the amount, or the reason there is none. */
  expectedCostLabel: string;
  creditRecommendation: number | null;
  scenarioModel: CreditRateCardModel | null;
  /**
   * Required, never optional. "This costs 400 Credits" and "based on 148
   * similar improvements we expect about 400 Credits" are the same number and
   * different claims, and only the second is one Vibe can make.
   */
  confidence: EstimateConfidence;
  mainDrivers: readonly string[];
  /** Always false. This is a simulation, and the type says so. */
  activated: false;
};

export function simulatePreRunQuote(
  estimate: ExecutionEconomicsEstimate,
  scenario?: CreditRateCardScenario,
): SimulatedQuote {
  const expectedCostNanoUsd = estimate.estimatedCost.known ? estimate.estimatedCost.nanoUsd : null;
  const pricingClass = estimate.pricingClass;

  return {
    expectedCostNanoUsd,
    expectedCostLabel:
      estimate.estimatedCost.known
        ? formatNanoUsd(estimate.estimatedCost.nanoUsd)
        : `unknown (${estimate.estimatedCost.reason})`,
    creditRecommendation: scenario && pricingClass ? scenario.creditsByClass[pricingClass] : null,
    scenarioModel: scenario?.model ?? null,
    confidence: estimate.confidence,
    mainDrivers: estimate.costDrivers
      .filter((driver) => driver.effect !== "neutral")
      .map((driver) => driver.detail),
    activated: false,
  };
}
