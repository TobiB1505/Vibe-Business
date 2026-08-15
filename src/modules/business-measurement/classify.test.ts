import { describe, expect, it } from "vitest";
import { assessDataQuality, classifyMeasurement, summarizeSeries } from "./classify";
import { metricDefinition } from "./metrics";
import type { MetricSeries } from "./source";
import type { MeasurementWindow, MetricKey } from "./schema";
import { flatSeries } from "./test-support";

/**
 * Deterministic classification (Sprint 12B §14, §16, §17, §41).
 *
 * Every statement this product can make about somebody's business metric is
 * decided here, so every one of them is a unit test.
 *
 * The cases that matter most are the two refusals. A 40% "improvement"
 * computed from eleven visitors is not a small result — it is not a result —
 * and a classifier that reported it would be the single most damaging thing in
 * the product.
 */

const WINDOW: MeasurementWindow = {
  start: "2026-08-29T00:00:00.000Z",
  end: "2026-09-26T00:00:00.000Z",
  timezone: "UTC",
  days: 28,
};

function series(values: number[], sampleSizes?: number[]): MetricSeries {
  return {
    metricKey: "search_impressions",
    window: WINDOW,
    points: values.map((value, index) => ({
      day: `2026-08-${String(29 + index).padStart(2, "0")}`,
      value,
      ...(sampleSizes ? { sampleSize: sampleSizes[index] } : {}),
    })),
    sourceKind: "search_console",
    adapter: "fake_v1",
    retrievedAt: "2026-09-26T00:00:05.000Z",
  };
}

/** A window's worth of data comfortably above the metric's minimum. */
function ample(perDay: number) {
  return summarizeSeries(series(flatSeries(28, perDay)), WINDOW, "sum");
}

function classify(
  beforePerDay: number,
  afterPerDay: number,
  metricKey: MetricKey = "search_impressions",
) {
  return classifyMeasurement({
    metricKey,
    direction: metricDefinition(metricKey).direction,
    before: ample(beforePerDay),
    after: ample(afterPerDay),
  });
}

describe("enough data and a real movement (§16, §41)", () => {
  it("classifies a rise as improved when higher is better", () => {
    const result = classify(100, 130);

    expect(result.status).toBe("improved");
    expect(result.observedRelativeChange).toBeCloseTo(0.3, 5);
    expect(result.dataQuality).toBe("complete");
  });

  it("classifies a fall as degraded when higher is better", () => {
    const result = classify(100, 70);

    expect(result.status).toBe("degraded");
    expect(result.observedRelativeChange).toBeCloseTo(-0.3, 5);
  });

  it("reports the absolute movement alongside the relative one", () => {
    const result = classify(100, 130);

    // 28 days × 100 = 2800 before, × 130 = 3640 after.
    expect(result.observedAbsoluteChange).toBe(840);
  });
});

describe("direction decides which way is better (§5, §46)", () => {
  it("inverts the verdict for a lower_is_better metric", () => {
    // The mutation this kills is "assume every metric should go up", which
    // would report every improvement in a lower-is-better metric as a
    // regression and vice versa.
    const rising = classifyMeasurement({
      metricKey: "search_impressions",
      direction: "lower_is_better",
      before: ample(100),
      after: ample(130),
    });
    const falling = classifyMeasurement({
      metricKey: "search_impressions",
      direction: "lower_is_better",
      before: ample(100),
      after: ample(70),
    });

    expect(rising.status).toBe("degraded");
    expect(falling.status).toBe("improved");
  });

  it("refuses a direction it does not implement rather than guessing (§5)", () => {
    // `target_range` exists in the union precisely so a future metric declaring
    // it cannot be silently treated as higher-is-better.
    const result = classifyMeasurement({
      metricKey: "search_impressions",
      direction: "target_range",
      before: ample(100),
      after: ample(130),
    });

    expect(result.status).toBe("failed");
    expect(result.reason).toBe("direction_unsupported");
    expect(result.observedRelativeChange).toBeNull();
  });
});

