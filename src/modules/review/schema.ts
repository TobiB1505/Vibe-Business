/**
 * The visual review domain (Sprint 11A §2, §18, §31).
 *
 * ## What a ReviewArtifact is allowed to claim
 *
 * The product's trust pipeline states each gate separately rather than blurring
 * them:
 *
 * ```
 * repository_write_verified   the bytes on the branch are the bytes we meant
 * sandbox_validation_passed   those bytes install, typecheck, test and build
 * preview_available           that exact artifact runs and is reachable
 * review_artifact_available   ← this sprint
 * human_approved              someone looked and decided
 * merged / deployed           neither exists
 * ```
 *
 * `review_artifact_available` means exactly one thing:
 *
 * > Vibe captured a controlled representation of the current live product and
 * > of the prepared preview, so a person can compare them.
 *
 * It does **not** mean the change is good, that the design improved, that SEO
 * is correct, that a business outcome improved, that anyone approved it, or
 * that a merge would be safe. It is evidence *for* a human decision, never the
 * decision.
 *
 * ## Why this is not part of PreviewSession
 *
 * They have different lifetimes and different subjects. A preview is a running
 * sandbox that stops after fifteen minutes; a review artifact is two immutable
 * images of a moment. Collapsing them would mean either that a user loses their
 * comparison the instant cleanup runs correctly, or that a sandbox is kept
 * alive so a screenshot stays visible. Both are wrong, and the second costs
 * money for nothing (§7).
 */

/**
 * Review profiles (§18).
 *
 * One, deliberately, in the same tradition as the validation and preview
 * profiles: a profile is a promise about *what was compared and how*. Adding
 * "supports everything" would make the comparison meaningless, because the
 * user could no longer tell what the two images actually are.
 */
export const REVIEW_PROFILES = ["public_visual_review_v1"] as const;
export type ReviewProfile = (typeof REVIEW_PROFILES)[number];

export const REVIEW_PROFILE_VERSIONS: Record<ReviewProfile, string> = {
  public_visual_review_v1: "public-visual-review-v1",
};

export const REVIEW_PROVIDERS = ["browserbase"] as const;
export type ReviewProviderId = (typeof REVIEW_PROVIDERS)[number];

/**
 * The capture policy version (§12, §13).
 *
 * Versions, together, everything that decides whether two screenshots are
 * *comparable*:
 *
 *  - the route
 *  - viewport width, height and device scale factor
 *  - full-page vs fixed viewport
 *  - navigation timeout and settle strategy
 *  - animation handling
 *  - screenshot format
 *  - the browser capability contract
 *
 * A comparison is only meaningful if both sides were produced under identical
 * conditions, so the conditions are named once and pinned into the review
 * identity. Changing any of them changes what a stored comparison *is*, which
 * is why it lives behind a version rather than in constants someone can tune.
 */
export const REVIEW_POLICY_VERSION = "review-policy-v1" as const;

/** How far a capture got. No percentages — two captures, named plainly. */
export const REVIEW_STAGES = [
  "preflight",
  "capturing_before",
  "capturing_after",
  "persisting_artifacts",
  "completed",
] as const;
export type ReviewStage = (typeof REVIEW_STAGES)[number];

