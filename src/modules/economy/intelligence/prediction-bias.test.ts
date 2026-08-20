import { describe, expect, it } from "vitest";
import { HISTORICAL_LEARNING_RECORDS, type LearningRecord } from "./learning-dataset";
import { resolveEconomyModel } from "./model-version";
import {
  type PredictionCohort,
  correctionForCohort,
  detectCohortBias,
} from "./prediction-bias";

const POLICY = resolveEconomyModel(new Date("2026-08-21T00:00:00Z")).adjustmentPolicy;

const COHORT: PredictionCohort = {
  pricingClass: "standard",
  changeKind: "product_change",
  riskClass: "moderate",
};

function record(relativeError: number | null, overrides: Partial<LearningRecord> = {}): LearningRecord {
  const template = HISTORICAL_LEARNING_RECORDS[0];

  return {
    ...template,
    ...overrides,
    comparison: {
      ...template.comparison,
      relativeError,
      comparable: relativeError !== null,
      incomparableReason: relativeError === null ? "prediction_unknown" : null,
      learningSignal: relativeError !== null,
      ...(overrides.comparison ?? {}),
    },
  };
}

describe("bias is measured per cohort, not per run", () => {
  it("groups by the pre-execution fields a future run will also have", () => {
    const biases = detectCohortBias(HISTORICAL_LEARNING_RECORDS, POLICY);

    for (const bias of biases) {
      expect(Object.keys(bias.cohort).sort()).toEqual(["changeKind", "pricingClass", "riskClass"]);
    }
  });

  it("reports the errors it saw even when it will not act on them", () => {
    const biases = detectCohortBias(HISTORICAL_LEARNING_RECORDS, POLICY);
    const total = biases.reduce((sum, bias) => sum + bias.sampleSize, 0);

    expect(total).toBe(HISTORICAL_LEARNING_RECORDS.length);
    for (const bias of biases) {
      expect(bias.medianRelativeError).not.toBeNull();
    }
  });

  /**
   * An incomparable observation contributes nothing rather than contributing a
   * zero — a zero would read as a perfect prediction and pull the cohort toward
   * "no bias".
   */
  it("excludes an incomparable observation rather than counting it as accurate", () => {
    const biases = detectCohortBias([record(0.4), record(null), record(0.4)], POLICY);

    expect(biases).toHaveLength(1);
    expect(biases[0]?.sampleSize).toBe(2);
    expect(biases[0]?.medianRelativeError).toBeCloseTo(0.4);
  });
});

/**
 * PART P #13. A correction is a scalar the estimator multiplies by, so a wrong
 * one moves real money.
 */
describe("a cohort below the sample floor corrects nothing", () => {
  it("returns exactly 1, not a hedged fraction", () => {
    const biases = detectCohortBias(Array.from({ length: 5 }, () => record(0.4)), POLICY);

    expect(biases[0]?.sampleSize).toBe(5);
    expect(biases[0]?.direction).toBe("none");
    expect(biases[0]?.suggestedCorrection).toBe(1);
    expect(biases[0]?.confidence).toBe("none");
  });

  it("finds no actionable bias in today's entire dataset", () => {
    const biases = detectCohortBias(HISTORICAL_LEARNING_RECORDS, POLICY);

    expect(biases.length).toBeGreaterThan(0);
    for (const bias of biases) {
      expect(bias.sampleSize).toBeLessThan(POLICY.minSamples);
      expect(bias.direction).toBe("none");
      expect(bias.suggestedCorrection).toBe(1);
    }
  });
});

describe("a cohort with enough evidence is corrected, within bounds", () => {
  it("detects a systematic underestimate", () => {
    const biases = detectCohortBias(Array.from({ length: 25 }, () => record(0.26)), POLICY);

    expect(biases[0]?.direction).toBe("systematic_underestimate");
    expect(biases[0]?.suggestedCorrection).toBeCloseTo(1.25, 2);
  });

  it("detects a systematic overestimate", () => {
    const biases = detectCohortBias(Array.from({ length: 25 }, () => record(-0.15)), POLICY);

    expect(biases[0]?.direction).toBe("systematic_overestimate");
    expect(biases[0]?.suggestedCorrection).toBeCloseTo(0.85, 2);
  });

  it("leaves a well-predicted cohort alone", () => {
    const biases = detectCohortBias(Array.from({ length: 25 }, () => record(0.02)), POLICY);

    expect(biases[0]?.direction).toBe("none");
    expect(biases[0]?.suggestedCorrection).toBe(1);
    expect(biases[0]?.confidence).not.toBe("none");
  });

  it("never proposes a correction outside the policy bounds", () => {
    const wild = detectCohortBias(Array.from({ length: 25 }, () => record(4)), POLICY);
    const collapsed = detectCohortBias(Array.from({ length: 25 }, () => record(-0.95)), POLICY);

    expect(wild[0]?.suggestedCorrection).toBe(POLICY.maxIncrease);
    expect(collapsed[0]?.suggestedCorrection).toBe(POLICY.maxDecrease);
  });
});

describe("a cohort nothing is known about is not corrected by another one's error", () => {
  it("returns exactly 1 for an unseen cohort", () => {
    const biases = detectCohortBias(Array.from({ length: 25 }, () => record(0.26)), POLICY);

    expect(correctionForCohort(biases, { ...COHORT, riskClass: "high" })).toBe(1);
    expect(correctionForCohort([], COHORT)).toBe(1);
  });

  it("returns the cohort's own correction when it has one", () => {
    const biases = detectCohortBias(Array.from({ length: 25 }, () => record(0.26)), POLICY);
    const cohort = biases[0]?.cohort;
    if (!cohort) throw new Error("expected a cohort");

    expect(correctionForCohort(biases, cohort)).toBeCloseTo(1.25, 2);
  });
});