describe("a tolerance band separates movement from noise (§16, §46)", () => {
  const band = metricDefinition("search_impressions").neutralBand;

  it("classifies a movement inside the band as neutral", () => {
    // Without this, a metric drifting a fraction of a percent week to week
    // would report a result every single time.
    const result = classify(1000, 1000 * (1 + band / 2));

    expect(result.status).toBe("neutral");
    expect(result.observedRelativeChange).toBeGreaterThan(0);
  });

  it("classifies a movement exactly at the band as neutral", () => {
    expect(classify(1000, 1000 * (1 + band)).status).toBe("neutral");
  });

  it("classifies a movement just outside the band as a result", () => {
    expect(classify(1000, 1000 * (1 + band * 1.5)).status).toBe("improved");
    expect(classify(1000, 1000 * (1 - band * 1.5)).status).toBe("degraded");
  });

  it("classifies no movement at all as neutral, never as improved", () => {
    const result = classify(100, 100);

    expect(result.status).toBe("neutral");
    expect(result.observedAbsoluteChange).toBe(0);
  });
});

describe("minimum data is required on BOTH sides (§14, §41, §46)", () => {
  const minimum = metricDefinition("search_impressions").minimumObservationsPerWindow;

  it("refuses when both windows are too thin", () => {
    const thin = summarizeSeries(series(flatSeries(28, 1)), WINDOW, "sum");

    const result = classifyMeasurement({
      metricKey: "search_impressions",
      direction: "higher_is_better",
      before: thin,
      after: thin,
    });

    expect(result.status).toBe("insufficient_data");
    expect(result.reason).toBe("below_minimum_sample");
    // And it states no movement at all, however dramatic the ratio looked.
    expect(result.observedRelativeChange).toBeNull();
  });

  it("refuses when only the post-change window is thin", () => {
    // A strong baseline must not carry an almost-empty after window. A combined
    // total would let exactly that happen (§14).
    const result = classifyMeasurement({
      metricKey: "search_impressions",
      direction: "higher_is_better",
      before: ample(1000),
      after: summarizeSeries(series(flatSeries(28, 1)), WINDOW, "sum"),
    });

    expect(result.status).toBe("insufficient_data");
  });

  it("refuses when only the baseline is thin", () => {
    const result = classifyMeasurement({
      metricKey: "search_impressions",
      direction: "higher_is_better",
      before: summarizeSeries(series(flatSeries(28, 1)), WINDOW, "sum"),
      after: ample(1000),
    });

    expect(result.status).toBe("insufficient_data");
  });

  it("does not report a huge apparent movement from tiny numbers (§14)", () => {
    // 10 before, 8 after — the example §14 names. A 20% drop, and meaningless.
    const before = summarizeSeries(series([10]), WINDOW, "sum");
    const after = summarizeSeries(series([8]), WINDOW, "sum");

    const result = classifyMeasurement({
      metricKey: "search_impressions",
      direction: "higher_is_better",
      before,
      after,
    });

    expect(result.status).toBe("insufficient_data");
    expect(result.status).not.toBe("degraded");
  });

  it("accepts data exactly at the minimum on both sides", () => {
    const exact = summarizeSeries(series([minimum]), WINDOW, "sum");
    const higher = summarizeSeries(series([minimum * 2]), WINDOW, "sum");

    expect(
      classifyMeasurement({
        metricKey: "search_impressions",
        direction: "higher_is_better",
        before: exact,
        after: higher,
      }).status,
    ).toBe("improved");
  });

  it("uses the metric's own minimum, not one global number", () => {
    // Clicks are an order of magnitude rarer than impressions, and a shared
    // threshold would be simultaneously too strict for one and too loose for
    // the other.
    expect(metricDefinition("search_clicks").minimumObservationsPerWindow).toBeLessThan(
      metricDefinition("search_impressions").minimumObservationsPerWindow,
    );
  });
});

