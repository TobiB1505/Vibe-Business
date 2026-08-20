import { describe, expect, it } from "vitest";
import { HISTORICAL_RUNS } from "../historical-runs";
import {
  HISTORICAL_LEARNING_RECORDS,
  backtestRun,
  learningSummary,
} from "./learning-dataset";
import { resolveEconomyModel } from "./model-version";
import { reconcileExecutionEconomics } from "./reconciliation";

describe("every delivered run is estimated without itself", () => {
  it("covers runs #3 to #9", () => {
    expect(HISTORICAL_LEARNING_RECORDS.map((record) => record.run)).toEqual([3, 4, 5, 6, 7, 8, 9]);
  });

  /**
   * A backtest that lets a run predict itself is a memory test. Run #9's cost
   * is in the dataset, so estimating it against the full set would quote a
   * number partly composed of run #9 and then congratulate itself.
   */
  it("never lets a run appear in its own baseline", () => {
    for (const record of HISTORICAL_LEARNING_RECORDS) {
      const matched = record.prediction.historicalExpectation.matches.map((match) => match.run);

      expect(matched, `run #${record.run}`).not.toContain(record.run);
      expect(record.prediction.historicalExpectation.sampleSize).toBe(HISTORICAL_RUNS.length - 1);
    }
  });

  it("estimates from pre-execution fields only", () => {
    for (const record of HISTORICAL_LEARNING_RECORDS) {
      const run = HISTORICAL_RUNS.find((entry) => entry.run === record.run);
      if (!run) throw new Error(`run #${record.run} vanished from the dataset`);

      expect(record.input.riskClass).toBe(run.riskClass);
      expect(record.input.changeKind).toBe(run.changeKind);
      expect(record.input.evidenceIds).toEqual(run.evidenceIds);
      // Nothing the run went on to cost is anywhere in its own input.
      expect(JSON.stringify(record.input)).not.toContain(String(run.economicCostFloorNanoUsd));
    }
  });

  it("reads the dataset and never writes it", () => {
    const before = JSON.stringify(HISTORICAL_RUNS);
    learningSummary();
    backtestRun(HISTORICAL_RUNS[0]);

    expect(JSON.stringify(HISTORICAL_RUNS)).toBe(before);
  });
});

/**
 * The measured verdict on the estimator as it stands. These numbers are the
 * sprint's most useful output and they are not flattering — which is the point
 * of measuring rather than asserting.
 */
describe("the backtest says how good the estimator currently is", () => {
  const summary = learningSummary();

  it("compares all seven runs", () => {
    expect(summary.runs).toBe(7);
    expect(summary.comparable).toBe(7);
  });

  /**
   * ~24% mean absolute error, worst case +51%. With no repository context the
   * estimator is predicting little more than a class mean, and runs #3 and #6
   * are the *same step* 2.5x apart. That gap is the evidence that repository
   * context is the missing signal, not an argument for a cleverer formula.
   */
  it("is off by about a quarter on average, and by half at worst", () => {
    expect(summary.meanAbsoluteRelativeError ?? 0).toBeGreaterThan(0.2);
    expect(summary.meanAbsoluteRelativeError ?? 0).toBeLessThan(0.3);
    expect(Math.abs(summary.worstRelativeError ?? 0)).toBeGreaterThan(0.5);
  });

  it("is not systematically biased in either direction", () => {
    expect(summary.underPredicted).toBeGreaterThan(0);
    expect(summary.overPredicted).toBeGreaterThan(0);
    expect(Math.abs(summary.medianRelativeError ?? 0)).toBeLessThan(0.15);
  });

  /**
   * The single most consequential gap in the dataset. The repo_* columns landed
   * at 2026-08-20T20:00Z; the newest run was created at 15:07Z the same day.
   */
  it("could not exercise the repository terms at all", () => {
    expect(summary.repositoryContextAvailableFor).toBe(0);

    for (const record of HISTORICAL_LEARNING_RECORDS) {
      expect(record.repositoryContextAvailable, `run #${record.run}`).toBe(false);
      expect(record.prediction.repositorySignal.measured).toBe(false);
      expect(record.prediction.repositoryDrift.driftLevel).toBe("unknown");
      expect(record.prediction.reasons).toContain("repository_unmeasured");
    }
  });
});

describe("seven runs are not enough to correct anything", () => {
  /**
   * PART P #13's counterpart. The backtest produces a real error signal and the
   * reconciler still refuses to act on it, because a correction fitted to seven
   * points is noise with a decimal point.
   */
  it("proposes no adjustment from the whole dataset", () => {
    const model = resolveEconomyModel(new Date("2026-08-21T00:00:00Z"));
    const adjustment = reconcileExecutionEconomics({
      comparisons: HISTORICAL_LEARNING_RECORDS.map((record) => record.comparison),
      policy: model.adjustmentPolicy,
      modelVersion: "economy-model.v1",
    });

    expect(adjustment.sampleSize).toBe(7);
    expect(adjustment.sampleSize).toBeLessThan(model.adjustmentPolicy.minSamples);
    expect(adjustment.reason).toBe("insufficient_samples");
    expect(adjustment.adjustment).toBe(1);
  });
});

describe("the backtest is deterministic", () => {
  it("produces the same records on every evaluation", () => {
    expect(HISTORICAL_RUNS.map((run) => backtestRun(run))).toEqual(HISTORICAL_LEARNING_RECORDS);
  });
});
