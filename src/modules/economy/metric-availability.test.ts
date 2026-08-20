import { describe, expect, it } from "vitest";
import { HISTORICAL_RUNS } from "./historical-runs";
import {
  METRIC_AVAILABILITY,
  availableSince,
  comparableRuns,
  readMetric,
  type MetricName,
} from "./metric-availability";

/**
 * The availability table's own guard (Sprint 0054).
 *
 * Sprint 0050 wrote this table and nothing asserted against it. Sprint 0054
 * depends on one specific claim being true — that no delivered run carries
 * repository size — so the claim gets a test rather than a comment.
 */

const REPOSITORY_SIZE_METRICS: readonly MetricName[] = [
  "repoTreeEntries",
  "repoFilesAnalyzed",
  "repoBytesAnalyzed",
  "repoRoutesDetected",
  "repoSurfacesDetected",
  "contextCandidatesAvailable",
];

describe("the metric availability table", () => {
  it("names every metric exactly once", () => {
    const names = METRIC_AVAILABILITY.map((entry) => entry.metric);
    expect(new Set(names).size).toBe(names.length);
  });

  it("dates every metric with a parseable instant", () => {
    for (const entry of METRIC_AVAILABILITY) {
      expect(Number.isNaN(Date.parse(entry.since)), entry.metric).toBe(false);
    }
  });
});

describe("repository size is unavailable for every delivered run", () => {
  /**
   * The load-bearing fact behind Sprint 0054's honesty about its own dataset.
   * The columns arrived at 2026-08-20T20:00Z; run #9, the newest, was created
   * at 2026-08-20T15:07Z. There is nothing to read and nothing to back-fill.
   */
  it("reads unavailable, not missing, for all seven runs", () => {
    for (const metric of REPOSITORY_SIZE_METRICS) {
      for (const run of HISTORICAL_RUNS) {
        expect(readMetric(metric, run.createdAt, null), `${metric} on run #${run.run}`).toEqual({
          status: "unavailable",
          since: availableSince(metric),
        });
      }
    }
  });

  it("leaves no run comparable on repository size", () => {
    for (const metric of REPOSITORY_SIZE_METRICS) {
      expect(comparableRuns(metric, HISTORICAL_RUNS), metric).toEqual([]);
    }
  });
});

describe("candidates sent is the one repository-context axis part of the dataset has", () => {
  /**
   * Added a day earlier than the rest, which is why run #6 → run #9 is a
   * measured candidate movement (6 → 12) rather than an anecdote.
   */
  it("covers runs #6 onward and no earlier run", () => {
    const comparable = comparableRuns("contextCandidatesSent", HISTORICAL_RUNS).map((run) => run.run);

    expect(comparable).toEqual([6, 7, 8, 9]);
  });

  it("still distinguishes an unrecorded value from a measured zero", () => {
    const runSix = HISTORICAL_RUNS.find((run) => run.run === 6);
    if (!runSix) throw new Error("run #6 missing from the dataset");

    expect(readMetric("contextCandidatesSent", runSix.createdAt, null)).toEqual({ status: "missing" });
    expect(readMetric("contextCandidatesSent", runSix.createdAt, 0)).toEqual({ status: "observed", value: 0 });
  });
});
