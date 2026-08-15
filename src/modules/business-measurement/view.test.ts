import { describe, expect, it } from "vitest";
import { OBSERVED_CHANGE_DISCLAIMER, findCausalClaims } from "./causality";
import { measurementFailureMessage } from "./messages";
import { buildBusinessImpactCard } from "./view";
import type {
  BusinessOutcomeMeasurement,
  MeasurementPlan,
  MeasurementStatus,
  MeasurementWindow,
} from "./schema";

/**
 * The card the panel renders (Sprint 12B §20–§26, §33, §43).
 *
 * ## The two things this layer must never do
 *
 * Render a state that is *not a result* as if it were one — which would report
 * a failure of the change where there is only a missing connection or an
 * elapsed clock (§21, §22).
 *
 * And state a movement without the disclaimer that keeps it observational
 * rather than causal (§24).
 */

const BASELINE: MeasurementWindow = {
  start: "2026-07-17T00:00:00.000Z",
  end: "2026-08-14T00:00:00.000Z",
  timezone: "UTC",
  days: 28,
};
const MEASUREMENT: MeasurementWindow = {
  start: "2026-08-29T00:00:00.000Z",
  end: "2026-09-26T00:00:00.000Z",
  timezone: "UTC",
  days: 28,
};

function plan(overrides: Partial<MeasurementPlan> = {}): MeasurementPlan {
  return {
    id: "plan_1",
    projectId: "project_1",
    userId: "user_1",
    preparedChangeId: "prepared_1",
    changeMergeId: "merge_1",
    businessGoal: "Be findable by people searching for what you do",
    primaryMetric: "search_impressions",
    secondaryMetrics: ["search_clicks"],
    metricDirection: "higher_is_better",
    metricCategory: "search_visibility",
    compatibleSourceKinds: ["search_console"],
    baselineDays: 28,
    measurementDays: 28,
    settlingDays: 14,
    minimumObservations: 500,
    measurementProfile: "nextjs_seo_foundations_measurement_v1",
    measurementProfileVersion: "nextjs-seo-foundations-measurement-v1",
    measurementPolicyVersion: "measurement-policy-v1",
    status: "ready",
    unsupportedReason: null,
    createdAt: "2026-08-14T15:00:00.000Z",
    updatedAt: "2026-08-14T15:00:00.000Z",
    ...overrides,
  };
}

function measurement(
  status: MeasurementStatus,
  overrides: Partial<BusinessOutcomeMeasurement> = {},
): BusinessOutcomeMeasurement {
  return {
    id: "measurement_1",
    projectId: "project_1",
    userId: "user_1",
    measurementPlanId: "plan_1",
    changeMergeId: "merge_1",
    metricKey: "search_impressions",
    metricDirection: "higher_is_better",
    metricAggregation: "sum",
    metricSourceKind: "search_console",
    baselineWindow: BASELINE,
    measurementWindow: MEASUREMENT,
    baselineValue: null,
    observedValue: null,
    observedAbsoluteChange: null,
    observedRelativeChange: null,
    sampleSizeBefore: null,
    sampleSizeAfter: null,
    status,
    dataQuality: null,
    failureCode: null,
    provenance: [],
    measurementPolicyVersion: "measurement-policy-v1",
    measurementProfileVersion: "nextjs-seo-foundations-measurement-v1",
    evidenceSchemaVersion: "measurement-evidence-v1",
    measurementIdentity: "m".repeat(64),
    operationRunId: "operation_1",
    nextObservationAt: MEASUREMENT.end,
    startedAt: null,
    completedAt: null,
    createdAt: "2026-08-14T15:00:00.000Z",
    updatedAt: "2026-08-14T15:00:00.000Z",
    ...overrides,
  };
}

const RESULT = {
  baselineValue: 2800,
  observedValue: 3640,
  observedAbsoluteChange: 840,
  observedRelativeChange: 0.3,
  sampleSizeBefore: 2800,
  sampleSizeAfter: 3640,
  dataQuality: "complete" as const,
  completedAt: "2026-09-26T01:00:00.000Z",
};

function card(
  input: {
    plan?: MeasurementPlan | null;
    measurement?: BusinessOutcomeMeasurement | null;
    sourceConnected?: boolean;
    merged?: boolean;
    now?: Date;
  } = {},
) {
  return buildBusinessImpactCard({
    plan: input.plan === undefined ? plan() : input.plan,
    measurement: input.measurement ?? null,
    sourceConnected: input.sourceConnected ?? false,
    merged: input.merged ?? true,
    resolveFailureMessage: measurementFailureMessage,
    now: input.now ?? new Date("2026-09-05T00:00:00.000Z"),
  });
}

