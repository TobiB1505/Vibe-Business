import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CONFIDENCE_LEVELS } from "./confidence";
import { resolveEconomyModel } from "./model-version";
import type { ExecutionEconomicsEstimate } from "./pre-execution-estimate";
import { deriveSafetyMargin } from "./safety-margin";

const POLICY = resolveEconomyModel(new Date("2026-08-21T00:00:00Z")).safetyPolicy;

function estimateWith(
  overrides: Partial<ExecutionEconomicsEstimate>,
): ExecutionEconomicsEstimate {
  return {
    pricingClass: "standard",
    pricingClassReason: "single_surface",
    estimatedCost: { known: true, nanoUsd: 300_000_000, basis: "estimated" },
    estimatedCostUpperNanoUsd: 340_000_000,
    confidence: {
      historicalData: "low",
      repositorySignal: "low",
      providerPricing: "high",
      overall: "low",
      sampleSize: 5,
    },
    costDrivers: [],
    reasons: [],
    economyModelVersion: "economy-model.v1",
    providerPricingVersion: "claude-sonnet-5-introductory-2026",
    repositorySignal: {
      measured: false,
      complexityIndex: null,
      multiplier: null,
      pressure: { candidatePressure: null, clipped: null, signal: "unknown" },
      reasons: ["not_measured"],
    },
    repositoryDrift: {
      changedFilesSinceLastExecution: null,
      changedBytesSinceLastExecution: null,
      newRelevantCandidates: null,
      changedRoutes: null,
      driftLevel: "unknown",
      measurable: [],
      largestRelativeChange: null,
    },
    historicalExpectation: {
      matches: [],
      expectedFloorNanoUsd: 300_000_000,
      expectedUpperNanoUsd: 340_000_000,
      basis: "class_matched",
      sampleSize: 5,
      confidence: "low",
    },
    cohortCorrection: 1,
    provenance: {
      hadHistoricalNeighbours: true,
      hadRepositoryContext: false,
      hadRepositoryDrift: false,
      hadValidationDepth: true,
      hadModelRates: true,
    },
    ...overrides,
  };
}

describe("a protected cost is a plan against risk, not a prediction", () => {
  it("buffers a low-confidence estimate by the policy's low-confidence fraction", () => {
    const margin = deriveSafetyMargin(estimateWith({}), POLICY);

    expect(margin.riskBufferFraction).toBe(POLICY.bufferByConfidence.low);
    expect(margin.protectedCostNanoUsd).toBe(Math.round(300_000_000 * (1 + POLICY.bufferByConfidence.low)));
    expect(margin.basis).toBe("low");
  });

  /** PART P #12. A buffer that could shrink the plan is not a buffer. */
  it("never sits below the estimate, at any confidence", () => {
    for (const level of CONFIDENCE_LEVELS) {
      const margin = deriveSafetyMargin(
        estimateWith({
          confidence: {
            historicalData: level,
            repositorySignal: level,
            providerPricing: level,
            overall: level,
            sampleSize: 5,
          },
        }),
        POLICY,
      );

      expect(margin.protectedCostNanoUsd ?? 0, level).toBeGreaterThanOrEqual(margin.expectedNanoUsd ?? 0);
    }
  });

  it("buffers less as evidence accumulates", () => {
    const buffers = CONFIDENCE_LEVELS.map(
      (level) =>
        deriveSafetyMargin(
          estimateWith({
            confidence: {
              historicalData: level,
              repositorySignal: level,
              providerPricing: level,
              overall: level,
              sampleSize: 5,
            },
          }),
          POLICY,
        ).riskBufferFraction,
    );

    // CONFIDENCE_LEVELS runs none -> high, so the buffers must fall.
    for (const [index, buffer] of buffers.entries()) {
      const next = buffers[index + 1];
      if (next === undefined) continue;
      expect(buffer).toBeGreaterThanOrEqual(next);
    }
  });

  it("respects the policy ceiling and says when it bound the answer", () => {
    const tight = { bufferByConfidence: { none: 4, low: 4, medium: 4, high: 4 }, maxBufferFraction: 0.2 };
    const margin = deriveSafetyMargin(estimateWith({}), tight);

    expect(margin.riskBufferFraction).toBe(0.2);
    expect(margin.clamped).toBe(true);
  });
});

describe("an unknown estimate buys no protection", () => {
  /**
   * A buffer applied to nothing is a number invented out of an absence. `0.3`
   * of an unknown is not `$0.00 * 1.3`; it is still unknown.
   */
  it("stays null rather than buffering zero", () => {
    const margin = deriveSafetyMargin(
      estimateWith({ estimatedCost: { known: false, reason: "not_measured" } }),
      POLICY,
    );

    expect(margin.expectedNanoUsd).toBeNull();
    expect(margin.protectedCostNanoUsd).toBeNull();
    // The buffer it *would* have used is still reported, so a reader can see
    // how little the answer would have been trusted.
    expect(margin.riskBufferFraction).toBe(POLICY.bufferByConfidence.low);
  });
});

describe("the protected cost is internal", () => {
  /**
   * The buffer exists because Vibe is unsure. Charging a customer for Vibe's
   * uncertainty is a pricing decision nobody has made.
   */
  it("is never read by the customer-facing quote simulation", () => {
    const source = readFileSync(
      join(process.cwd(), "src/modules/economy/intelligence/quote-simulation.ts"),
      "utf8",
    );
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

    expect(code).not.toContain("safety-margin");
    expect(code).not.toContain("protectedCost");
    expect(code).not.toContain("SafetyMargin");
  });
});
