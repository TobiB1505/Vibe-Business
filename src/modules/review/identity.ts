import { createHash } from "node:crypto";
import type { ReviewProfile, ReviewSide } from "./schema";

/**
 * What makes two reviews "the same comparison" (Sprint 11A §19).
 *
 * A repeated review is not dangerous — it is a second browser session, billed
 * by the second, producing two more images of the same two things.
 *
 * ## Why the preview session is an identity input
 *
 * The obvious identity is *(prepared change, route)*. That is wrong, and the
 * reason is the whole point of §6: "after" is not a rendering of a branch, it
 * is a photograph of **one specific running sandbox**. Two previews of the same
 * commit are two different runtimes, and a comparison must say which one it
 * looked at.
 *
 * ## Why the policy version is an input
 *
 * The same reason it is for validation and preview. "These two images are
 * comparable" is a claim about viewport, settle strategy and animation
 * handling. Change any of them and a stored comparison describes conditions
 * that no longer exist, so reuse must break by construction rather than by
 * someone remembering to.
 *
 * ## What is deliberately absent
 *
 * The live origin's *content*. A screenshot of production is time-sensitive and
 * production can change between two captures of the same identity — that is
 * expected, and it is why the artifact records `capturedAt` rather than
 * pretending to pin a version of the customer's site (§20).
 */
export function computeReviewIdentity(params: {
  projectId: string;
  preparedChangeId: string;
  preparedCommitSha: string;
  validationRunId: string;
  previewSessionId: string;
  beforeOrigin: string;
  route: string;
  reviewProfile: ReviewProfile;
  reviewProfileVersion: string;
  reviewPolicyVersion: string;
}): string {
  // Fixed order rather than object key order, so a refactor cannot silently
  // rehash every stored identity.
  const canonical = JSON.stringify([
    params.projectId,
    params.preparedChangeId,
    params.preparedCommitSha,
    params.validationRunId,
    params.previewSessionId,
    params.beforeOrigin,
    params.route,
    params.reviewProfile,
    params.reviewProfileVersion,
    params.reviewPolicyVersion,
  ]);

  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * Where one side's image lives in object storage.
 *
 * ## Why the project id leads the path
 *
 * Storage authorization is a path prefix rule: the bucket's policy allows a
 * user to read only under projects they own. Putting the project first makes
 * that expressible as a policy at all, rather than as a lookup the storage
 * layer cannot perform.
 *
 * Derived, never stored as an input and never accepted from a client (§33). A
 * caller who could name the path could name someone else's.
 */
export function reviewObjectPath(params: {
  projectId: string;
  reviewArtifactId: string;
  side: ReviewSide;
}): string {
  return `${params.projectId}/${params.reviewArtifactId}/${params.side}.png`;
}

/** sha256 of the captured bytes, so an image can be shown to be the captured one. */
export function hashImage(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
