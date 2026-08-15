import { OBSERVED_CHANGE_DISCLAIMER, requiresObservedChangeDisclaimer } from "./causality";
import { MEASUREMENT_LADDER_LABELS, MEASUREMENT_STATUS_HEADLINES } from "./messages";
import { metricLabel } from "./metrics";
import type {
  BusinessOutcomeMeasurement,
  DataQuality,
  MeasurementFailureCode,
  MeasurementPlan,
  MeasurementWindow,
} from "./schema";
import { completedDays } from "./windows";

/**
 * What business impact looks like to a user (Sprint 12B §20–§26, §33).
 *
 * ## The four states that are not results
 *
 * ```
 * unavailable        nothing merged, so there is nothing to measure
 * source_required    no analytics connected — NOT "no impact" (§21, §48)
 * scheduled          the window has not elapsed — NOT "no impact" (§22)
 * measuring          collecting — NOT "looking good" (§23)
 * ```
 *
 * Each is a distinct card state rather than a variant of "no result yet",
 * because a user reads them completely differently and the wrong one is a
 * false claim about their business. `source_required` in particular is the
 * state **every project is in today**, and rendering it as a negative outcome
 * would report a failure of the change where there is only a gap in Vibe's
 * setup.
 *
 * ## And the three that are
 *
 * `improved`, `degraded` and `neutral` all carry the numbers and the
 * observed-change disclaimer. Negative results are never hidden: a product that
 * only reported its wins would be worth less than no measurement at all (§25).
 */

export type BusinessImpactState =
  | "unavailable"
  /** Merged, and nobody has recorded what would be measured yet. */
  | "not_planned"
  | "unsupported"
  | "source_required"
  | "scheduled"
  | "measuring"
  | "improved"
  | "degraded"
  | "neutral"
  | "insufficient_data"
  | "failed";

export type MeasurementWindowView = {
  start: string;
  end: string;
  timezone: string;
  days: number;
};

export type BusinessImpactCard = {
  state: BusinessImpactState;
  /** The headline sentence for this state. Never composed in the component. */
  headline: string;
  /** The short form used in the delivery/product/business ladder (§33). */
  ladderLabel: string;

  measurementPlanId: string | null;
  measurementId: string | null;

  /** Null unless a supported plan exists. */
  metricLabel: string | null;
  /** The founder-facing reason this metric was chosen. */
  businessGoal: string | null;

  baselineWindow: MeasurementWindowView | null;
  measurementWindow: MeasurementWindowView | null;
  /** When a result becomes computable. Shown while scheduled (§22). */
  resultAvailableAt: string | null;

  /** Factual progress only, never a prediction (§23). */
  daysObserved: number | null;
  daysExpected: number | null;

  baselineValue: number | null;
  observedValue: number | null;
  observedRelativeChange: number | null;
  sampleSizeBefore: number | null;
  sampleSizeAfter: number | null;
  /** What the metric needed in each window, for the insufficient-data copy (§26). */
  minimumObservations: number | null;
  dataQuality: DataQuality | null;

  failureCode: MeasurementFailureCode | null;
  failureMessage: string | null;

  /** Whether the panel may offer to start measuring (§34). */
  canStartMeasuring: boolean;
  /**
   * Whether a "Connect analytics" action should be offered.
   *
   * Always `false` today: Vibe has no analytics connector, and a button that
   * cannot do anything is worse than an honest sentence. When a connector
   * exists this becomes a real value (§34, §49).
   */
  canConnectSource: false;

  /**
   * The disclaimer that must accompany any stated movement (§24).
   *
   * Carried as data rather than written in the component, so a redesign cannot
   * drop it and the test that requires it has something exact to require.
   */
  observedChangeDisclaimer: string | null;
  /**
   * Whether any causal claim is supported.
   *
   * Always `false`. No experiment design exists, so no causal claim is
   * available — and the UI is required to render the distinction rather than
   * remember it (§10, §43).
   */
  causalEvidence: false;
};

