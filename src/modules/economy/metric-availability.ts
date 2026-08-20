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
] as const;

export type MetricName = (typeof METRIC_AVAILABILITY)[number]["metric"];

export type MetricReading<T> =
  | { status: "observed"; value: T }
  /** The metric existed and the run genuinely produced nothing. */
  | { status: "observed"; value: T }
  /** Instrumentation did not exist when this run happened. */
  | { status: "unavailable"; since: string }
  /** Instrumentation existed and the value is still missing. A real gap. */
  | { status: "missing" };

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
): MetricReading<T> {
  const since = availableSince(metric);

  if (since !== null && Date.parse(runCreatedAt) < Date.parse(since)) {
    return { status: "unavailable", since };
  }

  if (value === null || value === undefined) return { status: "missing" };

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
): R[] {
  const since = availableSince(metric);
  if (since === null) return [...runs];

  return runs.filter((run) => Date.parse(run.createdAt) >= Date.parse(since));
}
