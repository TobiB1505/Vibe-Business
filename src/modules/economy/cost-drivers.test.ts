import { describe, expect, it } from "vitest";
import { deriveRunEconomics } from "./run-economics";
import {
  briefWasClipped,
  deriveCostDrivers,
  type RepositoryContextSize,
} from "./cost-drivers";

/**
 * Cost-driver attribution (Sprint 0053).
 *
 * The property that matters most here is a *negative* one: repository size must
 * never enter the share denominator. It is the driver of the model share, not a
 * component beside it, and counting it as a slice would double-count the model
 * spend the provider already billed. That mistake is easy to make, invisible in
 * a chart, and would understate the one component that dominates every run in
 * Vibe's history — so it is pinned as a number rather than left to a comment.
 */

const RATE = { label: "test rate", nanoUsdPerMs: 1_000 };

/** Run #9's real shape: $0.3115 model, agent VM 19.5ms-equivalent, validation floor. */
function economics(overrides: Partial<Parameters<typeof deriveRunEconomics>[0]> = {}) {
  return deriveRunEconomics({
    providerCostNanoUsd: 311_500_000,
    agentSandboxMs: 19_500,
    validationSandboxMs: 16_000,
    validationAttempted: true,
    assumption: RATE,
    ...overrides,
  });
}

const SIZE: RepositoryContextSize = {
  treeEntries: 1_420,
  filesAnalyzed: 37,
  bytesAnalyzed: 412_000,
  routesDetected: 26,
  surfacesDetected: 4,
  candidatesAvailable: 19,
  candidatesSent: 12,
};

describe("repository size is a correlate, never a fourth share", () => {
  /**
   * The double-counting test. If someone later adds repository size as a
   * component, this number moves and they have to argue for it.
   */
  it("leaves the denominator exactly the three metered components", () => {
    const result = deriveCostDrivers({ economics: economics(), repositoryContext: SIZE });

    expect(result.attributedNanoUsd).toBe(311_500_000 + 16_000_000 + 19_500_000);
    expect(Object.keys(result.shares).sort()).toEqual([
      "infrastructure",
      "model",
      "validation",
    ]);
  });

  it("produces identical shares with and without repository size", () => {
    const withSize = deriveCostDrivers({ economics: economics(), repositoryContext: SIZE });
    const without = deriveCostDrivers({ economics: economics(), repositoryContext: null });

    expect(withSize.shares).toEqual(without.shares);
    expect(withSize.attributedNanoUsd).toBe(without.attributedNanoUsd);
    // Carried, not counted.
    expect(withSize.repositoryContext).toEqual(SIZE);
    expect(without.repositoryContext).toBeNull();
  });

  it("sums the known shares to one", () => {
    const result = deriveCostDrivers({ economics: economics() });
    const total = Object.values(result.shares).reduce((sum, share) => sum + share, 0);

    expect(total).toBeCloseTo(1, 12);
  });

  /** The finding this module was built to make visible. */
  it("puts the model share above 85% on run #9's real numbers", () => {
    const result = deriveCostDrivers({ economics: economics(), repositoryContext: SIZE });

    expect(result.shares.model).toBeGreaterThan(0.85);
  });
});

describe("an unpriced component is named, never treated as free", () => {
  it("excludes it from the denominator and says why", () => {
    const result = deriveCostDrivers({
      economics: economics({ assumption: undefined }),
    });

    // Only the model spend is known, so the split is over the model spend alone
    // — which is exactly the reading that would be dishonest if presented as
    // "infrastructure is 0% of cost".
    expect(result.attributedNanoUsd).toBe(311_500_000);
    expect(result.shares).toEqual({ model: 1 });
    expect(result.unattributed).toEqual([
      { component: "validation", reason: "no_price_available" },
      { component: "infrastructure", reason: "no_price_available" },
    ]);
  });

  it("distinguishes a stage that did not run from one that was not measured", () => {
    const result = deriveCostDrivers({
      economics: economics({ validationSandboxMs: null, validationAttempted: false }),
    });

    expect(result.unattributed).toEqual([
      { component: "validation", reason: "stage_not_run" },
    ]);
    expect(result.validationNanoUsd).toBeNull();
  });

  it("returns no shares at all when nothing could be priced", () => {
    const result = deriveCostDrivers({
      economics: deriveRunEconomics({
        providerCostNanoUsd: null,
        agentSandboxMs: null,
        validationSandboxMs: null,
        validationAttempted: false,
      }),
    });

    expect(result.attributedNanoUsd).toBe(0);
    // Not `{model: 0, validation: 0, infrastructure: 0}` — a zero share reads
    // as "this component cost nothing", which is a different claim.
    expect(result.shares).toEqual({});
    expect(result.unattributed).toHaveLength(3);
  });
});

describe("whether the brief was clipped", () => {
  it("is true when the compiler had more than it sent", () => {
    expect(briefWasClipped(SIZE)).toBe(true);
  });

  it("is false when the repository simply offered no more", () => {
    expect(briefWasClipped({ ...SIZE, candidatesAvailable: 12, candidatesSent: 12 })).toBe(false);
  });

  /**
   * The distinction the whole metric exists for. Run #9 sent 12 of a cap of 12
   * and nothing recorded how many it had — so the honest answer to "was it
   * clipped?" is "unanswerable", never "no".
   */
  it("is unanswerable, not false, for a run recorded before the metric existed", () => {
    expect(briefWasClipped({ ...SIZE, candidatesAvailable: null })).toBeNull();
    expect(briefWasClipped(null)).toBeNull();
  });
});
