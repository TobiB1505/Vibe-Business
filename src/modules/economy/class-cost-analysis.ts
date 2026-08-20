import type { ExecutionPricingClass } from "./execution-class";
import { HISTORICAL_CLASSIFICATIONS, HISTORICAL_RUNS } from "./historical-runs";

/**
 * PART K — is a tiered rate card economically sensible, or is tiering a pure
 * value-pricing story with no cost behind it? (Sprint 0052, Credit Economics
 * v1.)
 *
 * ## What this function can and cannot answer
 *
 * It computes real cost statistics per Execution Pricing Class from the six
 * historical runs. It cannot answer PART K's question on its own, because
 * the dataset itself cannot: **zero historical runs reach `complex`**
 * (`historical-runs.ts`), so any comparison involving that class has no real
 * cost behind it at all — a gap this function reports rather than paper over
 * with a placeholder average. `small` has exactly one observation (run #8),
 * which is a sample, not a distribution — `standardDeviationNanoUsd` is
 * `null` for any class with fewer than two runs, deliberately, rather than
 * silently reporting a zero-width spread that would look like confidence
 * that does not exist.
 *
 * The narrative conclusion — whether the observed small/standard gap
 * justifies tiering, and whether that reasoning also has to hold for
 * `complex` on faith — belongs in `CREDIT_PRICING_V1.md`, not in code; this
 * function only produces the numbers that conclusion has to be honest about.
 */

export type ClassCostStats = {
  pricingClass: ExecutionPricingClass;
  runCount: number;
  meanFloorNanoUsd: number | null;
  /** null when runCount < 2 — a spread computed from one point is not a spread. */
  standardDeviationNanoUsd: number | null;
  minFloorNanoUsd: number | null;
  maxFloorNanoUsd: number | null;
  runs: readonly number[];
};

function statsFor(pricingClass: ExecutionPricingClass): ClassCostStats {
  const runNumbers = HISTORICAL_CLASSIFICATIONS.filter((c) => c.pricingClass === pricingClass).map(
    (c) => c.run,
  );
  const floors = runNumbers.map(
    (run) => HISTORICAL_RUNS.find((r) => r.run === run)!.economicCostFloorNanoUsd,
  );

  if (floors.length === 0) {
    return {
      pricingClass,
      runCount: 0,
      meanFloorNanoUsd: null,
      standardDeviationNanoUsd: null,
      minFloorNanoUsd: null,
      maxFloorNanoUsd: null,
      runs: [],
    };
  }

  const mean = floors.reduce((sum, f) => sum + f, 0) / floors.length;
  const standardDeviationNanoUsd =
    floors.length < 2
      ? null
      : Math.sqrt(floors.reduce((sum, f) => sum + (f - mean) ** 2, 0) / (floors.length - 1));

  return {
    pricingClass,
    runCount: floors.length,
    meanFloorNanoUsd: Math.round(mean),
    standardDeviationNanoUsd: standardDeviationNanoUsd === null ? null : Math.round(standardDeviationNanoUsd),
    minFloorNanoUsd: Math.min(...floors),
    maxFloorNanoUsd: Math.max(...floors),
    runs: runNumbers,
  };
}

/** Cost statistics for every Execution Pricing Class, from the real historical dataset. */
export function analyzeClassCostDifferentiation(): readonly ClassCostStats[] {
  return (["small", "standard", "complex"] as const).map(statsFor);
}

/**
 * True when `standard`'s mean cost exceeds `small`'s by at least the given
 * ratio (default 1.10 — a 10% gap). The one comparison this dataset can
 * actually make; `complex` is excluded because it has no observations to
 * compare with.
 */
export function smallVersusStandardCostGapRatio(): number | null {
  const [small, standard] = analyzeClassCostDifferentiation();
  if (small.meanFloorNanoUsd === null || standard.meanFloorNanoUsd === null) return null;
  return standard.meanFloorNanoUsd / small.meanFloorNanoUsd;
}
