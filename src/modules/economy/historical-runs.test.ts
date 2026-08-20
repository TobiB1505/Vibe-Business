import { describe, expect, it } from "vitest";
import { HISTORICAL_CLASSIFICATIONS, HISTORICAL_RUNS } from "./historical-runs";

/**
 * Sprint 0052, PART D — pins the historical reconstruction so a future
 * change to the classifier or the evidence-surface mapping shows up as a
 * failing test here, not as a silently different table in a document.
 *
 * Sprint 0053 added run #9. Adding a run is deliberately mechanical and
 * deliberately pinned twice: once in the module, once here, so a transcription
 * slip fails a test instead of quietly repricing a tier.
 */

describe("the historical runs reconstruct as documented", () => {
  it("has exactly seven runs, #3 through #9, in creation order", () => {
    expect(HISTORICAL_RUNS.map((r) => r.run)).toEqual([3, 4, 5, 6, 7, 8, 9]);
    const createdAt = HISTORICAL_RUNS.map((r) => Date.parse(r.createdAt));
    expect([...createdAt].sort((a, b) => a - b)).toEqual(createdAt);
  });

  it("runs #3-6 and #9 all cite the same live.seo.robots_meta_missing evidence family", () => {
    for (const run of HISTORICAL_RUNS.filter((r) => [3, 4, 5, 6, 9].includes(r.run))) {
      expect(run.evidenceIds).toEqual(["live.seo.robots_meta_missing"]);
    }
  });

  it("run #7 cites live.seo.canonical_missing", () => {
    expect(HISTORICAL_RUNS.find((r) => r.run === 7)?.evidenceIds).toEqual(["live.seo.canonical_missing"]);
  });

  it("run #8 cites live.conversion.primary_cta and is marked limited confidence", () => {
    const run8 = HISTORICAL_RUNS.find((r) => r.run === 8)!;
    expect(run8.evidenceIds).toEqual(["live.conversion.primary_cta"]);
    expect(run8.classificationConfidence).toBe("limited");
  });

  it("every other run is marked confirmed confidence", () => {
    for (const run of HISTORICAL_RUNS.filter((r) => r.run !== 8)) {
      expect(run.classificationConfidence, `run #${run.run}`).toBe("confirmed");
    }
  });

  it("all seven runs share riskClass=moderate and changeKind=product_change — zero variance on those axes", () => {
    for (const run of HISTORICAL_RUNS) {
      expect(run.riskClass, `run #${run.run}`).toBe("moderate");
      expect(run.changeKind, `run #${run.run}`).toBe("product_change");
    }
  });
});

describe("v1 classification of the historical runs", () => {
  it("runs #3-7 and #9 (one named surface: seo_metadata) classify as standard", () => {
    for (const run of HISTORICAL_CLASSIFICATIONS.filter((r) => r.run !== 8)) {
      expect(run.pricingClass, `run #${run.run}`).toBe("standard");
      expect(run.surfaces, `run #${run.run}`).toEqual(["seo_metadata"]);
    }
  });

  it("run #8 (zero named surfaces) classifies as small", () => {
    const run8 = HISTORICAL_CLASSIFICATIONS.find((r) => r.run === 8)!;
    expect(run8.pricingClass).toBe("small");
    expect(run8.surfaces).toEqual([]);
  });

  it("no historical run reaches complex — the tier has zero empirical coverage in this dataset", () => {
    for (const run of HISTORICAL_CLASSIFICATIONS) {
      expect(run.pricingClass, `run #${run.run}`).not.toBe("complex");
    }
  });

  it("classification never reads cost, and is reproduced deterministically here from the same six runs", () => {
    // The reconstruction module never imports economic cost into the
    // classifier call — this test asserts the module boundary rather than
    // just re-running the function, by checking the classification result
    // carries no cost field at all.
    for (const run of HISTORICAL_CLASSIFICATIONS) {
      expect(run).not.toHaveProperty("economicCostFloorNanoUsd");
      expect(run).not.toHaveProperty("costNanoUsd");
    }
  });
});