describe("states that are not results never read as results (§21, §22, §26)", () => {
  it("is unavailable when nothing was merged", () => {
    expect(card({ merged: false }).state).toBe("unavailable");
  });

  it("is not_planned when merged and nobody has planned yet", () => {
    expect(card({ plan: null }).state).toBe("not_planned");
  });

  it("says a source is required, and still names the metric", () => {
    const built = card({ sourceConnected: false });

    expect(built.state).toBe("source_required");
    expect(built.headline).toBe("Measurement source required");
    // The screen stays useful: it says what *would* be measured.
    expect(built.metricLabel).toBe("Search impressions");
    expect(built.businessGoal).toBeTruthy();
  });

  it("never says 'no impact' in any state", () => {
    const states = [
      card({ merged: false }),
      card({ plan: null }),
      card({ sourceConnected: false }),
      card({ sourceConnected: true }),
      card({ measurement: measurement("waiting_for_window") }),
      card({ measurement: measurement("measuring") }),
      card({ measurement: measurement("insufficient_data", { ...RESULT, baselineValue: null, observedValue: null }) }),
    ];

    for (const built of states) {
      expect(`${built.headline} ${built.ladderLabel}`.toLowerCase()).not.toContain("no impact");
    }
  });

  it("states no numbers while scheduled (§22)", () => {
    const built = card({ measurement: measurement("waiting_for_window") });

    expect(built.state).toBe("scheduled");
    expect(built.baselineValue).toBeNull();
    expect(built.observedValue).toBeNull();
    expect(built.observedRelativeChange).toBeNull();
    // No interim day count either: nothing has started.
    expect(built.daysObserved).toBeNull();
    expect(built.daysExpected).toBe(28);
  });

  it("shows the windows and when a result becomes available (§22)", () => {
    const built = card({ measurement: measurement("waiting_for_window") });

    expect(built.baselineWindow?.start).toBe(BASELINE.start);
    expect(built.measurementWindow?.end).toBe(MEASUREMENT.end);
    expect(built.resultAvailableAt).toBe(MEASUREMENT.end);
    expect(built.baselineWindow?.timezone).toBe("UTC");
  });

  it("reports factual day progress while measuring, and no verdict (§23)", () => {
    const built = card({
      measurement: measurement("measuring"),
      now: new Date("2026-09-01T00:00:00.000Z"),
    });

    expect(built.state).toBe("measuring");
    expect(built.daysObserved).toBe(3);
    expect(built.daysExpected).toBe(28);
    expect(built.observedRelativeChange).toBeNull();
    expect(built.observedChangeDisclaimer).toBeNull();
  });
});

describe("results carry their numbers and their disclaimer (§24, §25)", () => {
  it("renders an improvement with values and the disclaimer", () => {
    const built = card({ measurement: measurement("improved", RESULT) });

    expect(built.state).toBe("improved");
    expect(built.headline).toBe("Improved");
    expect(built.baselineValue).toBe(2800);
    expect(built.observedValue).toBe(3640);
    expect(built.observedRelativeChange).toBeCloseTo(0.3, 5);
    expect(built.observedChangeDisclaimer).toBe(OBSERVED_CHANGE_DISCLAIMER);
  });

  it("renders a degraded result exactly as fully as an improvement (§25)", () => {
    const degraded = card({
      measurement: measurement("degraded", {
        ...RESULT,
        observedValue: 1960,
        observedAbsoluteChange: -840,
        observedRelativeChange: -0.3,
        sampleSizeAfter: 1960,
      }),
    });

    expect(degraded.state).toBe("degraded");
    expect(degraded.headline).toBe("Degraded");
    // Nothing is withheld because the news is bad.
    expect(degraded.baselineValue).toBe(2800);
    expect(degraded.observedValue).toBe(1960);
    expect(degraded.observedRelativeChange).toBeLessThan(0);
    expect(degraded.observedChangeDisclaimer).toBe(OBSERVED_CHANGE_DISCLAIMER);
  });

  it("renders neutral with the disclaimer too", () => {
    const built = card({
      measurement: measurement("neutral", { ...RESULT, observedRelativeChange: 0.01 }),
    });

    expect(built.state).toBe("neutral");
    expect(built.observedChangeDisclaimer).toBe(OBSERVED_CHANGE_DISCLAIMER);
  });

  it("omits the disclaimer where there is no movement to qualify", () => {
    const built = card({
      measurement: measurement("insufficient_data", {
        sampleSizeBefore: 10,
        sampleSizeAfter: 8,
        dataQuality: "insufficient",
        completedAt: "2026-09-26T01:00:00.000Z",
      }),
    });

    expect(built.state).toBe("insufficient_data");
    expect(built.observedChangeDisclaimer).toBeNull();
  });

  it("shows what was needed and what was seen for insufficient data (§26)", () => {
    const built = card({
      measurement: measurement("insufficient_data", {
        sampleSizeBefore: 10,
        sampleSizeAfter: 8,
        dataQuality: "insufficient",
        completedAt: "2026-09-26T01:00:00.000Z",
      }),
    });

    expect(built.minimumObservations).toBe(500);
    expect(built.sampleSizeBefore).toBe(10);
    expect(built.sampleSizeAfter).toBe(8);
  });

  it("carries the data quality so a partial comparison can say so (§17)", () => {
    const built = card({
      measurement: measurement("improved", { ...RESULT, dataQuality: "partial" }),
    });

    expect(built.dataQuality).toBe("partial");
  });
});

