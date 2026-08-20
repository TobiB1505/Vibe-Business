import { describe, expect, it } from "vitest";
import type { RepositoryContextSize } from "../cost-drivers";
import { deriveContextPressure } from "./context-pressure";
import type { CohortBias } from "./prediction-bias";
import type { EconomicsComparison } from "./reconciliation";
import { deriveRepositoryDrift } from "./repository-drift";
import { type ExplainVarianceInput, explainVariance } from "./variance-explanation";

function size(overrides: Partial<RepositoryContextSize>): RepositoryContextSize {
  return {
    treeEntries: null,
    filesAnalyzed: null,
    bytesAnalyzed: null,
    routesDetected: null,
    surfacesDetected: null,
    candidatesAvailable: null,
    candidatesSent: null,
    ...overrides,
  };
}

function comparison(relativeError: number | null, overrides: Partial<EconomicsComparison> = {}): EconomicsComparison {
  return {
    predictedNanoUsd: 300_000_000,
    actualFloorNanoUsd: 300_000_000 + Math.round(300_000_000 * (relativeError ?? 0)),
    differenceNanoUsd: Math.round(300_000_000 * (relativeError ?? 0)),
    relativeError,
    comparable: relativeError !== null,
    incomparableReason: null,
    learningSignal: relativeError !== null,
    economyModelVersion: "economy-model.v1",
    ...overrides,
  };
}

function input(overrides: Partial<ExplainVarianceInput> = {}): ExplainVarianceInput {
  return {
    comparison: comparison(0.42),
    drift: deriveRepositoryDrift(size({ candidatesAvailable: 6 }), size({ candidatesAvailable: 6 })),
    pressureAtPrediction: deriveContextPressure(size({ candidatesAvailable: 6, candidatesSent: 6 })),
    pressureAtExecution: deriveContextPressure(size({ candidatesAvailable: 6, candidatesSent: 6 })),
    bias: null,
    expectedValidationDepth: "standard",
    actualValidationDepth: "standard",
    predictedPricingVersion: "claude-sonnet-5-introductory-2026",
    actualPricingVersion: "claude-sonnet-5-introductory-2026",
    predictionHadNoHistory: false,
    ...overrides,
  };
}

/**
 * PART P #14, walked through the run this whole layer exists because of.
 * Run #6 -> run #9: the same step, the same class, 2.16x the model spend.
 */
describe("the run #6 to #9 variance is explained by what Vibe measured", () => {
  const runSixToNine = input({
    comparison: comparison(0.42),
    drift: deriveRepositoryDrift(
      size({ filesAnalyzed: 37, candidatesAvailable: 6 }),
      size({ filesAnalyzed: 72, candidatesAvailable: 12 }),
    ),
    pressureAtPrediction: deriveContextPressure(size({ candidatesAvailable: 6, candidatesSent: 6 })),
    pressureAtExecution: deriveContextPressure(size({ candidatesAvailable: 40, candidatesSent: 12 })),
  });

  it("names the repository growth and the context that no longer fit", () => {
    const explanation = explainVariance(runSixToNine);
    const reasons = explanation.reasons.map((reason) => reason.reason);

    expect(explanation.direction).toBe("over");
    expect(reasons).toContain("repository_grew");
    expect(reasons).toContain("context_pressure_increased");
  });

  it("accounts for most of the variance rather than all or none of it", () => {
    const explanation = explainVariance(runSixToNine);

    expect(explanation.unexplainedShare ?? 1).toBeLessThan(0.5);
    expect(explanation.unexplainedShare ?? 0).toBeGreaterThan(0);
  });

  it("cites the measured movement, not a generated sentence", () => {
    const explanation = explainVariance(runSixToNine);
    const growth = explanation.reasons.find((reason) => reason.reason === "repository_grew");

    expect(growth?.evidence).toContain("35 files");
    expect(growth?.evidence).toContain("6 relevant candidates");
  });
});

/**
 * The tempting failure is attributing a variance to the nearest-looking cause.
 * A layer that always produces an explanation is a layer whose explanations
 * mean nothing.
 */
