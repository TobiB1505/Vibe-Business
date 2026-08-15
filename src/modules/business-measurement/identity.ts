import { createHash } from "node:crypto";

/**
 * What makes two measurements "the same measurement" (Sprint 12B §35).
 *
 * ## What is in it
 *
 * The merge, the plan, the metric, **both window boundaries**, and the policy
 * version. Change any of those and the question genuinely is a different
 * question.
 *
 * The windows are the part worth dwelling on. They are in the identity
 * precisely because they must never move: a measurement whose identity survived
 * a window change could be silently recomputed over a different period and keep
 * the same row — which is exactly the retroactive rewrite §12 and §42 forbid.
 * With the windows folded in, a different period is a different measurement,
 * and the old one keeps its original meaning.
 *
 * ## What is deliberately absent
 *
 * **The metric source.** A project that connects Search Console today and
 * swaps analytics vendors next month is still asking the same question about
 * the same metric over the same period. The source is recorded as provenance,
 * not as identity — otherwise reconnecting would silently mint a second
 * measurement of a window that had already been measured.
 *
 * **The timestamp.** Two clicks on the same button are one measurement, which
 * is what makes a double click harmless: the second loses at the partial unique
 * index (§35).
 */
export function computeMeasurementIdentity(params: {
  projectId: string;
  changeMergeId: string;
  measurementPlanId: string;
  metricKey: string;
  baselineStart: string;
  baselineEnd: string;
  measurementStart: string;
  measurementEnd: string;
  measurementPolicyVersion: string;
}): string {
  // Fixed order rather than object key order, so a refactor cannot silently
  // rehash every stored measurement and orphan the rows it was meant to match.
  const canonical = JSON.stringify([
    params.projectId,
    params.changeMergeId,
    params.measurementPlanId,
    params.metricKey,
    params.baselineStart,
    params.baselineEnd,
    params.measurementStart,
    params.measurementEnd,
    params.measurementPolicyVersion,
  ]);

  return createHash("sha256").update(canonical).digest("hex");
}