describe("failures are about Vibe, never about the metric (§33)", () => {
  it("renders a source failure with its own copy", () => {
    const built = card({
      measurement: measurement("failed", {
        failureCode: "metric_source_unauthorized",
        completedAt: "2026-09-26T01:00:00.000Z",
      }),
    });

    expect(built.state).toBe("failed");
    expect(built.failureMessage).toContain("Reconnect");
    // And it states no movement at all.
    expect(built.observedRelativeChange).toBeNull();
    expect(built.baselineValue).toBeNull();
  });

  it("renders an unsupported capability as a stated absence, not a failure (§8)", () => {
    const built = card({
      plan: plan({ status: "unsupported", unsupportedReason: "No metric for this kind of change." }),
    });

    expect(built.state).toBe("unsupported");
    expect(built.failureMessage).toBe("No metric for this kind of change.");
    expect(built.canStartMeasuring).toBe(false);
  });
});

describe("the action is offered only when it can work (§34)", () => {
  it("is not offered without a source", () => {
    expect(card({ sourceConnected: false }).canStartMeasuring).toBe(false);
  });

  it("is offered with a source and no measurement yet", () => {
    expect(card({ sourceConnected: true }).canStartMeasuring).toBe(true);
  });

  it("is never offered once a measurement exists, in any state", () => {
    for (const status of [
      "waiting_for_source",
      "waiting_for_window",
      "measuring",
      "improved",
      "degraded",
      "neutral",
      "insufficient_data",
      "failed",
    ] as const) {
      expect(
        card({ sourceConnected: true, measurement: measurement(status, RESULT) }).canStartMeasuring,
      ).toBe(false);
    }
  });

  it("never offers a connect action, because no connector exists (§49)", () => {
    expect(card({ sourceConnected: false }).canConnectSource).toBe(false);
  });
});

describe("no card ever asserts causation (§10, §43)", () => {
  it("carries no causal claim in any state's copy", () => {
    const states = [
      card({ merged: false }),
      card({ plan: null }),
      card({ sourceConnected: false }),
      card({ measurement: measurement("waiting_for_window") }),
      card({ measurement: measurement("measuring") }),
      card({ measurement: measurement("improved", RESULT) }),
      card({ measurement: measurement("degraded", RESULT) }),
      card({ measurement: measurement("failed", { failureCode: "metric_source_unavailable", completedAt: "x" }) }),
    ];

    for (const built of states) {
      const copy = [built.headline, built.ladderLabel, built.failureMessage, built.observedChangeDisclaimer]
        .filter(Boolean)
        .join(" ");
      expect(findCausalClaims(copy)).toEqual([]);
      expect(built.causalEvidence).toBe(false);
    }
  });

  it("qualifies every stated movement with the disclaimer", () => {
    for (const status of ["improved", "degraded", "neutral"] as const) {
      expect(card({ measurement: measurement(status, RESULT) }).observedChangeDisclaimer).toBe(
        OBSERVED_CHANGE_DISCLAIMER,
      );
    }
  });

  it("uses a disclaimer that explicitly denies proof of causation", () => {
    expect(OBSERVED_CHANGE_DISCLAIMER).toContain("does not by itself prove");
    expect(OBSERVED_CHANGE_DISCLAIMER).toContain("caused");
  });
});

describe("the ladder label is short and never a result when there is none (§33)", () => {
  it("says not measured for every non-result state", () => {
    expect(card({ merged: false }).ladderLabel).toBe("Not measured");
    expect(card({ plan: null }).ladderLabel).toBe("Not measured");
    expect(card({ sourceConnected: false }).ladderLabel).toBe("Not measured — no source");
  });

  it("says what was observed for every result state", () => {
    expect(card({ measurement: measurement("improved", RESULT) }).ladderLabel).toBe("Improved");
    expect(card({ measurement: measurement("degraded", RESULT) }).ladderLabel).toBe("Degraded");
  });
});