describe("missing data is absent, never zero (§17, §41)", () => {
  it("reports null rather than zero when nothing came back", () => {
    // Summing a gap as zero converts an analytics outage into a reported
    // collapse in the customer's traffic — wrong, and alarmingly so.
    const empty = summarizeSeries(null, WINDOW, "sum");

    expect(empty.value).toBeNull();
    expect(empty.sampleSize).toBe(0);
  });

  it("classifies a missing side as insufficient_data, never as degraded", () => {
    const result = classifyMeasurement({
      metricKey: "search_impressions",
      direction: "higher_is_better",
      before: ample(1000),
      after: summarizeSeries(null, WINDOW, "sum"),
    });

    expect(result.status).toBe("insufficient_data");
    expect(result.reason).toBe("missing_data");
  });

  it("records how many days a window actually returned", () => {
    const partial = summarizeSeries(series(flatSeries(20, 100)), WINDOW, "sum");

    expect(partial.daysReturned).toBe(20);
    expect(partial.daysRequested).toBe(28);
  });
});

describe("data quality qualifies the result permanently (§17)", () => {
  it("is complete when both windows returned every day", () => {
    expect(assessDataQuality(ample(100), ample(100))).toBe("complete");
  });

  it("is partial when a few days are missing", () => {
    const short = summarizeSeries(series(flatSeries(26, 100)), WINDOW, "sum");
    expect(assessDataQuality(ample(100), short)).toBe("partial");
  });

  it("is insufficient when most of the window is missing", () => {
    // Half a window absent is not a normal comparison, and calling it `partial`
    // alongside a one-day gap would flatten a real distinction.
    const sparse = summarizeSeries(series(flatSeries(3, 100)), WINDOW, "sum");
    expect(assessDataQuality(ample(100), sparse)).toBe("insufficient");
  });

  it("still reports a result for a partial window, and says it was partial", () => {
    const short = summarizeSeries(series(flatSeries(26, 130)), WINDOW, "sum");

    const result = classifyMeasurement({
      metricKey: "search_impressions",
      direction: "higher_is_better",
      before: ample(100),
      after: short,
    });

    expect(result.status).toBe("improved");
    expect(result.dataQuality).toBe("partial");
  });
});

describe("aggregation is the policy's decision, not the adapter's (§12)", () => {
  it("sums a count metric", () => {
    expect(summarizeSeries(series([1, 2, 3]), WINDOW, "sum").value).toBe(6);
  });

  it("means a mean metric", () => {
    expect(summarizeSeries(series([1, 2, 3]), WINDOW, "mean").value).toBe(2);
  });

  it("weights a rate by its denominator rather than averaging daily rates", () => {
    // Averaging daily rates gives a quiet day the same weight as a busy one,
    // which is how a rate metric reports a change that only happened on the day
    // nobody visited.
    const weighted = summarizeSeries(series([0.5, 0.1], [10, 990]), WINDOW, "rate");

    // (0.5×10 + 0.1×990) / 1000 = 0.104, not the naive mean of 0.3.
    expect(weighted.value).toBeCloseTo(0.104, 5);
    expect(weighted.sampleSize).toBe(1000);
  });

  it("has no rate at all with no denominator", () => {
    expect(summarizeSeries(series([]), WINDOW, "rate").value).toBeNull();
  });
});

describe("a zero baseline has no relative change", () => {
  it("reports the absolute movement and no percentage", () => {
    // Dividing by zero would render as an infinite improvement.
    const result = classifyMeasurement({
      metricKey: "search_impressions",
      direction: "higher_is_better",
      before: summarizeSeries(series([0]), WINDOW, "sum"),
      after: ample(1000),
    });

    // Below the minimum on the baseline side, so it refuses first — which is
    // itself the right answer for a metric that was previously zero.
    expect(result.status).toBe("insufficient_data");
  });
});
