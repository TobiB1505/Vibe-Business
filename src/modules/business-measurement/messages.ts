import type { MeasurementFailureCode, MeasurementStatus } from "./schema";

/**
 * User-facing copy for business measurement (Sprint 12B §21, §24, §25, §26, §33).
 *
 * ## The three sentences this file is most careful about
 *
 * **"No source connected" is not "no impact."** It is the state the product is
 * in today, for every project, and rendering it as a negative result would
 * report a failure of the change where there is only a gap in Vibe's own setup
 * (§21, §48).
 *
 * **"Insufficient data" is not "no impact" either.** There was data, and there
 * was not enough of it. The copy says what was needed and what was seen, so a
 * user can tell the difference between "this did not work" and "we cannot yet
 * tell" (§26).
 *
 * **A movement is observed, never caused.** No message in this file, and no
 * message the UI composes from it, may assert that the change produced the
 * difference. `causality.ts` holds the vocabulary and the tests enforce it
 * (§10, §43).
 */
export const MEASUREMENT_FAILURE_MESSAGES: Record<MeasurementFailureCode, string> = {
  // §21, §48. The current state of every project, and deliberately framed as a
  // missing connection rather than as a missing result.
  metric_source_required:
    "Connect an analytics source so Vibe can measure whether this change affected the business metric it was intended to improve.",

  // A coverage statement about Vibe's adapters, never about the customer's setup.
  metric_unavailable:
    "The connected source does not provide this metric, so Vibe cannot measure this change against it yet.",

  metric_source_unauthorized:
    "Vibe's access to your analytics source has expired. Reconnect it to continue measuring.",
  metric_source_unavailable:
    "Your analytics source could not be reached, so no measurement was recorded. Vibe will try again.",
  metric_source_rate_limited:
    "Your analytics source is rate limiting requests, so no measurement was recorded. Vibe will try again later.",

  // A statement about Vibe's coverage, never about the change being pointless.
  measurement_not_defined:
    "Vibe cannot yet define a business metric for this kind of change, so it will not guess at one.",

  measurement_merge_required:
    "This change has not been merged, so there is no period after it to measure.",

  // Reachable only if a metric declares a direction the classifier does not
  // implement. A Vibe-side defect, and the copy does not pretend otherwise.
  measurement_direction_unsupported:
    "Vibe cannot yet interpret this metric's target, so it will not classify the result. This is a bug — please report it.",

  measurement_not_authorized: "You do not have permission to measure outcomes in this project.",
  measurement_execution_start_failed: "This measurement could not be queued. Try again in a moment.",
  measurement_persistence_failed: "The result of this measurement could not be saved.",
  measurement_failed: "Vibe could not complete this measurement.",
};

export function measurementFailureMessage(code: MeasurementFailureCode): string {
  return MEASUREMENT_FAILURE_MESSAGES[code];
}

/**
 * The headline for each state (§20).
 *
 * Eight states, eight sentences. Five of them are not results, and none of the
 * five may read like one.
 */
export const MEASUREMENT_STATUS_HEADLINES: Record<MeasurementStatus, string> = {
  waiting_for_source: "Measurement source required",
  waiting_for_window: "Measurement scheduled",
  measuring: "Collecting post-change data",
  improved: "Improved",
  degraded: "Degraded",
  neutral: "No meaningful change",
  insufficient_data: "Insufficient data",
  failed: "Vibe could not measure this",
};

/**
 * The short label used in the delivery/product/business ladder (§33).
 *
 * Shorter than the headline and deliberately non-committal for the five
 * non-result states: a ladder row is read at a glance, and "Not measured" at a
 * glance must not be mistaken for "measured, and it was nothing".
 */
export const MEASUREMENT_LADDER_LABELS: Record<MeasurementStatus, string> = {
  waiting_for_source: "Not measured — no source",
  waiting_for_window: "Measurement scheduled",
  measuring: "Measuring",
  improved: "Improved",
  degraded: "Degraded",
  neutral: "No meaningful change",
  insufficient_data: "Insufficient data",
  failed: "Not measured",
};
