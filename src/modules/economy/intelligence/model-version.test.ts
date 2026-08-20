import { describe, expect, it } from "vitest";
import { VALIDATION_DEPTHS, stepsForDepth } from "@/modules/validation/depth";
import {
  ECONOMY_MODEL_VERSIONS,
  UnversionedEconomyError,
  economyModelByVersion,
  resolveEconomyModel,
} from "./model-version";

describe("economy model versions", () => {
  it("resolves the version effective at an instant", () => {
    const version = resolveEconomyModel(new Date("2026-08-21T00:00:00Z"));

    expect(version.version).toBe("economy-model.v1");
  });

  it("refuses an instant before any version existed", () => {
    // A silent fallback to the newest would let an estimate be made under
    // assumptions that did not exist when it was made.
    expect(() => resolveEconomyModel(new Date("2020-01-01T00:00:00Z"))).toThrow(UnversionedEconomyError);
  });

  it("uses half-open intervals, like every other price layer", () => {
    for (const version of ECONOMY_MODEL_VERSIONS) {
      const from = new Date(version.effectiveFrom);
      expect(resolveEconomyModel(from).version).toBe(version.version);

      if (version.effectiveTo !== null) {
        const to = new Date(version.effectiveTo);
        expect(resolveEconomyModel(to).version).not.toBe(version.version);
      }
    }
  });

  it("never leaves two versions effective at once", () => {
    const sorted = [...ECONOMY_MODEL_VERSIONS].sort(
      (a, b) => Date.parse(a.effectiveFrom) - Date.parse(b.effectiveFrom),
    );

    for (const [index, version] of sorted.entries()) {
      const next = sorted[index + 1];
      if (!next) {
        continue;
      }
      expect(version.effectiveTo).not.toBeNull();
      expect(Date.parse(version.effectiveTo ?? "")).toBeLessThanOrEqual(Date.parse(next.effectiveFrom));
    }
  });
});

/**
 * PART P #7 — an old version must stay reproducible. These are the exact
 * assumptions every estimate stamped `economy-model.v1` was made under; if a
 * later sprint wants different ones it issues v2 rather than editing this.
 */
describe("economy-model.v1 is pinned", () => {
  const v1 = economyModelByVersion("economy-model.v1");

  it("exists", () => {
    expect(v1).not.toBeNull();
  });

  it("holds the assumptions it was issued with", () => {
    expect(v1).toMatchObject({
      version: "economy-model.v1",
      effectiveFrom: "2026-08-20T00:00:00Z",
      marginTarget: 0.75,
      infrastructurePricingVersion: "vercel-sandbox-2026-08-20",
      assumedValidationCostShare: 0.15,
      repositoryPolicy: {
        referenceTreeEntries: 1_200,
        referenceRoutes: 30,
        referenceCandidates: 12,
        minMultiplier: 0.75,
        maxMultiplier: 1.75,
        sensitivity: 0.25,
      },
      adjustmentPolicy: { maxIncrease: 1.25, maxDecrease: 0.8, minSamples: 20 },
      safetyPolicy: {
        bufferByConfidence: { none: 0.5, low: 0.3, medium: 0.15, high: 0.05 },
        maxBufferFraction: 0.5,
      },
    });
  });

  it("returns null for a version that was never issued", () => {
    expect(economyModelByVersion("economy-model.v99")).toBeNull();
  });
});

describe("the validation assumptions match the depths they claim to describe", () => {
  it("covers every depth", () => {
    const v1 = resolveEconomyModel(new Date("2026-08-21T00:00:00Z"));

    for (const depth of VALIDATION_DEPTHS) {
      expect(v1.validationAssumptions[depth]).toBeDefined();
    }
  });

  /**
   * The step counts are copied into the version so it is self-contained. A copy
   * that drifts from `stepsForDepth` would make the estimate describe a
   * validation that does not happen.
   */
  it("copies step counts that still match stepsForDepth", () => {
    const v1 = resolveEconomyModel(new Date("2026-08-21T00:00:00Z"));

    for (const depth of VALIDATION_DEPTHS) {
      expect(v1.validationAssumptions[depth].expectedSteps, depth).toBe(stepsForDepth(depth).length);
    }
  });

  it("labels every duration as an assumption", () => {
    const v1 = resolveEconomyModel(new Date("2026-08-21T00:00:00Z"));

    for (const depth of VALIDATION_DEPTHS) {
      expect(v1.validationAssumptions[depth].label, depth).toMatch(/assumed/);
      expect(v1.validationAssumptions[depth].expectedWallMs).toBeGreaterThan(0);
    }
  });
});
