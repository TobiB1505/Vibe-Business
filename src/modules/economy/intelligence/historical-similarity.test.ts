import { describe, expect, it } from "vitest";
import { HISTORICAL_RUNS } from "../historical-runs";
import {
  SIMILARITY_ONLY_WEIGHTING,
  findSimilarRuns,
  type HistoricalWeighting,
  type SimilarityInput,
} from "./historical-similarity";

/** The step runs #3-#6 and #9 all executed: the same SEO metadata change. */
const SEO_METADATA: SimilarityInput = {
  pricingClass: "standard",
  changeKind: "product_change",
  riskClass: "moderate",
  evidenceIds: ["live.seo.robots_meta_missing"],
};

describe("similar runs are matched, not averaged", () => {
  it("finds the runs that executed the same work", () => {
    const expectation = findSimilarRuns(SEO_METADATA);
    const runs = expectation.matches.map((match) => match.run);

    expect(runs).toEqual(expect.arrayContaining([3, 4, 5, 6, 9]));
    expect(expectation.basis).toBe("class_matched");
  });

  /**
   * PART P #5, on a dataset built to have two cohorts.
   *
   * The real dataset cannot show this and it is worth being plain about why:
   * six of its seven runs are the same class, the same change kind and the same
   * risk class, so the class-matched mean and the dataset mean are a few cents
   * apart by construction. That is a fact about n=7, not evidence that matching
   * works — so the claim is tested where it can actually fail.
   */
  it("lands on the matching cohort rather than between two cohorts", () => {
    const cheap = { ...HISTORICAL_RUNS[0], economicCostFloorNanoUsd: 100_000_000, economicCostUpperNanoUsd: 100_000_000 };
    const expensive = {
      ...HISTORICAL_RUNS[0],
      changeKind: "external_setup" as const,
      evidenceIds: ["live.auth.session_handling"],
      economicCostFloorNanoUsd: 900_000_000,
      economicCostUpperNanoUsd: 900_000_000,
    };

    const dataset = [
      { ...cheap, run: 101 },
      { ...cheap, run: 102 },
      { ...expensive, run: 201 },
      { ...expensive, run: 202 },
    ];

    const expectation = findSimilarRuns(SEO_METADATA, { dataset });
    const datasetMean = 500_000_000;

    expect(expectation.expectedFloorNanoUsd ?? 0).toBeLessThan(datasetMean);
    expect(expectation.expectedFloorNanoUsd ?? 0).toBeLessThan(300_000_000);
  });

  /**
   * What the real dataset can show: the one run of a different pricing class
   * carries far less weight than the five that share the work.
   */
  it("gives a different-class run a fraction of a same-class run's weight", () => {
    const expectation = findSimilarRuns(SEO_METADATA);
    const byRun = new Map(expectation.matches.map((match) => [match.run, match.weight.finalWeight]));

    const sameClass = byRun.get(3) ?? 0;
    const differentClass = byRun.get(8) ?? 0;

    expect(sameClass).toBeGreaterThan(0);
    expect(differentClass).toBeGreaterThan(0);
    expect(differentClass).toBeLessThan(sameClass / 2);
  });

  it("weights a closer neighbour more heavily than a distant one", () => {
    const expectation = findSimilarRuns(SEO_METADATA);
    const [closest] = expectation.matches;
    const furthest = expectation.matches.at(-1);

    if (!closest || !furthest) throw new Error("expected several matches");
    expect(closest.weight.finalWeight).toBeGreaterThanOrEqual(furthest.weight.finalWeight);
    expect(closest.matched).toContain("evidence_overlap");
  });

  it("carries an upper bound alongside the floor", () => {
    const expectation = findSimilarRuns(SEO_METADATA);

    expect(expectation.expectedUpperNanoUsd ?? 0).toBeGreaterThanOrEqual(expectation.expectedFloorNanoUsd ?? 0);
  });
});

