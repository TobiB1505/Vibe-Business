import { describe, expect, it } from "vitest";
import type { RepositoryContextSize } from "../cost-drivers";
import { NO_PRIOR_EXECUTION, deriveRepositoryDrift } from "./repository-drift";

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

describe("drift measures movement, not size", () => {
  it("calls an unchanged repository stable", () => {
    const drift = deriveRepositoryDrift(
      size({ filesAnalyzed: 40, bytesAnalyzed: 100_000, candidatesAvailable: 6, routesDetected: 30 }),
      size({ filesAnalyzed: 40, bytesAnalyzed: 100_000, candidatesAvailable: 6, routesDetected: 30 }),
    );

    expect(drift.driftLevel).toBe("stable");
    expect(drift.changedFilesSinceLastExecution).toBe(0);
    expect(drift.measurable).toEqual(["files", "bytes", "candidates", "routes"]);
  });

  /**
   * The run this file exists because of. Run #6 and run #9 executed the same
   * step at the same pricing class; the candidate list went 6 -> 12 and model
   * spend went $0.1444 -> $0.3115. Complexity at either commit looked ordinary;
   * the delta is what explains it.
   */
  it("sees the run #6 to #9 movement that complexity alone could not", () => {
    const drift = deriveRepositoryDrift(
      size({ candidatesAvailable: 6 }),
      size({ candidatesAvailable: 12 }),
    );

    expect(drift.newRelevantCandidates).toBe(6);
    expect(drift.driftLevel).toBe("high_change");
    expect(drift.measurable).toEqual(["candidates"]);
    expect(drift.largestRelativeChange).toBeCloseTo(1);
  });

  it("separates a mild change from a heavy one", () => {
    const mild = deriveRepositoryDrift(size({ filesAnalyzed: 100 }), size({ filesAnalyzed: 108 }));
    const heavy = deriveRepositoryDrift(size({ filesAnalyzed: 100 }), size({ filesAnalyzed: 180 }));

    expect(mild.driftLevel).toBe("changed");
    expect(heavy.driftLevel).toBe("high_change");
  });

  it("counts shrinking as movement too", () => {
    const drift = deriveRepositoryDrift(size({ filesAnalyzed: 200 }), size({ filesAnalyzed: 100 }));

    expect(drift.changedFilesSinceLastExecution).toBe(-100);
    expect(drift.driftLevel).toBe("high_change");
  });
});

/**
 * PART P #11. `stable` is a claim that the repository did not move. Two nulls
 * support no such claim — they say nobody looked.
 */
describe("an unmeasured axis is never called stable", () => {
  it("is unknown when neither side recorded anything", () => {
    const drift = deriveRepositoryDrift(null, null);

    expect(drift.driftLevel).toBe("unknown");
    expect(drift.measurable).toEqual([]);
    expect(drift.largestRelativeChange).toBeNull();
  });

  it("is unknown when only one side was measured", () => {
    const drift = deriveRepositoryDrift(null, size({ filesAnalyzed: 40, candidatesAvailable: 12 }));

    expect(drift.driftLevel).toBe("unknown");
    expect(drift.changedFilesSinceLastExecution).toBeNull();
    expect(drift.measurable).toEqual([]);
  });

  it("reports only the axes both sides recorded", () => {
    const drift = deriveRepositoryDrift(
      size({ filesAnalyzed: 40, candidatesAvailable: 6 }),
      size({ filesAnalyzed: 41 }),
    );

    expect(drift.measurable).toEqual(["files"]);
    expect(drift.newRelevantCandidates).toBeNull();
  });

  it("distinguishes no prior execution from a comparison that found nothing", () => {
    expect(NO_PRIOR_EXECUTION.driftLevel).toBe("unknown");
    expect(NO_PRIOR_EXECUTION.measurable).toEqual([]);
  });
});

describe("growth from nothing is movement without a ratio", () => {
  it("counts as high change rather than as infinite or zero", () => {
    const drift = deriveRepositoryDrift(size({ candidatesAvailable: 0 }), size({ candidatesAvailable: 9 }));

    expect(drift.driftLevel).toBe("high_change");
    expect(Number.isFinite(drift.largestRelativeChange ?? 0)).toBe(true);
  });

  it("stays stable when zero stayed zero", () => {
    const drift = deriveRepositoryDrift(size({ candidatesAvailable: 0 }), size({ candidatesAvailable: 0 }));

    expect(drift.driftLevel).toBe("stable");
  });
});
