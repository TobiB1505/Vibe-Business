/**
 * Which metrics a given run could possibly have (Sprint 0050).
 *
 * ## The failure this prevents
 *
 * The previous economy analysis compared metrics across runs #3–#8 without
 * asking whether each metric existed when each run happened. Several did not:
 * `sdk_loop_iterations` arrived with run #4, verification counters with run #6,
 * completion counters with run #8. A `null` in an older row does not mean the
 * agent ran no verification commands — it means nobody was counting.
 *
 * Reading that as zero is not a rounding error. It puts a fabricated data point
 * into a correlation and moves the answer.
 *
 * ## Why this is a table and not a column
 *
 * Because it is a fact about *Vibe's instrumentation*, not about any run, and
 * storing it per row would mean writing the same value 11 times and being able
 * to get it wrong on the twelfth. The run's own `created_at` plus this table
 * answers the question for every row that exists and every row that will.
 *
 * The dates are the deploy dates of the sprint that introduced each writer,
 * taken from the runs themselves — the first run that carries a non-null value
 * bounds when the writer started.
 */

import { OPERATIONAL_EVENT_RETENTION_DAYS } from "@/modules/retention/periods";

export const METRIC_AVAILABILITY = [
  { metric: "providerCost", since: "2026-08-19T00:00:00Z", note: "ai_usage_events from the first agentic run" },
  { metric: "inputTokens", since: "2026-08-19T00:00:00Z", note: null },
  { metric: "outputTokens", since: "2026-08-19T00:00:00Z", note: null },
  { metric: "thinkingTokens", since: "2026-08-19T00:00:00Z", note: "billed inside outputTokens, never added again" },
  { metric: "cacheReadTokens", since: "2026-08-19T00:00:00Z", note: null },
  { metric: "cacheWriteTokens", since: "2026-08-19T00:00:00Z", note: null },
  { metric: "durationMs", since: "2026-08-19T08:58:00Z", note: "null on the two runs that died before starting" },
  { metric: "sdkLoopIterations", since: "2026-08-19T16:01:00Z", note: "run #4 onward" },
  { metric: "verificationCommands", since: "2026-08-19T17:16:00Z", note: "run #5 onward; run #5 recorded 0 legitimately" },
  { metric: "verificationMs", since: "2026-08-19T18:45:00Z", note: "run #6 onward" },
  { metric: "repairCycles", since: "2026-08-19T18:45:00Z", note: "run #6 onward" },
  { metric: "implementationMutations", since: "2026-08-19T22:19:00Z", note: "run #8 onward (Sprint 0044)" },
  { metric: "convergenceMutations", since: "2026-08-19T22:19:00Z", note: "run #8 onward (Sprint 0044)" },
  { metric: "sandboxActiveCpuMs", since: "2026-08-19T18:45:00Z", note: "partial even after this date" },
  /**
   * The two the previous analysis called broken.
   *
   * They are neither broken nor missing: they count **gateway-brokered** calls,
   * and under the sandbox topology (ADR 0029) the harness never calls back
   * through the gateway. Zero is the correct and meaningful answer — "the
   * gateway brokered nothing" — for every run since agent execution moved into
   * the VM. What was wrong was reading them as "the agent used no tools".
   */
  { metric: "gatewayToolCallsAllowed", since: "2026-08-19T00:00:00Z", note: "counts gateway-brokered calls only; correctly 0 under the sandbox topology" },
  { metric: "gatewayFilesRead", since: "2026-08-19T00:00:00Z", note: "counts gateway-brokered reads only; correctly 0 under the sandbox topology" },
  /** Derived from `agent_execution_events`, which exist for all six runs. */
  { metric: "harnessToolCalls", since: "2026-08-19T11:08:00Z", note: "derived from agent_execution_events" },
  { metric: "harnessReadOperations", since: "2026-08-19T11:08:00Z", note: "derived from agent_execution_events" },
  { metric: "harnessUniqueFilesRead", since: "2026-08-19T11:08:00Z", note: "derived from agent_execution_events" },
  /**
   * Repository context (Sprint 0053), recorded here by Sprint 0054.
   *
   * These dates are migration timestamps rather than first-observed values,
   * because there is nothing to observe: the columns were added at
   * 2026-08-20T20:00Z and the newest run in the dataset (#9) was created at
   * 2026-08-20T15:07Z. **No delivered run has repository size at all.** That is
   * the single most consequential gap in the predictive dataset, and the reason
   * it is written down here is so a later analysis reads `unavailable` instead
   * of quietly averaging six nulls into a repository of size zero.
   */
  { metric: "repoTreeEntries", since: "2026-08-20T20:00:00Z", note: "20260820200000_repository_context_size.sql; null for every run in the dataset" },
  { metric: "repoFilesAnalyzed", since: "2026-08-20T20:00:00Z", note: "analysis effort at the pinned commit, bounded by the analyzer's read budget" },
  { metric: "repoBytesAnalyzed", since: "2026-08-20T20:00:00Z", note: null },
  { metric: "repoRoutesDetected", since: "2026-08-20T20:00:00Z", note: null },
  { metric: "repoSurfacesDetected", since: "2026-08-20T20:00:00Z", note: null },
  { metric: "contextCandidatesAvailable", since: "2026-08-20T20:00:00Z", note: "without it, a brief clipped at the cap is indistinguishable from a repository that offered exactly the cap" },
  /**
   * The one repository-context axis that *is* reconstructable for part of the
   * dataset: added a day earlier, so runs #6–#9 carry it and #3–#5 do not.
   * It is what makes the run #6 → #9 candidate movement (6 → 12) a measurement
   * rather than an anecdote.
   */
  { metric: "contextCandidatesSent", since: "2026-08-19T18:00:00Z", note: "20260819180000_execution_context.sql; runs #6 onward" },
] as const;