describe("an unexplainable variance is declared unexplained", () => {
  it("names no reason when nothing moved", () => {
    const explanation = explainVariance(input({ comparison: comparison(0.4) }));

    expect(explanation.direction).toBe("over");
    expect(explanation.reasons).toEqual([]);
    expect(explanation.unexplainedShare).toBe(1);
  });

  /**
   * A repository that grew explains a run costing more. It explains nothing
   * about a run costing less, and saying otherwise is a horoscope.
   */
  it("does not blame growth for a run that came in cheap", () => {
    const explanation = explainVariance(
      input({
        comparison: comparison(-0.3),
        drift: deriveRepositoryDrift(size({ filesAnalyzed: 37 }), size({ filesAnalyzed: 90 })),
      }),
    );

    expect(explanation.direction).toBe("under");
    expect(explanation.reasons.map((reason) => reason.reason)).not.toContain("repository_grew");
  });

  it("explains nothing when the prediction was on target", () => {
    const explanation = explainVariance(input({ comparison: comparison(0.01) }));

    expect(explanation.direction).toBe("on_target");
    expect(explanation.reasons).toEqual([]);
    expect(explanation.unexplainedShare).toBeNull();
  });
});

describe("the other signals a variance can be attributed to", () => {
  it("names a cohort that systematically underestimates", () => {
    const bias: CohortBias = {
      cohort: { pricingClass: "standard", changeKind: "product_change", riskClass: "moderate" },
      sampleSize: 40,
      meanRelativeError: 0.26,
      medianRelativeError: 0.26,
      direction: "systematic_underestimate",
      suggestedCorrection: 1.25,
      confidence: "high",
    };

    const explanation = explainVariance(input({ bias }));
    const cohort = explanation.reasons.find((reason) => reason.reason === "cohort_underestimates");

    expect(cohort?.evidence).toContain("26%");
    expect(cohort?.evidence).toContain("40 runs");
  });

  it("does not name a cohort whose bias points the other way", () => {
    const bias: CohortBias = {
      cohort: { pricingClass: "standard", changeKind: "product_change", riskClass: "moderate" },
      sampleSize: 40,
      meanRelativeError: -0.26,
      medianRelativeError: -0.26,
      direction: "systematic_overestimate",
      suggestedCorrection: 0.8,
      confidence: "high",
    };

    const explanation = explainVariance(input({ bias }));

    expect(explanation.reasons.map((reason) => reason.reason)).not.toContain("cohort_underestimates");
  });

  it("names a deeper validation than the one predicted", () => {
    const explanation = explainVariance(
      input({ expectedValidationDepth: "fast", actualValidationDepth: "deep" }),
    );
    const depth = explanation.reasons.find((reason) => reason.reason === "validation_deeper_than_expected");

    expect(depth?.evidence).toBe("validated at deep, predicted fast");
  });

  it("names a provider price change between quote and bill", () => {
    const explanation = explainVariance(
      input({ actualPricingVersion: "claude-sonnet-5-standard-2026-09" }),
    );
    const pricing = explanation.reasons.find((reason) => reason.reason === "provider_pricing_changed");

    expect(pricing?.evidence).toContain("claude-sonnet-5-introductory-2026");
    expect(pricing?.evidence).toContain("claude-sonnet-5-standard-2026-09");
  });

  it("admits when the estimate rested on nothing", () => {
    const explanation = explainVariance(input({ predictionHadNoHistory: true }));

    expect(explanation.reasons.map((reason) => reason.reason)).toContain(
      "prediction_had_no_historical_basis",
    );
  });
});

describe("an incomparable pair is not explained away", () => {
  it("says the actual cost was incomplete", () => {
    const explanation = explainVariance(
      input({ comparison: comparison(0.4, { comparable: false, incomparableReason: "actual_incomplete" }) }),
    );

    expect(explanation.direction).toBe("incomparable");
    expect(explanation.unexplainedShare).toBeNull();
    expect(explanation.reasons.map((reason) => reason.reason)).toEqual(["actual_cost_incomplete"]);
  });

  it("says the prediction was never made", () => {
    const explanation = explainVariance(
      input({ comparison: comparison(null, { incomparableReason: "prediction_unknown" }) }),
    );

    expect(explanation.direction).toBe("incomparable");
    expect(explanation.reasons.map((reason) => reason.reason)).toEqual([
      "prediction_had_no_historical_basis",
    ]);
  });
});
