import { describe, expect, it } from "vitest";
import type { RepositoryContextSize } from "../cost-drivers";
import { deriveContextPressure } from "./context-pressure";

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

describe("context pressure measures what did not fit", () => {
  it("is 1 when everything relevant was sent", () => {
    const pressure = deriveContextPressure(size({ candidatesAvailable: 6, candidatesSent: 6 }));

    expect(pressure.candidatePressure).toBe(1);
    expect(pressure.clipped).toBe(false);
    expect(pressure.signal).toBe("unclipped");
  });

  /**
   * The case size alone cannot see: 200 relevant candidates against a cap of
   * 12 looks identical to 12-of-12 on `candidatesSent`.
   */
  it("is severe when most of what mattered was discarded", () => {
    const pressure = deriveContextPressure(size({ candidatesAvailable: 200, candidatesSent: 12 }));

    expect(pressure.candidatePressure).toBeCloseTo(200 / 12);
    expect(pressure.clipped).toBe(true);
    expect(pressure.signal).toBe("severe");
  });

  it("is moderate for a mild overflow", () => {
    const pressure = deriveContextPressure(size({ candidatesAvailable: 18, candidatesSent: 12 }));

    expect(pressure.signal).toBe("moderate");
  });
});

describe("an unanswerable pressure stays unanswered", () => {
  it("is null when the run recorded no size at all", () => {
    const pressure = deriveContextPressure(null);

    expect(pressure.candidatePressure).toBeNull();
    expect(pressure.clipped).toBeNull();
    expect(pressure.signal).toBe("unknown");
  });

  /**
   * A run from before Sprint 0053 has `candidatesSent` and no
   * `candidatesAvailable`. Returning 1 there would claim nothing was
   * discarded — the one conclusion the data cannot support.
   */
  it("is null, not 1, when only the sent side was recorded", () => {
    const pressure = deriveContextPressure(size({ candidatesAvailable: null, candidatesSent: 12 }));

    expect(pressure.candidatePressure).toBeNull();
    expect(pressure.signal).toBe("unknown");
  });

  it("does not divide by a brief that carried nothing", () => {
    const pressure = deriveContextPressure(size({ candidatesAvailable: 40, candidatesSent: 0 }));

    expect(pressure.candidatePressure).toBeNull();
    expect(Number.isFinite(pressure.candidatePressure ?? 0)).toBe(true);
  });
});