describe("more comparable evidence is more confidence", () => {
  it("grows confidence with the number of neighbours", () => {
    const one = findSimilarRuns(SEO_METADATA, { dataset: HISTORICAL_RUNS.slice(0, 1) });
    const all = findSimilarRuns(SEO_METADATA);

    expect(all.sampleSize).toBeGreaterThan(one.sampleSize);
  });

  /**
   * Today's answer, and the honest one: seven runs against one repository is
   * `low`, whatever the machinery is capable of.
   */
  it("stays low on the dataset Vibe actually has", () => {
    expect(findSimilarRuns(SEO_METADATA).confidence).toBe("low");
  });

  it("returns nothing rather than a dataset mean when nothing is comparable", () => {
    const expectation = findSimilarRuns({
      pricingClass: "complex",
      changeKind: "research",
      riskClass: "high",
      evidenceIds: ["nothing.like.this"],
    });

    expect(expectation.matches).toEqual([]);
    expect(expectation.basis).toBe("no_data");
    expect(expectation.expectedFloorNanoUsd).toBeNull();
    expect(expectation.confidence).toBe("none");
  });

  /**
   * Run #8's change kind and evidence were read from a dogfood fixture rather
   * than from action_plan_steps. `historical-runs.ts` marks it `limited`, and a
   * marker nothing reads is a comment.
   */
  it("caps confidence when a neighbour was reconstructed off the production path", () => {
    const limitedOnly = HISTORICAL_RUNS.filter((run) => run.classificationConfidence === "limited");
    expect(limitedOnly.length).toBeGreaterThan(0);

    const expectation = findSimilarRuns(
      { pricingClass: "small", changeKind: "product_change", riskClass: "moderate", evidenceIds: ["live.conversion.primary_cta"] },
      { dataset: [...limitedOnly, ...limitedOnly, ...limitedOnly, ...limitedOnly, ...limitedOnly, ...limitedOnly,
                  ...limitedOnly, ...limitedOnly, ...limitedOnly, ...limitedOnly, ...limitedOnly, ...limitedOnly] },
    );

    expect(expectation.sampleSize).toBeGreaterThanOrEqual(10);
    expect(expectation.confidence).toBe("low");
  });
});

/**
 * PART P #16. Age, model generation and repository similarity are real and
 * unmeasurable on a dataset spanning two days, one repository and one model.
 * They are present and pinned at 1 so "not yet weighted" is visible in the data.
 */
describe("weighting is a seam, with the deferred factors visible", () => {
  it("pins age, model and repository factors at exactly 1 in v1", () => {
    for (const match of findSimilarRuns(SEO_METADATA).matches) {
      expect(match.weight.ageFactor, `run #${match.run}`).toBe(1);
      expect(match.weight.modelFactor, `run #${match.run}`).toBe(1);
      expect(match.weight.repositoryFactor, `run #${match.run}`).toBe(1);
      expect(match.weight.finalWeight).toBe(match.weight.similarityFactor);
    }
  });

  it("accepts a different policy without any call site changing shape", () => {
    // A stand-in decay: everything before run #9 counts for a tenth.
    const decaying: HistoricalWeighting = (run, similarityFactor, at) => {
      const base = SIMILARITY_ONLY_WEIGHTING(run, similarityFactor, at);
      const ageFactor = run.run < 9 ? 0.1 : 1;
      return { ...base, ageFactor, finalWeight: base.similarityFactor * ageFactor };
    };

    const flat = findSimilarRuns(SEO_METADATA);
    const decayed = findSimilarRuns(SEO_METADATA, { weighting: decaying });

    expect(decayed.matches.map((match) => match.run)).toEqual(expect.arrayContaining([9]));
    expect(decayed.expectedFloorNanoUsd).not.toBe(flat.expectedFloorNanoUsd);

    const runNine = HISTORICAL_RUNS.find((run) => run.run === 9);
    expect(Math.abs((decayed.expectedFloorNanoUsd ?? 0) - (runNine?.economicCostFloorNanoUsd ?? 0))).toBeLessThan(
      Math.abs((flat.expectedFloorNanoUsd ?? 0) - (runNine?.economicCostFloorNanoUsd ?? 0)),
    );
  });

  it("drops a run a weighting policy zeroes out", () => {
    const nothing: HistoricalWeighting = (run, similarityFactor) => ({
      run: run.run,
      similarityFactor,
      ageFactor: 0,
      modelFactor: 1,
      repositoryFactor: 1,
      finalWeight: 0,
    });

    const expectation = findSimilarRuns(SEO_METADATA, { weighting: nothing });

    expect(expectation.matches).toEqual([]);
    expect(expectation.basis).toBe("no_data");
  });
});

describe("similarity is deterministic", () => {
  it("returns the same expectation for the same input", () => {
    expect(findSimilarRuns(SEO_METADATA)).toEqual(findSimilarRuns(SEO_METADATA));
  });
});
