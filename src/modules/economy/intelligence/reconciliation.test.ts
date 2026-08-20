import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CREDIT_RATE_CARDS } from "@/modules/credits/rating";
import { VERCEL_FUNCTIONS_RATES, VERCEL_SANDBOX_RATES } from "../infrastructure-rates";
import type { SandboxUsage } from "../sandbox-cost";
import { REALISTIC_STEP_WORK } from "../workflow-invocation-cost";
import { deriveActualExecutionEconomics } from "./actual-economics";
import { resolveEconomyModel } from "./model-version";
import { estimateExecutionEconomics, type EstimateExecutionEconomicsInput } from "./pre-execution-estimate";
import { anthropicRates } from "./provider-rates";
import {
  type EconomicsComparison,
  compareEstimateToActual,
  reconcileExecutionEconomics,
} from "./reconciliation";

const AT = new Date("2026-08-21T00:00:00Z");
const MODEL = resolveEconomyModel(AT);
const POLICY = MODEL.adjustmentPolicy;

function estimateInput(overrides: Partial<EstimateExecutionEconomicsInput> = {}): EstimateExecutionEconomicsInput {
  return {
    at: AT,
    pricingClass: "standard",
    pricingClassReason: "single_surface",
    riskClass: "moderate",
    changeKind: "product_change",
    evidenceIds: ["live.seo.robots_meta_missing"],
    surfaces: ["public_pages"],
    repositoryContext: null,
    expectedValidationDepth: "standard",
    modelRates: anthropicRates("claude-sonnet-5", AT),
    economyModel: MODEL,
    ...overrides,
  };
}

function sandbox(overrides: Partial<SandboxUsage> = {}): SandboxUsage {
  return {
    purpose: "agent_execution",
    wallMs: 600_000,
    activeCpuMs: 120_000,
    vcpus: 4,
    vcpusBasis: "derived_from_configuration",
    creations: 1,
    outboundBytes: 0,
    snapshot: null,
    ...overrides,
  };
}

function actualCosting(providerCostNanoUsd: number | null) {
  return deriveActualExecutionEconomics({
    providerCostNanoUsd,
    agentSandbox: sandbox(),
    validationSandbox: sandbox({ purpose: "change_validation", wallMs: 210_000, activeCpuMs: 60_000 }),
    validationAttempted: true,
    workflowSteps: 30,
    rates: VERCEL_SANDBOX_RATES,
    functionsRates: VERCEL_FUNCTIONS_RATES,
    stepWork: REALISTIC_STEP_WORK,
  });
}

function comparison(relativeError: number, overrides: Partial<EconomicsComparison> = {}): EconomicsComparison {
  const predicted = 300_000_000;
  const difference = Math.round(predicted * relativeError);

  return {
    predictedNanoUsd: predicted,
    actualFloorNanoUsd: predicted + difference,
    differenceNanoUsd: difference,
    relativeError,
    comparable: true,
    incomparableReason: null,
    learningSignal: true,
    economyModelVersion: "economy-model.v1",
    ...overrides,
  };
}

describe("prediction is compared against reality", () => {
  it("reports the difference and the relative error", () => {
    const estimate = estimateExecutionEconomics(estimateInput());
    const actual = actualCosting(400_000_000);
    const result = compareEstimateToActual(estimate, actual);

    expect(result.comparable).toBe(true);
    expect(result.predictedNanoUsd).toBe(estimate.estimatedCost.known ? estimate.estimatedCost.nanoUsd : null);
    expect(result.actualFloorNanoUsd).toBe(actual.actualCost.knownFloorNanoUsd);
    expect(result.differenceNanoUsd).toBe(
      result.actualFloorNanoUsd - (result.predictedNanoUsd ?? 0),
    );
    expect(result.relativeError).toBeCloseTo(
      (result.differenceNanoUsd ?? 0) / (result.predictedNanoUsd ?? 1),
    );
  });

  it("calls an unpredicted run incomparable rather than infinitely wrong", () => {
    const estimate = estimateExecutionEconomics(
      estimateInput({ pricingClass: "complex", changeKind: "research", riskClass: "high", evidenceIds: ["nothing.like.this"] }),
    );
    const result = compareEstimateToActual(estimate, actualCosting(400_000_000));

    expect(result.comparable).toBe(false);
    expect(result.incomparableReason).toBe("prediction_unknown");
    expect(result.relativeError).toBeNull();
    expect(result.learningSignal).toBe(false);
  });

  it("refuses to learn from a cost that is only a floor", () => {
    const result = compareEstimateToActual(estimateExecutionEconomics(estimateInput()), actualCosting(null));

    expect(result.comparable).toBe(false);
    expect(result.incomparableReason).toBe("actual_incomplete");
    expect(result.learningSignal).toBe(false);
  });

  /**
   * An estimate made under v1 compared against costs incurred under v2's rate
   * assumptions measures the version change, not the prediction.
   */
  it("refuses to compare across economy model versions", () => {
    const result = compareEstimateToActual(
      estimateExecutionEconomics(estimateInput()),
      actualCosting(400_000_000),
      { actualEconomyModelVersion: "economy-model.v2" },
    );

    expect(result.comparable).toBe(false);
    expect(result.incomparableReason).toBe("model_version_mismatch");
  });

  it("still shows the difference on an incomparable pair, for a human reading one run", () => {
    const result = compareEstimateToActual(
      estimateExecutionEconomics(estimateInput()),
      actualCosting(400_000_000),
      { actualEconomyModelVersion: "economy-model.v2" },
    );

    expect(result.differenceNanoUsd).not.toBeNull();
    expect(result.learningSignal).toBe(false);
  });
});

