import { createHash } from "node:crypto";

/**
 * What makes two verifications "the same verification" (Sprint 12A §27).
 *
 * ## What is in it
 *
 * The merge, the exact commit the default branch was read back at, and the
 * three versions that decide what "verified" would mean — the profile, the
 * profile's own output version, and the outcome policy. Change any of those and
 * the question genuinely is a different question, so a new observation is
 * warranted (§6).
 *
 * ## What is deliberately absent
 *
 * **The public origin.** It is a *precondition*, resolved fresh from project
 * state at start and recorded on the row, not part of what makes the question
 * unique — the same treatment the merge gives the default branch's current head.
 * Folding it in would mint a new identity every time somebody edited a trailing
 * slash on their production URL.
 *
 * **The timestamp.** Two clicks on the same button are one verification, which
 * is what makes a double click harmless: the second loses at the unique index
 * and is handed the first one's operation (§27).
 *
 * ## What identity is *not* for
 *
 * Re-running. There is no re-check in v1: a terminal `not_observed` or `partial`
 * is an answer, and a button that silently re-asked the same question until it
 * got a greener one would be measurement theatre.
 */
export function computeVerificationIdentity(params: {
  projectId: string;
  changeMergeId: string;
  mergedCommitSha: string;
  outcomeProfile: string;
  outcomeProfileVersion: string;
  outcomePolicyVersion: string;
}): string {
  // Fixed order rather than object key order, so a refactor cannot silently
  // rehash every stored verification and orphan the rows it was meant to match.
  const canonical = JSON.stringify([
    params.projectId,
    params.changeMergeId,
    params.mergedCommitSha,
    params.outcomeProfile,
    params.outcomeProfileVersion,
    params.outcomePolicyVersion,
  ]);

  return createHash("sha256").update(canonical).digest("hex");
}