export type MetricName = (typeof METRIC_AVAILABILITY)[number]["metric"];

/**
 * The mirror question, and the one this module did not have to ask until now.
 *
 * Everything above answers *when did Vibe start counting* — a null before that
 * date "means nobody was counting", and reading it as a zero "puts a fabricated
 * data point into a correlation and moves the answer."
 *
 * Since [ADR 0069](../../../docs/decisions/0069-retention-sweep-trigger.md) a
 * daily `pg_cron` sweep deletes `agent_execution_events` after ninety days, so
 * there is now a second date and it moves: **how far back do the rows still
 * exist.** The failure it introduces is worse than the one above, because it is
 * invisible from the data. A run whose events were swept is not a run with null
 * metrics — it is a run that does not appear at all, and an average over
 * whatever survived is well formed and wrong.
 *
 * Nothing forces a reader to consult this, exactly as nothing forces them to
 * consult {@link METRIC_AVAILABILITY}. It is stated where the person asking the
 * question is already looking, and {@link readMetric} and
 * {@link comparableRuns} apply it without being asked.
 */
export const HARNESS_EVENT_RETENTION_DAYS = OPERATIONAL_EVENT_RETENTION_DAYS;

/**
 * The metrics that vanish with the events, rather than merely being null.
 *
 * `harness-metrics.ts` derives all three from `agent_execution_events` and
 * nothing materializes them per run, so the event stream is the only record
 * (ADR 0069 §5 F3). Every other metric here lives on the run row, which the
 * sweep cannot reach — `operation_runs` and its `agent_execution_runs` subtree
 * are excluded from every age sweep at every period.
 */
export const SWEPT_EVIDENCE_METRICS = [
  "harnessToolCalls",
  "harnessReadOperations",
  "harnessUniqueFilesRead",
] as const satisfies readonly MetricName[];

/** The date before which harness evidence has been deleted, as of `now`. */
export function retainedSince(now: Date = new Date()): string {
  const cutoff = new Date(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - HARNESS_EVENT_RETENTION_DAYS);
  return cutoff.toISOString();
}

function isSweptEvidence(metric: MetricName): boolean {
  return (SWEPT_EVIDENCE_METRICS as readonly string[]).includes(metric);
}



export type MetricReading<T> =
  /** The metric existed and was recorded — including a genuine zero. */
  | { status: "observed"; value: T }
  /** Instrumentation did not exist when this run happened. */
  | { status: "unavailable"; since: string }
  /** Instrumentation existed and the value is still missing. A real gap. */
  | { status: "missing" }
  /**
   * Instrumentation existed and its evidence has since been deleted on
   * schedule. Not a gap, and emphatically not a zero — the run happened and
   * Vibe no longer holds what would answer the question (ADR 0069 §6).
   */
  | { status: "swept"; retainedSince: string };

export function availableSince(metric: MetricName): string | null {
  return METRIC_AVAILABILITY.find((entry) => entry.metric === metric)?.since ?? null;
}

/**
 * Reads one metric for one run, distinguishing three different nothings.
 *
 * `0` from a run that could measure, `unavailable` from a run that could not,
 * and `missing` from a run that could and did not. Only the first belongs in an
 * average.
 */
export function readMetric<T>(
  metric: MetricName,
  runCreatedAt: string,
  value: T | null | undefined,
  now: Date = new Date(),
): MetricReading<T> {
  const since = availableSince(metric);

  if (since !== null && Date.parse(runCreatedAt) < Date.parse(since)) {
    return { status: "unavailable", since };
  }

  if (value === null || value === undefined) {
    // Order matters: a value that is present is `observed` whatever its age,
    // because something evidently still holds it. Only an absent value on a run
    // past the horizon is attributable to the sweep, and calling that `missing`
    // would report a gap in instrumentation that never existed.
    const horizon = retainedSince(now);
    if (isSweptEvidence(metric) && Date.parse(runCreatedAt) < Date.parse(horizon)) {
      return { status: "swept", retainedSince: horizon };
    }
    return { status: "missing" };
  }

  return { status: "observed", value };
}

/**
 * The runs a metric may legitimately be compared across.
 *
 * A correlation computed over a set this function did not produce is comparing
 * measurements with absences.
 */
export function comparableRuns<R extends { createdAt: string }>(
  metric: MetricName,
  runs: readonly R[],
  now: Date = new Date(),
): R[] {
  const since = availableSince(metric);
  const floor = isSweptEvidence(metric)
    ? // Both bounds apply, and the later one wins: instrumentation that arrived
      // after the horizon is still the binding constraint.
      [since, retainedSince(now)].filter((d): d is string => d !== null).sort().at(-1)
    : since;

  if (floor === undefined || floor === null) return [...runs];

  return runs.filter((run) => Date.parse(run.createdAt) >= Date.parse(floor));
}