/**
 * PART P #2. The estimator cannot see actuals, so no amount of reconciling can
 * reach back and change a prediction that was already made.
 */
describe("actual costs never rewrite a prediction", () => {
  it("re-estimates identically after a reconciliation", () => {
    const before = estimateExecutionEconomics(estimateInput());

    const comparisons = Array.from({ length: 30 }, () => comparison(0.4));
    const adjustment = reconcileExecutionEconomics({
      comparisons,
      policy: POLICY,
      modelVersion: "economy-model.v1",
    });

    expect(adjustment.adjustment).toBeGreaterThan(1);
    expect(estimateExecutionEconomics(estimateInput())).toEqual(before);
  });

  it("imports nothing from the actual-cost side", () => {
    const source = readFileSync(
      join(process.cwd(), "src/modules/economy/intelligence/pre-execution-estimate.ts"),
      "utf8",
    );

    expect(source).not.toContain("./actual-economics");
    expect(source).not.toContain("./reconciliation");
    expect(source).not.toContain("./learning-dataset");
  });
});

describe("an adjustment is a bounded proposal", () => {
  it("proposes nothing below the sample floor", () => {
    const adjustment = reconcileExecutionEconomics({
      comparisons: [comparison(0.4), comparison(0.35), comparison(0.5)],
      policy: POLICY,
      modelVersion: "economy-model.v1",
    });

    expect(adjustment.adjustment).toBe(1);
    expect(adjustment.reason).toBe("insufficient_samples");
    expect(adjustment.confidence).toBe("none");
  });

  it("proposes nothing when nothing was comparable", () => {
    const adjustment = reconcileExecutionEconomics({
      comparisons: [comparison(0.4, { comparable: false, incomparableReason: "actual_incomplete" })],
      policy: POLICY,
      modelVersion: "economy-model.v1",
    });

    expect(adjustment.adjustment).toBe(1);
    expect(adjustment.reason).toBe("no_comparable_observations");
    expect(adjustment.sampleSize).toBe(0);
  });

  it("raises when the estimator systematically under-predicts", () => {
    const adjustment = reconcileExecutionEconomics({
      comparisons: Array.from({ length: 25 }, () => comparison(0.13)),
      policy: POLICY,
      modelVersion: "economy-model.v1",
    });

    expect(adjustment.reason).toBe("systematically_under_predicted");
    expect(adjustment.adjustment).toBeCloseTo(1.13);
    expect(adjustment.clamped).toBe(false);
  });

  it("lowers when it systematically over-predicts", () => {
    const adjustment = reconcileExecutionEconomics({
      comparisons: Array.from({ length: 25 }, () => comparison(-0.12)),
      policy: POLICY,
      modelVersion: "economy-model.v1",
    });

    expect(adjustment.reason).toBe("systematically_over_predicted");
    expect(adjustment.adjustment).toBeCloseTo(0.88);
  });

  /**
   * A loop that can raise its own cost expectation by 3x in one round is not a
   * learning loop, it is an outage with a feedback path.
   */
  it("clamps a wild signal and says the bound decided it", () => {
    const adjustment = reconcileExecutionEconomics({
      comparisons: Array.from({ length: 25 }, () => comparison(3)),
      policy: POLICY,
      modelVersion: "economy-model.v1",
    });

    expect(adjustment.adjustment).toBe(POLICY.maxIncrease);
    expect(adjustment.clamped).toBe(true);
  });

  it("clamps in the cheap direction too", () => {
    const adjustment = reconcileExecutionEconomics({
      comparisons: Array.from({ length: 25 }, () => comparison(-0.9)),
      policy: POLICY,
      modelVersion: "economy-model.v1",
    });

    expect(adjustment.adjustment).toBe(POLICY.maxDecrease);
    expect(adjustment.clamped).toBe(true);
  });

  it("leaves an on-target estimator alone", () => {
    const adjustment = reconcileExecutionEconomics({
      comparisons: Array.from({ length: 25 }, () => comparison(0.01)),
      policy: POLICY,
      modelVersion: "economy-model.v1",
    });

    expect(adjustment.adjustment).toBe(1);
    expect(adjustment.reason).toBe("prediction_on_target");
  });

  /**
   * Median, not mean: one run that hit a provider outage and burned four times
   * its expected spend should not drag the correction for every run after it.
   */
  it("is not dragged by a single outlier", () => {
    const comparisons = [...Array.from({ length: 24 }, () => comparison(0.01)), comparison(8)];
    const adjustment = reconcileExecutionEconomics({
      comparisons,
      policy: POLICY,
      modelVersion: "economy-model.v1",
    });

    expect(adjustment.reason).toBe("prediction_on_target");
    expect(adjustment.adjustment).toBe(1);
  });

  it("ignores observations made under a different economy model version", () => {
    const adjustment = reconcileExecutionEconomics({
      comparisons: Array.from({ length: 25 }, () => comparison(0.4, { economyModelVersion: "economy-model.v0" })),
      policy: POLICY,
      modelVersion: "economy-model.v1",
    });

    expect(adjustment.sampleSize).toBe(0);
    expect(adjustment.adjustment).toBe(1);
  });

  it("activates nothing", () => {
    reconcileExecutionEconomics({
      comparisons: Array.from({ length: 25 }, () => comparison(0.4)),
      policy: POLICY,
      modelVersion: "economy-model.v1",
    });

    expect(CREDIT_RATE_CARDS).toEqual([]);
  });
});
