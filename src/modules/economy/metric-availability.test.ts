import { describe, expect, it } from "vitest";
import { HISTORICAL_RUNS } from "./historical-runs";
import {
  HARNESS_EVENT_RETENTION_DAYS,
  METRIC_AVAILABILITY,
  SWEPT_EVIDENCE_METRICS,
  availableSince,
  comparableRuns,
  readMetric,
  retainedSince,
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

/**
 * The fourth nothing (ADR 0069 §6).
 *
 * This module exists because a null was once read as a zero. The retention
 * sweep introduces the harder version of that mistake: a run whose evidence was
 * deleted is not a run with null metrics, it is a run that is *absent*, and an
 * average over the survivors is well formed and wrong.
 *
 * A fixed `now` throughout — the horizon moves daily, so a test written against
 * the real clock would pass today and mean something different in December.
 */
const NOW = new Date("2026-12-01T00:00:00Z");
/** 2026-12-01 minus ninety days. Runs before this have lost their events. */
const BEFORE_HORIZON = "2026-08-20T00:00:00Z";
const AFTER_HORIZON = "2026-11-01T00:00:00Z";

describe("harness evidence past the retention horizon", () => {
  it("puts the horizon ninety days back, matching the sweep", () => {
    expect(HARNESS_EVENT_RETENTION_DAYS).toBe(90);
    const days = (NOW.getTime() - Date.parse(retainedSince(NOW))) / 86_400_000;
    expect(days).toBe(90);
  });

  it("reports a swept run as swept, not as a gap in instrumentation", () => {
    for (const metric of SWEPT_EVIDENCE_METRICS) {
      expect(readMetric(metric, BEFORE_HORIZON, null, NOW)).toEqual({
        status: "swept",
        retainedSince: retainedSince(NOW),
      });
    }
  });

  it("still reports a real gap inside the horizon as missing", () => {
    // The distinction the sweep must not blur: inside ninety days the rows are
    // there, so an absent value is something that failed to be written.
    expect(readMetric("harnessToolCalls", AFTER_HORIZON, null, NOW)).toEqual({ status: "missing" });
  });

  it("reports a value that is present as observed, however old the run", () => {
    // Something evidently still holds it, so attributing the age to the sweep
    // would be a claim about data that is in front of us.
    expect(readMetric("harnessToolCalls", BEFORE_HORIZON, 42, NOW)).toEqual({
      status: "observed",
      value: 42,
    });
  });

  it("leaves every other metric untouched by the horizon", () => {
    // These live on the run row, which no age sweep can reach.
    expect(readMetric("providerCost", BEFORE_HORIZON, null, NOW)).toEqual({ status: "missing" });
    expect(readMetric("repoTreeEntries", BEFORE_HORIZON, null, NOW)).toEqual({
      status: "unavailable",
      since: availableSince("repoTreeEntries"),
    });
  });

  it("excludes swept runs from a comparison over harness metrics", () => {
    const runs = [{ createdAt: BEFORE_HORIZON }, { createdAt: AFTER_HORIZON }];
    expect(comparableRuns("harnessToolCalls", runs, NOW)).toEqual([{ createdAt: AFTER_HORIZON }]);
    // The same runs are comparable for a metric the sweep cannot touch, as far
    // back as its instrumentation goes.
    expect(comparableRuns("providerCost", runs, NOW)).toEqual(runs);
  });

  it("lets the later of the two bounds win", () => {
    // Instrumentation that arrived after the horizon is still binding: a run
    // inside the retention window that predates the writer has no value either.
    const beforeInstrumentation = [{ createdAt: "2026-08-19T10:00:00Z" }];
    expect(comparableRuns("harnessToolCalls", beforeInstrumentation, new Date("2026-09-02T00:00:00Z")))
      .toEqual([]);
  });

  it("names only metrics the availability table knows", () => {
    const known = new Set<string>(METRIC_AVAILABILITY.map((entry) => entry.metric));
    for (const metric of SWEPT_EVIDENCE_METRICS) expect(known.has(metric)).toBe(true);
  });
});
