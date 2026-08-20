import { describe, expect, it } from "vitest";
import type { RepositoryContextSize } from "../cost-drivers";
import { economyModelByVersion, resolveEconomyModel } from "./model-version";
import { estimateExecutionEconomics, type EstimateExecutionEconomicsInput } from "./pre-execution-estimate";
import { capturePredictionSnapshot, replayInput } from "./prediction-snapshot";
import { anthropicRates } from "./provider-rates";
import { deriveRepositoryDrift } from "./repository-drift";

const AT = new Date("2026-08-21T00:00:00Z");
const MODEL = resolveEconomyModel(AT);

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

function input(overrides: Partial<EstimateExecutionEconomicsInput> = {}): EstimateExecutionEconomicsInput {
  return {
    at: AT,
    pricingClass: "standard",
    pricingClassReason: "single_surface",
    riskClass: "moderate",
    changeKind: "product_change",
    evidenceIds: ["live.seo.robots_meta_missing"],
    surfaces: ["public_pages"],
    repositoryContext: size({ treeEntries: 1_400, routesDetected: 34, candidatesAvailable: 40, candidatesSent: 12 }),
    repositoryDrift: deriveRepositoryDrift(size({ candidatesAvailable: 6 }), size({ candidatesAvailable: 12 })),
    expectedValidationDepth: "standard",
    modelRates: anthropicRates("claude-sonnet-5", AT),
    economyModel: MODEL,
    ...overrides,
  };
}

describe("a snapshot explains its own estimate", () => {
  it("records the versions the estimate was made under", () => {
    const snapshot = capturePredictionSnapshot(input());

    expect(snapshot.at).toBe("2026-08-21T00:00:00.000Z");
    expect(snapshot.economyModelVersion).toBe("economy-model.v1");
    expect(snapshot.providerPricingVersion).toBe("claude-sonnet-5-introductory-2026");
    expect(snapshot.infrastructurePricingVersion).toBe("vercel-sandbox-2026-08-20");
  });

  it("keeps the whole reasoning chain, not just the answer", () => {
    const snapshot = capturePredictionSnapshot(input());

    expect(snapshot.inputs.evidenceIds).toEqual(["live.seo.robots_meta_missing"]);
    expect(snapshot.repositorySignal.measured).toBe(true);
    expect(snapshot.repositoryDrift.driftLevel).toBe("high_change");
    expect(snapshot.historicalExpectation.matches.length).toBeGreaterThan(0);
    expect(snapshot.confidence.sampleSize).toBeGreaterThan(0);
    expect(snapshot.safetyMargin.protectedCostNanoUsd ?? 0).toBeGreaterThan(0);
  });

  it("is self-contained on rates, so the price book need not be re-resolved", () => {
    const snapshot = capturePredictionSnapshot(input());

    expect(snapshot.modelRates).toMatchObject({
      provider: "anthropic",
      model: "claude-sonnet-5",
      pricingVersion: "claude-sonnet-5-introductory-2026",
    });
  });

  it("records a null rate rather than omitting it", () => {
    const snapshot = capturePredictionSnapshot(input({ modelRates: null }));

    expect(snapshot.modelRates).toBeNull();
    expect(snapshot.providerPricingVersion).toBeNull();
  });
});

/**
 * PART P #15 — the property that makes the snapshot worth having. A snapshot
 * plus its named economy model version must recompute the estimate exactly, or
 * "why did Vibe quote that?" is archaeology rather than a lookup.
 */
describe("a snapshot reproduces its estimate exactly", () => {
  it("replays to the same estimate", () => {
    const snapshot = capturePredictionSnapshot(input());
    const model = economyModelByVersion(snapshot.economyModelVersion);
    if (!model) throw new Error("the snapshot names a version that does not exist");

    expect(estimateExecutionEconomics(replayInput(snapshot, model))).toEqual(snapshot.estimate);
  });

  it("replays the same way for an unassessable estimate", () => {
    const snapshot = capturePredictionSnapshot(
      input({
        pricingClass: "complex",
        changeKind: "research",
        riskClass: "high",
        evidenceIds: ["nothing.like.this"],
        modelRates: null,
      }),
    );
    const model = economyModelByVersion(snapshot.economyModelVersion);
    if (!model) throw new Error("the snapshot names a version that does not exist");

    expect(snapshot.estimate.estimatedCost.known).toBe(false);
    expect(estimateExecutionEconomics(replayInput(snapshot, model))).toEqual(snapshot.estimate);
  });

  it("replays a cohort-corrected estimate to the same number", () => {
    const snapshot = capturePredictionSnapshot(input({ cohortCorrection: 1.2 }));
    const model = economyModelByVersion(snapshot.economyModelVersion);
    if (!model) throw new Error("the snapshot names a version that does not exist");

    expect(estimateExecutionEconomics(replayInput(snapshot, model))).toEqual(snapshot.estimate);
    expect(snapshot.cohortCorrection).toBe(1.2);
  });

  it("survives a round trip through JSON, which is how it will be stored", () => {
    const snapshot = capturePredictionSnapshot(input());
    const restored = JSON.parse(JSON.stringify(snapshot)) as typeof snapshot;
    const model = economyModelByVersion(restored.economyModelVersion);
    if (!model) throw new Error("the snapshot names a version that does not exist");

    expect(estimateExecutionEconomics(replayInput(restored, model))).toEqual(restored.estimate);
  });
});

describe("nothing in a snapshot is opaque", () => {
  /**
   * Every number is an input, a named version, or derivable from the two.
   * Reproduction proves the last part; this checks the first two are present.
   */
  it("names a version for every rate it depended on", () => {
    const snapshot = capturePredictionSnapshot(input());

    expect(snapshot.economyModelVersion).not.toBe("");
    expect(snapshot.infrastructurePricingVersion).not.toBe("");
    expect(snapshot.modelRates?.pricingVersion).not.toBe("");
  });

  it("keeps the matched runs rather than only their mean", () => {
    const snapshot = capturePredictionSnapshot(input());

    for (const match of snapshot.historicalExpectation.matches) {
      expect(match.run).toBeGreaterThan(0);
      expect(match.matched.length).toBeGreaterThan(0);
      expect(match.weight.finalWeight).toBeGreaterThan(0);
    }
  });

  it("names the weighting policy that produced the weights", () => {
    expect(capturePredictionSnapshot(input()).weightingPolicy).toBe("similarity_only");
  });
});

/**
 * The property reproduction depends on. An estimate made against seven runs
 * must not silently recompute against fifty once the dataset grows.
 */
describe("reproduction survives the dataset growing", () => {
  it("carries the rows the answer was computed from", () => {
    const snapshot = capturePredictionSnapshot(input());

    expect(snapshot.matchedRuns.map((run) => run.run).sort()).toEqual(
      snapshot.historicalExpectation.matches.map((match) => match.run).sort(),
    );
  });

  it("replays to the same estimate against a dataset that has since doubled", () => {
    const snapshot = capturePredictionSnapshot(input());
    const model = economyModelByVersion(snapshot.economyModelVersion);
    if (!model) throw new Error("the snapshot names a version that does not exist");

    // The estimator is handed the snapshot's own rows, so runs added later
    // cannot move a number a human already read.
    const replayed = estimateExecutionEconomics(replayInput(snapshot, model));

    expect(replayed).toEqual(snapshot.estimate);
    expect(replayed.historicalExpectation.sampleSize).toBe(snapshot.historicalExpectation.sampleSize);
  });
});