describe("economic cost figures match ECONOMY_MODEL.md's PART I table exactly", () => {
  const expected: Record<number, { floor: number; upper: number }> = {
    3: { floor: 433_100_000, upper: 481_400_000 },
    4: { floor: 284_500_000, upper: 284_500_000 },
    5: { floor: 354_200_000, upper: 402_700_000 },
    6: { floor: 173_900_000, upper: 224_500_000 },
    7: { floor: 282_100_000, upper: 328_900_000 },
    8: { floor: 254_100_000, upper: 301_700_000 },
    9: { floor: 347_000_000, upper: 395_400_000 },
  };

  it("matches every run's floor and upper-bound nanodollar figure", () => {
    for (const run of HISTORICAL_RUNS) {
      expect(run.economicCostFloorNanoUsd, `run #${run.run} floor`).toBe(expected[run.run].floor);
      expect(run.economicCostUpperNanoUsd, `run #${run.run} upper`).toBe(expected[run.run].upper);
    }
  });

  /**
   * Still true after run #9, and for a reason worth stating rather than
   * inheriting: run #9 ran *after* Sprint 0051's fix deployed and its
   * validation sandbox still recorded no active CPU. The absence of a point
   * estimate here is not a historical artefact — it is live evidence that the
   * fix did not work in production (Sprint 0053, Defect 3).
   */
  it("no historical run carries a point-estimate cost — including run #9, which ran after the fix", () => {
    for (const run of HISTORICAL_RUNS) {
      expect(run.costIsPointEstimate, `run #${run.run}`).toBe(false);
    }
  });

  it("providerCostNanoUsd matches backfill.test.ts's pinned model-spend figures exactly", () => {
    const expectedProviderCost: Record<number, number> = {
      3: 346_506_500,
      4: 227_170_000,
      5: 319_930_000,
      6: 144_400_000,
      7: 251_500_000,
      8: 214_400_000,
      9: 311_505_500,
    };
    for (const run of HISTORICAL_RUNS) {
      expect(run.providerCostNanoUsd, `run #${run.run}`).toBe(expectedProviderCost[run.run]);
    }
  });

  it("the infra component (floor minus provider cost) is never negative", () => {
    for (const run of HISTORICAL_RUNS) {
      expect(run.economicCostFloorNanoUsd - run.providerCostNanoUsd, `run #${run.run}`).toBeGreaterThanOrEqual(0);
    }
  });
});

/**
 * The same step, twice, across a changed repository (Sprint 0053).
 *
 * This is the one comparison the n=6 dataset could not make. Runs #6 and #9
 * share a byte-identical `step_key` on a real persisted plan step, classify
 * identically, and differ only in the repository they ran against — which had
 * gained three files the step genuinely needed. The cost more than doubled.
 *
 * Pinned because it is the empirical basis for Sprint 0053's repository-context
 * metric, and because a future dataset edit that broke the pairing would
 * silently remove the evidence for it.
 */
describe("run #9 repeats run #6's step against a grown repository", () => {
  const run6 = HISTORICAL_RUNS.find((r) => r.run === 6)!;
  const run9 = HISTORICAL_RUNS.find((r) => r.run === 9)!;

  it("is the same step, at the same pricing class, with the same evidence", () => {
    expect(run9.title).toBe(run6.title);
    expect(run9.evidenceIds).toEqual(run6.evidenceIds);
    expect(run9.changeKind).toBe(run6.changeKind);
    expect(run9.riskClass).toBe(run6.riskClass);

    const classOf = (run: number) =>
      HISTORICAL_CLASSIFICATIONS.find((c) => c.run === run)?.pricingClass;
    expect(classOf(9)).toBe(classOf(6));
  });

  it("cost more than twice as much anyway", () => {
    const floorRatio = run9.economicCostFloorNanoUsd / run6.economicCostFloorNanoUsd;
    const modelRatio = run9.providerCostNanoUsd / run6.providerCostNanoUsd;

    // 2.00x at the floor, 2.16x in model spend. Asserted as bounds rather
    // than exact figures: the point is the magnitude, and pinning six decimal
    // places would make this test about arithmetic instead. The floor ratio is
    // the *lower* of the two because infrastructure cost scales with wall
    // clock, which grew less than the context re-reading did.
    expect(floorRatio).toBeGreaterThan(1.9);
    expect(modelRatio).toBeGreaterThan(2.1);
  });

  /**
   * The property Sprint 0052 proved and this does *not* contradict. A price
   * quoted before execution reads `riskClass`, `changeKind` and `evidenceIds`
   * and nothing else, so both runs quote identically — which is exactly why
   * the cost variance matters commercially rather than being self-correcting.
   */
  it("would have been quoted the same price both times", () => {
    const c6 = HISTORICAL_CLASSIFICATIONS.find((c) => c.run === 6)!;
    const c9 = HISTORICAL_CLASSIFICATIONS.find((c) => c.run === 9)!;

    expect(c9.pricingClass).toBe(c6.pricingClass);
    expect(c9.surfaces).toEqual(c6.surfaces);
    expect(c9.reason).toBe(c6.reason);
  });
});
