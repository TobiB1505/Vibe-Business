import { isReviewExpired, type ReviewArtifact, type ReviewFailureCode } from "./schema";

/**
 * What a review looks like to a user (Sprint 11A §24, §29, §30).
 *
 * ## Why this is a pure function on the server
 *
 * The panel's states differ in what they offer, and offering the wrong one
 * costs money: a stale client showing **Generate comparison** for an artifact
 * that already exists buys a second browser session for images Vibe already
 * has. So the server decides from persisted state and the component renders
 * what it was given — the same discipline as the validation and preview panels.
 *
 * Expiry is evaluated here too. A comparison past its retention deadline has no
 * images left to show, and a browser clock is exactly what must not be trusted
 * to decide that.
 *
 * ## What this deliberately does not compute
 *
 * Any judgement. There is no score, no "improved", no diff percentage, no
 * verdict on the design (§30). The card carries two timestamps, a route, and
 * dimensions — facts about the capture — and the human does the reviewing.
 */

export type ReviewCardState =
  /** Nothing captured yet, and the preconditions are the caller's to check. */
  | "not_generated"
  | "capturing"
  | "ready"
  | "failed"
  /** Captured once, but past its retention deadline. The images are gone (§17). */
  | "expired";

export type ReviewCard = {
  state: ReviewCardState;
  reviewArtifactId: string | null;
  /** The live operation, so the panel can poll without inventing an id. */
  operationRunId: string | null;
  failureCode: ReviewFailureCode | null;
  /** Safe copy for a failure. Never a provider message (§31). */
  failureMessage: string | null;
  route: string | null;
  /**
   * What was photographed as "before", as observed.
   *
   * Shown so the comparison can say what it looked at. Never presented as "the
   * base commit" — production may have been anything at that moment (§20).
   */
  beforeOrigin: string | null;
  beforeCapturedAt: string | null;
  afterCapturedAt: string | null;
  width: number | null;
  height: number | null;
  expiresAt: string | null;
};

const EMPTY = {
  reviewArtifactId: null,
  operationRunId: null,
  failureCode: null,
  failureMessage: null,
  route: null,
  beforeOrigin: null,
  beforeCapturedAt: null,
  afterCapturedAt: null,
  width: null,
  height: null,
  expiresAt: null,
} as const;

export type ReviewCardInput = {
  /** The most recent review for this prepared change, in any state. */
  artifact: ReviewArtifact | null;
  failureMessage: string | null;
};

export function buildReviewCard(input: ReviewCardInput, now: Date = new Date()): ReviewCard {
  const artifact = input.artifact;
  if (!artifact) return { ...EMPTY, state: "not_generated" };

  const base = {
    reviewArtifactId: artifact.id,
    operationRunId: artifact.operationRunId,
    failureCode: artifact.failureCode,
    failureMessage: artifact.failureCode ? input.failureMessage : null,
    route: artifact.route,
    beforeOrigin: artifact.beforeOrigin,
    beforeCapturedAt: artifact.before.capturedAt,
    afterCapturedAt: artifact.after.capturedAt,
    // The "before" dimensions stand for both: the database refuses a `ready`
    // artifact whose sides differ, so one number describes the comparison.
    width: artifact.before.width,
    height: artifact.before.height,
    expiresAt: artifact.expiresAt,
  };

  if (artifact.status === "capturing") return { ...base, state: "capturing" };

  if (artifact.status === "ready") {
    // Past its deadline the images are unreachable, so the card must not offer
    // a comparison it cannot render (§41).
    if (isReviewExpired(artifact, now)) return { ...base, state: "expired" };
    return { ...base, state: "ready" };
  }

  if (artifact.status === "expired") return { ...base, state: "expired" };

  return { ...base, state: "failed" };
}
