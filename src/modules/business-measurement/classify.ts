import { metricDefinition } from "./metrics";
import type { MetricSeries } from "./source";
import type {
  DataQuality,
  MeasurementStatus,
  MeasurementWindow,
  MetricAggregation,
  MetricDirection,
  MetricKey,
} from "./schema";

/**
 * Turning two series into one honest sentence (Sprint 12B §14, §16, §17, §41).
 *
 * Pure and total: two series in, a classification out. No clock, no network, no
 * database — so every statement this product can make about somebody's business
 * metric is a unit test rather than a live experiment.
 *
 * ## The order of the questions matters
 *
 * ```
 * 1. is the direction one we implement?      → else refuse, never guess (§5)
 * 2. is there enough data on BOTH sides?     → else insufficient_data (§14)
 * 3. is the movement outside the band?       → else neutral (§16)
 * 4. which way, given the direction?         → improved / degraded (§5)
 * ```
 *
 * Question 2 is before question 3 on purpose. A 40% "improvement" computed from
 * eleven visitors is not a small result, it is not a result — and checking the
 * movement first would let it be reported as one.
 */

export type WindowSummary = {
  /** The aggregated value, or null when nothing usable was returned. */
  value: number | null;
  /** Total observations behind it — the denominator for rate metrics. */
  sampleSize: number;
  /** Days the source actually returned. */
  daysReturned: number;
  daysRequested: number;
};

/**
 * Reduces a daily series to one number under the policy's aggregation.
 *
 * A missing day is **absent, not zero**. Summing a gap as zero silently
 * converts an outage at the analytics provider into a reported collapse in the
 * customer's traffic — which is both wrong and the most alarming possible way
 * to be wrong. The gap is reported through `daysReturned` instead, and it is
 * `dataQuality` that decides what to do about it (§17).
 */
export function summarizeSeries(
  series: MetricSeries | null,
  window: MeasurementWindow,
  aggregation: MetricAggregation,
): WindowSummary {
  if (series === null || series.points.length === 0) {
    return { value: null, sampleSize: 0, daysReturned: 0, daysRequested: window.days };
  }

  const values = series.points.map((point) => point.value);
  const total = values.reduce((sum, value) => sum + value, 0);

  // For a count metric the values *are* the observations; for a rate metric the
  // denominator is carried separately and is what the minimums are checked
  // against. A rate with no denominator has no sample size, and no sample size
  // means no comparison.
  const sampleSize = series.points.reduce(
    (sum, point) => sum + (point.sampleSize ?? point.value),
    0,
  );

  const value =
    aggregation === "sum"
      ? total
      : aggregation === "mean"
        ? total / values.length
        : // `rate`: the weighted rate across the window, not the mean of daily
          // rates. Averaging daily rates gives a quiet day the same weight as a
          // busy one, which is how a rate metric reports a change that only
          // happened on the day nobody visited.
          sampleSize === 0
          ? null
          : series.points.reduce((sum, point) => sum + point.value * (point.sampleSize ?? 1), 0) /
            sampleSize;

  return {
    value,
    sampleSize,
    daysReturned: series.points.length,
    daysRequested: window.days,
  };
}

/**
 * How complete the pair of windows was (§17).
 *
 * `partial` is not a failure and does not block a result — a week missing one
 * day is still informative — but it is recorded permanently, because a reader
 * later has no other way to know the comparison was not built on full periods.
 */
export function assessDataQuality(before: WindowSummary, after: WindowSummary): DataQuality {
  if (before.value === null || after.value === null) return "insufficient";

  // **Assessed per window, then taken at its worst.**
  //
  // Summing both sides first would let a complete baseline rescue an
  // almost-empty post-change window: 28 days against 3 is 31 of 56 returned,
  // which passes a "half the total" test and is plainly not a partial
  // comparison. It is the same argument as the per-side minimum-sample check —
  // one side cannot vouch for the other (§14, §17).
  const quality = (window: WindowSummary): DataQuality => {
    if (window.daysReturned >= window.daysRequested) return "complete";
    // Half a window missing is not a normal comparison, and calling it
    // `partial` alongside a one-day gap would flatten a real distinction.
    return window.daysReturned * 2 >= window.daysRequested ? "partial" : "insufficient";
  };

  const RANK: DataQuality[] = ["complete", "partial", "insufficient"];
  const worst = Math.max(RANK.indexOf(quality(before)), RANK.indexOf(quality(after)));
  return RANK[worst];
}

export type Classification = {
  status: Extract<
    MeasurementStatus,
    "improved" | "degraded" | "neutral" | "insufficient_data" | "failed"
  >;
  dataQuality: DataQuality;
  observedAbsoluteChange: number | null;
  observedRelativeChange: number | null;
  /** Present when the classification refused rather than concluded. */
  reason?: "direction_unsupported" | "below_minimum_sample" | "missing_data";
};

export type ClassifyInput = {
  metricKey: MetricKey;
  direction: MetricDirection;
  before: WindowSummary;
  after: WindowSummary;
};

/**
 * The deterministic classification (§16, §41).
 *
 * Every branch is reachable from a test, and the two refusals are as
 * load-bearing as the three results.
 */
export function classifyMeasurement(input: ClassifyInput): Classification {
  const definition = metricDefinition(input.metricKey);
  const dataQuality = assessDataQuality(input.before, input.after);

  // 1. A direction we do not implement is refused, never assumed. `target_range`
  //    exists in the union precisely so a future metric declaring it cannot be
  //    quietly treated as "higher is better" (§5).
  if (input.direction !== "higher_is_better" && input.direction !== "lower_is_better") {
    return {
      status: "failed",
      dataQuality,
      observedAbsoluteChange: null,
      observedRelativeChange: null,
      reason: "direction_unsupported",
    };
  }

  // 2. Nothing usable came back for one side. Not a business result at all.
  if (input.before.value === null || input.after.value === null) {
    return {
      status: "insufficient_data",
      dataQuality,
      observedAbsoluteChange: null,
      observedRelativeChange: null,
      reason: "missing_data",
    };
  }

  // 3. **Both** sides must clear the bar, independently. A strong baseline
  //    against an almost-empty post-window is exactly as meaningless as the
  //    reverse, and a combined total would let one side carry the other (§14).
  const minimum = definition.minimumObservationsPerWindow;
  if (input.before.sampleSize < minimum || input.after.sampleSize < minimum) {
    return {
      status: "insufficient_data",
      dataQuality,
      observedAbsoluteChange: null,
      observedRelativeChange: null,
      reason: "below_minimum_sample",
    };
  }

  const absolute = input.after.value - input.before.value;
  // A zero baseline has no meaningful relative change — dividing by it would
  // produce Infinity and render as an infinite improvement.
  const relative = input.before.value === 0 ? null : absolute / input.before.value;

  const change = { observedAbsoluteChange: absolute, observedRelativeChange: relative };

  // 4. Inside the band is `neutral`, not a tiny improvement. A metric that
  //    drifts a fraction of a percent week to week would otherwise report a
  //    result every single time (§16).
  const movement = relative === null ? (absolute === 0 ? 0 : definition.neutralBand + 1) : Math.abs(relative);
  if (movement <= definition.neutralBand) {
    return { status: "neutral", dataQuality, ...change };
  }

  // 5. Direction decides which way is good. Never assumed to be "up" (§5).
  const wentUp = absolute > 0;
  const better = input.direction === "higher_is_better" ? wentUp : !wentUp;

  return { status: better ? "improved" : "degraded", dataQuality, ...change };
}
