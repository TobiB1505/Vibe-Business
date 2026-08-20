import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CREDIT_RATE_CARD_SCENARIOS } from "../credit-rate-card";
import type { RepositoryContextSize } from "../cost-drivers";
import { resolveEconomyModel } from "./model-version";
import {
  type EstimateExecutionEconomicsInput,
  estimateExecutionEconomics,
} from "./pre-execution-estimate";
import { anthropicRates } from "./provider-rates";
import { simulatePreRunQuote } from "./quote-simulation";
import { deriveRepositoryDrift } from "./repository-drift";

const AT = new Date("2026-08-21T00:00:00Z");
const MODEL = resolveEconomyModel(AT);
const RATES = anthropicRates("claude-sonnet-5", AT);

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

/** The step runs #3-#6 and #9 executed, as it would be seen before execution. */
function seoMetadata(
  overrides: Partial<EstimateExecutionEconomicsInput> = {},
): EstimateExecutionEconomicsInput {
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
    modelRates: RATES,
    economyModel: MODEL,
    ...overrides,
  };
}

describe("an estimate sees only what exists before the run", () => {
  /**
   * PART P's central guard. A quote computed from a run's own outcome is a
   * bill, and an estimator that *can* reach actuals will eventually be
   * "improved" into one — at which point the prediction-versus-reality
   * comparison compares a number against itself and reports perfect accuracy
   * forever.
   */
  it("never references a measured run quantity", () => {
    const source = readFileSync(
      join(process.cwd(), "src/modules/economy/intelligence/pre-execution-estimate.ts"),
      "utf8",
    );
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

    for (const forbidden of [
      "inputTokens",
      "outputTokens",
      "thinkingTokens",
      "durationMs",
      "activeCpuMs",
      "sandboxDurationMs",
      "ai_usage_events",
      "sandbox_usage_events",
      "actualCost",
    ]) {
      expect(code, `forbidden input: ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("reads no clock and rolls no dice", () => {
    const source = readFileSync(
      join(process.cwd(), "src/modules/economy/intelligence/pre-execution-estimate.ts"),
      "utf8",
    );
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

    expect(code).not.toContain("Date.now(");
    expect(code).not.toContain("Math.random(");
    expect(code).not.toMatch(/new Date\(\s*\)/);
  });

  /** PART P #1. */
  it("produces the same estimate for the same inputs", () => {
    expect(estimateExecutionEconomics(seoMetadata())).toEqual(estimateExecutionEconomics(seoMetadata()));
  });

  it("stamps the model version and provider pricing version it used", () => {
    const estimate = estimateExecutionEconomics(seoMetadata());

    expect(estimate.economyModelVersion).toBe("economy-model.v1");
    expect(estimate.providerPricingVersion).toBe("claude-sonnet-5-introductory-2026");
  });
});

describe("the historical baseline is what makes an estimate possible", () => {
  it("estimates in the region its neighbours cost", () => {
    const estimate = estimateExecutionEconomics(seoMetadata());

    if (!estimate.estimatedCost.known) throw new Error("expected a priced estimate");
    expect(estimate.estimatedCost.basis).toBe("estimated");
    expect(estimate.estimatedCost.nanoUsd).toBeGreaterThan(150_000_000);
    expect(estimate.estimatedCost.nanoUsd).toBeLessThan(500_000_000);
    expect(estimate.reasons).toContain("historical_neighbours");
  });

  /** PART P #8. */
  it("stays unknown when nothing comparable has ever run", () => {
    const estimate = estimateExecutionEconomics(
      seoMetadata({
        pricingClass: "complex",
        changeKind: "research",
        riskClass: "high",
        evidenceIds: ["nothing.like.this"],
        modelRates: null,
      }),
    );

    expect(estimate.estimatedCost).toEqual({ known: false, reason: "not_measured" });
    expect(estimate.estimatedCostUpperNanoUsd).toBeNull();
    expect(estimate.reasons).toContain("no_comparable_runs");
    expect(estimate.confidence.overall).toBe("none");
  });

  it("never reports an unknown estimate as zero", () => {
    const estimate = estimateExecutionEconomics(
      seoMetadata({ evidenceIds: ["nothing.like.this"], pricingClass: "complex", changeKind: "research", riskClass: "high" }),
    );

    expect(estimate.estimatedCost.known).toBe(false);
    expect(JSON.stringify(estimate.estimatedCost)).not.toContain("nanoUsd");
  });
});

describe("repository context moves an estimate without becoming one", () => {
  /** PART P #3. */
  it("estimates more for a larger, more pressured repository", () => {
    const plain = estimateExecutionEconomics(seoMetadata({ repositoryContext: size({ treeEntries: 1_200, routesDetected: 30, candidatesAvailable: 12, candidatesSent: 12 }) }));
    const large = estimateExecutionEconomics(seoMetadata({ repositoryContext: size({ treeEntries: 40_000, routesDetected: 400, candidatesAvailable: 300, candidatesSent: 12 }) }));

    if (!plain.estimatedCost.known || !large.estimatedCost.known) throw new Error("both must be priced");
    expect(large.estimatedCost.nanoUsd).toBeGreaterThan(plain.estimatedCost.nanoUsd);
    expect(large.reasons).toContain("context_pressure_high");
  });

  /**
   * PART P #4. Repository size is a driver of work, not a line item. Without a
   * historical baseline there is nothing for it to scale, and no amount of
   * measuring the tree invents one.
   */
  it("produces no price from repository size alone", () => {
    const estimate = estimateExecutionEconomics(
      seoMetadata({
        pricingClass: "complex",
        changeKind: "research",
        riskClass: "high",
        evidenceIds: ["nothing.like.this"],
        repositoryContext: size({ treeEntries: 5_000_000, routesDetected: 40_000, candidatesAvailable: 90_000, candidatesSent: 12 }),
      }),
    );

    expect(estimate.repositorySignal.measured).toBe(true);
    expect(estimate.estimatedCost.known).toBe(false);
  });

  it("says the repository was unmeasured rather than assuming it was small", () => {
    const estimate = estimateExecutionEconomics(seoMetadata());

    expect(estimate.reasons).toContain("repository_unmeasured");
    expect(estimate.repositorySignal.multiplier).toBeNull();
    expect(estimate.provenance.hadRepositoryContext).toBe(false);
    expect(estimate.confidence.repositorySignal).toBe("none");
  });
});

describe("drift raises an estimate, and an unmeasured drift does not", () => {
  it("charges more after the repository moved substantially", () => {
    const stable = estimateExecutionEconomics(
      seoMetadata({ repositoryDrift: deriveRepositoryDrift(size({ candidatesAvailable: 6 }), size({ candidatesAvailable: 6 })) }),
    );
    const moved = estimateExecutionEconomics(
      seoMetadata({ repositoryDrift: deriveRepositoryDrift(size({ candidatesAvailable: 6 }), size({ candidatesAvailable: 12 })) }),
    );

    if (!stable.estimatedCost.known || !moved.estimatedCost.known) throw new Error("both must be priced");
    expect(moved.estimatedCost.nanoUsd).toBeGreaterThan(stable.estimatedCost.nanoUsd);
    expect(moved.reasons).toContain("repository_drift_high");
  });

  it("treats an unknown drift as no evidence, not as stability", () => {
    const unknownDrift = estimateExecutionEconomics(seoMetadata());
    const stable = estimateExecutionEconomics(
      seoMetadata({ repositoryDrift: deriveRepositoryDrift(size({ candidatesAvailable: 6 }), size({ candidatesAvailable: 6 })) }),
    );

    expect(unknownDrift.repositoryDrift.driftLevel).toBe("unknown");
    expect(unknownDrift.provenance.hadRepositoryDrift).toBe(false);
    if (!unknownDrift.estimatedCost.known || !stable.estimatedCost.known) throw new Error("both must be priced");
    expect(unknownDrift.estimatedCost.nanoUsd).toBe(stable.estimatedCost.nanoUsd);
  });
});

describe("validation depth moves only the validation share", () => {
  it("costs less at fast than at standard, but not proportionally less", () => {
    const standard = estimateExecutionEconomics(seoMetadata({ expectedValidationDepth: "standard" }));
    const fast = estimateExecutionEconomics(seoMetadata({ expectedValidationDepth: "fast" }));

    if (!standard.estimatedCost.known || !fast.estimatedCost.known) throw new Error("both must be priced");
    expect(fast.estimatedCost.nanoUsd).toBeLessThan(standard.estimatedCost.nanoUsd);

    // The wall-time ratio is ~0.71; scaling the whole estimate by it would
    // reprice the model spend because the test suite got shorter.
    const ratio = fast.estimatedCost.nanoUsd / standard.estimatedCost.nanoUsd;
    expect(ratio).toBeGreaterThan(0.9);
  });

  it("says so when the depth is not yet resolved", () => {
    const estimate = estimateExecutionEconomics(seoMetadata({ expectedValidationDepth: null }));

    expect(estimate.reasons).toContain("validation_depth_unknown");
    expect(estimate.provenance.hadValidationDepth).toBe(false);
  });
});

describe("a cohort correction is applied without the estimator reading outcomes", () => {
  it("scales the estimate and records that it did", () => {
    const plain = estimateExecutionEconomics(seoMetadata());
    const corrected = estimateExecutionEconomics(seoMetadata({ cohortCorrection: 1.25 }));

    if (!plain.estimatedCost.known || !corrected.estimatedCost.known) throw new Error("both must be priced");
    expect(corrected.estimatedCost.nanoUsd).toBeGreaterThan(plain.estimatedCost.nanoUsd);
    expect(corrected.reasons).toContain("cohort_correction_applied");
    expect(corrected.cohortCorrection).toBe(1.25);
  });

  it("defaults to no correction", () => {
    expect(estimateExecutionEconomics(seoMetadata()).cohortCorrection).toBe(1);
  });
});

describe("a simulated quote is a simulation", () => {
  it("recommends no Credits without a named scenario", () => {
    const quote = simulatePreRunQuote(estimateExecutionEconomics(seoMetadata()));

    expect(quote.creditRecommendation).toBeNull();
    expect(quote.scenarioModel).toBeNull();
    expect(quote.activated).toBe(false);
  });

  it("names the hypothetical rate card whenever it quotes Credits", () => {
    const scenario = CREDIT_RATE_CARD_SCENARIOS.find((entry) => entry.model === "C");
    if (!scenario) throw new Error("scenario C missing");

    const quote = simulatePreRunQuote(estimateExecutionEconomics(seoMetadata()), scenario);

    expect(quote.creditRecommendation).toBe(scenario.creditsByClass.standard);
    expect(quote.scenarioModel).toBe("C");
  });

  /**
   * Credits price a class, not a run. A cost-derived Credit figure would have
   * moved 2.16x between run #6 and run #9 for a byte-identical step.
   */
  it("quotes the same Credits for the same class however the cost moved", () => {
    const scenario = CREDIT_RATE_CARD_SCENARIOS.find((entry) => entry.model === "C");
    if (!scenario) throw new Error("scenario C missing");

    const cheap = simulatePreRunQuote(estimateExecutionEconomics(seoMetadata()), scenario);
    const expensive = simulatePreRunQuote(
      estimateExecutionEconomics(
        seoMetadata({ repositoryContext: size({ treeEntries: 40_000, routesDetected: 400, candidatesAvailable: 300, candidatesSent: 12 }) }),
      ),
      scenario,
    );

    expect(expensive.expectedCostNanoUsd ?? 0).toBeGreaterThan(cheap.expectedCostNanoUsd ?? 0);
    expect(expensive.creditRecommendation).toBe(cheap.creditRecommendation);
  });

  it("carries its confidence and its sample size, always", () => {
    const quote = simulatePreRunQuote(estimateExecutionEconomics(seoMetadata()));

    expect(quote.confidence.overall).toBeDefined();
    expect(quote.confidence.sampleSize).toBeGreaterThan(0);
  });

  it("labels an unknown cost as unknown, with the reason", () => {
    const quote = simulatePreRunQuote(
      estimateExecutionEconomics(
        seoMetadata({ pricingClass: "complex", changeKind: "research", riskClass: "high", evidenceIds: ["nothing.like.this"] }),
      ),
    );

    expect(quote.expectedCostNanoUsd).toBeNull();
    expect(quote.expectedCostLabel).toContain("unknown");
    expect(quote.expectedCostLabel).toContain("not_measured");
  });
});