export const REVIEW_STATUSES = ["capturing", "ready", "failed", "expired"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

/** Per-side capture outcome. Recorded for both sides, always (§32). */
export const CAPTURE_STATUSES = ["pending", "captured", "failed"] as const;
export type CaptureStatus = (typeof CAPTURE_STATUSES)[number];

/**
 * Why a review could not be produced (§31).
 *
 * Stable, safe and closed. Raw provider errors never reach any of these: the
 * chain is `provider error → sanitized structured diagnostic → failure code →
 * user-safe copy`, the same discipline ADR 0015 §9 fixed for sandboxes after
 * Sprint 10A lost four runs to a swallowed message.
 */
export const REVIEW_FAILURE_CODES = [
  /** No running preview to photograph. Never started automatically (§6, §23). */
  "review_preview_required",
  /** The project has no trusted public origin to use as "before" (§5). */
  "review_before_unavailable",
  /** Nothing about this change is reviewable under the one profile that exists. */
  "review_not_supported",
  /**
   * The page needs a signed-in session, which V0.1 does not compare (§3).
   *
   * Deliberately its own code: the honest answer is "not supported yet", not
   * "capture failed". Production auth state and preview auth state are not
   * comparable without moving credentials between origins, which Vibe will not
   * do.
   */
  "review_auth_required_not_supported",
  /** The browser provider could not be reached or refused a session. */
  "review_browser_unavailable",
  "review_before_capture_failed",
  "review_after_capture_failed",
  /** The images could not be stored. A comparison with nowhere to live. */
  "review_storage_failed",
  /** Past its retention deadline. The images are gone by design (§17). */
  "review_expired",
  "review_failed",
] as const;
export type ReviewFailureCode = (typeof REVIEW_FAILURE_CODES)[number];

/** Which side of the comparison a capture is. */
export const REVIEW_SIDES = ["before", "after"] as const;
export type ReviewSide = (typeof REVIEW_SIDES)[number];

export type CapturedImage = {
  /** Storage object path. Never a URL, never signed, never client-supplied (§33). */
  objectPath: string | null;
  status: CaptureStatus;
  /** Content hash, so an image can be shown to be the one that was captured. */
  sha256: string | null;
  width: number | null;
  height: number | null;
  /** When this side was photographed. The only honest anchor for "before" (§20). */
  capturedAt: string | null;
};

export type ReviewArtifact = {
  id: string;
  projectId: string;
  userId: string;

  preparedChangeId: string;
  validationRunId: string;
  /** The exact session photographed. Never "a recent preview" (§6). */
  previewSessionId: string;
  operationRunId: string;

  reviewProfile: ReviewProfile;
  reviewProfileVersion: string;
  reviewPolicyVersion: string;
  provider: ReviewProviderId;

  /** The single compared route. Server-resolved (§4). */
  route: string;
  /**
   * The public origin photographed as "before", recorded as observed.
   *
   * Stored so a historical comparison can say *what* it looked at. It is not a
   * claim about a commit: production may have been anything at that moment,
   * and §20 is explicit that the only honest semantics are "the public live
   * product as observed at capture time".
   */
  beforeOrigin: string;

  before: CapturedImage;
  after: CapturedImage;

  status: ReviewStatus;
  failureCode: ReviewFailureCode | null;

  reviewIdentity: string;
  createdAt: string;
  /** Retention deadline. Bounded by product decision, never inherited (§17). */
  expiresAt: string;
};

export function reviewProfileVersionFor(profile: ReviewProfile): string {
  return REVIEW_PROFILE_VERSIONS[profile];
}

/**
 * A review is expired when its retention deadline has passed.
 *
 * Evaluated on the server on every read, for the same reason preview expiry is:
 * a browser clock can be stale, and an expired artifact must never produce a
 * retrieval URL (§41).
 */
export function isReviewExpired(artifact: { expiresAt: string }, now: Date = new Date()): boolean {
  const deadline = Date.parse(artifact.expiresAt);
  return Number.isFinite(deadline) && deadline <= now.getTime();
}

/**
 * Whether both sides were captured.
 *
 * A one-sided comparison is not a comparison. If either capture failed the
 * artifact is `failed`, never `ready` with a missing panel — a user shown one
 * image beside an empty box would reasonably read it as "the change removed
 * everything" (§32).
 */
export function bothSidesCaptured(artifact: {
  before: CapturedImage;
  after: CapturedImage;
}): boolean {
  return (
    artifact.before.status === "captured" &&
    artifact.after.status === "captured" &&
    artifact.before.objectPath !== null &&
    artifact.after.objectPath !== null
  );
}