export type BusinessImpactCardInput = {
  plan: MeasurementPlan | null;
  measurement: BusinessOutcomeMeasurement | null;
  /** Whether a source that can supply the plan's metric is connected. */
  sourceConnected: boolean;
  /** Whether the change reached the default branch at all. */
  merged: boolean;
  resolveFailureMessage: (code: MeasurementFailureCode) => string;
  now: Date;
};

function windowView(window: MeasurementWindow): MeasurementWindowView {
  return { start: window.start, end: window.end, timezone: window.timezone, days: window.days };
}

const EMPTY = {
  measurementPlanId: null,
  measurementId: null,
  metricLabel: null,
  businessGoal: null,
  baselineWindow: null,
  measurementWindow: null,
  resultAvailableAt: null,
  daysObserved: null,
  daysExpected: null,
  baselineValue: null,
  observedValue: null,
  observedRelativeChange: null,
  sampleSizeBefore: null,
  sampleSizeAfter: null,
  minimumObservations: null,
  dataQuality: null,
  failureCode: null,
  failureMessage: null,
  observedChangeDisclaimer: null,
} as const;

export function buildBusinessImpactCard(input: BusinessImpactCardInput): BusinessImpactCard {
  const base = { canConnectSource: false as const, causalEvidence: false as const };

  // Nothing merged: the merge and outcome panels above already explain the
  // gate, and a third component narrating it would be noise.
  if (!input.merged) {
    return {
      ...base,
      ...EMPTY,
      state: "unavailable",
      headline: "Not measured",
      ladderLabel: "Not measured",
      canStartMeasuring: false,
    };
  }

  // Merged, and no plan recorded yet.
  //
  // Deliberately not created as a side effect of rendering. A plan is a durable
  // record with an audit event, fixed *before* anyone knows the answer — the
  // same discipline as Sprint 12A's frozen expectation, and for the same
  // reason: a plan written after the numbers are visible could be chosen to
  // suit them. So the user asks for it, once, and it costs nothing (§8, §36).
  if (input.plan === null) {
    return {
      ...base,
      ...EMPTY,
      state: "not_planned",
      headline: "Not measured yet",
      ladderLabel: "Not measured",
      canStartMeasuring: false,
    };
  }

  const plan = input.plan;

  // Vibe has no metric for this capability. A complete answer, not a gap (§8).
  if (plan.status !== "ready") {
    return {
      ...base,
      ...EMPTY,
      state: "unsupported",
      headline: "No business metric defined",
      ladderLabel: "Not measured",
      measurementPlanId: plan.id,
      failureCode: "measurement_not_defined",
      failureMessage: plan.unsupportedReason ?? input.resolveFailureMessage("measurement_not_defined"),
      canStartMeasuring: false,
    };
  }

  const planFields = {
    measurementPlanId: plan.id,
    metricLabel: metricLabel(plan.primaryMetric),
    businessGoal: plan.businessGoal,
    minimumObservations: plan.minimumObservations,
  };

  const measurement = input.measurement;

  if (measurement !== null) {
    const windows = {
      baselineWindow: windowView(measurement.baselineWindow),
      measurementWindow: windowView(measurement.measurementWindow),
      resultAvailableAt: measurement.measurementWindow.end,
    };

    const shared = {
      ...base,
      ...planFields,
      ...windows,
      measurementId: measurement.id,
      dataQuality: measurement.dataQuality,
      canStartMeasuring: false,
    };

    if (measurement.status === "waiting_for_source") {
      return {
        ...shared,
        ...EMPTY,
        ...planFields,
        ...windows,
        measurementId: measurement.id,
        state: "source_required",
        headline: MEASUREMENT_STATUS_HEADLINES.waiting_for_source,
        ladderLabel: MEASUREMENT_LADDER_LABELS.waiting_for_source,
        failureCode: "metric_source_required",
        failureMessage: input.resolveFailureMessage("metric_source_required"),
        canStartMeasuring: false,
      };
    }

    if (measurement.status === "waiting_for_window") {
      return {
        ...shared,
        state: "scheduled",
        headline: MEASUREMENT_STATUS_HEADLINES.waiting_for_window,
        ladderLabel: MEASUREMENT_LADDER_LABELS.waiting_for_window,
        // Deliberately null while scheduled: nothing has been collected, and a
        // "0 of 28 days" that has not started yet reads as a stalled run.
        daysObserved: null,
        daysExpected: measurement.measurementWindow.days,
        baselineValue: null,
        observedValue: null,
        observedRelativeChange: null,
        sampleSizeBefore: null,
        sampleSizeAfter: null,
        failureCode: null,
        failureMessage: null,
        observedChangeDisclaimer: null,
      };
    }

    if (measurement.status === "measuring") {
      return {
        ...shared,
        state: "measuring",
        headline: MEASUREMENT_STATUS_HEADLINES.measuring,
        ladderLabel: MEASUREMENT_LADDER_LABELS.measuring,
        // Factual: how many complete days of the window have elapsed. Never a
        // percentage, and never an interim verdict (§23).
        daysObserved: completedDays(measurement.measurementWindow, input.now),
        daysExpected: measurement.measurementWindow.days,
        baselineValue: null,
        observedValue: null,
        observedRelativeChange: null,
        sampleSizeBefore: null,
        sampleSizeAfter: null,
        failureCode: null,
        failureMessage: null,
        observedChangeDisclaimer: null,
      };
    }

    if (measurement.status === "failed") {
      return {
        ...shared,
        state: "failed",
        headline: MEASUREMENT_STATUS_HEADLINES.failed,
        ladderLabel: MEASUREMENT_LADDER_LABELS.failed,
        daysObserved: null,
        daysExpected: measurement.measurementWindow.days,
        baselineValue: null,
        observedValue: null,
        observedRelativeChange: null,
        sampleSizeBefore: null,
        sampleSizeAfter: null,
        failureCode: measurement.failureCode,
        failureMessage: measurement.failureCode
          ? input.resolveFailureMessage(measurement.failureCode)
          : null,
        observedChangeDisclaimer: null,
      };
    }

    // A terminal result: improved, degraded, neutral or insufficient_data.
    return {
      ...shared,
      state: measurement.status,
      headline: MEASUREMENT_STATUS_HEADLINES[measurement.status],
      ladderLabel: MEASUREMENT_LADDER_LABELS[measurement.status],
      daysObserved: measurement.measurementWindow.days,
      daysExpected: measurement.measurementWindow.days,
      baselineValue: measurement.baselineValue,
      observedValue: measurement.observedValue,
      observedRelativeChange: measurement.observedRelativeChange,
      sampleSizeBefore: measurement.sampleSizeBefore,
      sampleSizeAfter: measurement.sampleSizeAfter,
      failureCode: null,
      failureMessage: null,
      // Required on every stated movement, and absent on `insufficient_data`
      // because there is no movement to qualify (§24).
      observedChangeDisclaimer: requiresObservedChangeDisclaimer(measurement.status)
        ? OBSERVED_CHANGE_DISCLAIMER
        : null,
    };
  }

  // A ready plan and no measurement yet. Whether the action can be offered is
  // decided entirely by whether a source exists — never by optimism (§34).
  if (!input.sourceConnected) {
    return {
      ...base,
      ...EMPTY,
      ...planFields,
      state: "source_required",
      headline: MEASUREMENT_STATUS_HEADLINES.waiting_for_source,
      ladderLabel: MEASUREMENT_LADDER_LABELS.waiting_for_source,
      failureCode: "metric_source_required",
      failureMessage: input.resolveFailureMessage("metric_source_required"),
      canStartMeasuring: false,
    };
  }

  return {
    ...base,
    ...EMPTY,
    ...planFields,
    state: "scheduled",
    headline: MEASUREMENT_STATUS_HEADLINES.waiting_for_window,
    ladderLabel: MEASUREMENT_LADDER_LABELS.waiting_for_window,
    daysExpected: plan.measurementDays,
    canStartMeasuring: true,
  };
}
