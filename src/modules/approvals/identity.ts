import { createHash } from "node:crypto";

/**
 * What makes two approvals "the same approval" (Sprint 11B §3, §12).
 *
 * ## Why this is not just the prepared change id
 *
 * Because a prepared change is a row, and a row can come to describe something
 * else. A re-run preparation, a new capability version, a regenerated commit —
 * each leaves the id intact and changes what it points at. An identity built on
 * the id alone would let a human's yes to commit A become a yes to commit B
 * without anyone deciding anything, which §13 forbids outright.
 *
 * So the identity is the *artifact*, spelled out:
 *
 *  - which project
 *  - which prepared change
 *  - which commit, and which base it was prepared against
 *  - which validation proved it builds
 *  - which evidence the human actually looked at
 *  - under which approval policy
 *
 * Change any one of them and this is a different thing to approve. The hash
 * makes that true by construction rather than by anyone remembering it: the new
 * artifact has a new identity, the old approval's unique index does not cover
 * it, and re-approval is the only path (§26).
 *
 * ## What is deliberately absent
 *
 * **The default branch's current head.** It is not part of what a human
 * approved, and folding it in would mean every push to `main` silently
 * invalidated a decision nobody revisited (§14). Whether a merge is *safe* is a
 * question about current state, asked at merge time by Sprint 11C — not a
 * question about what a person meant last Tuesday.
 *
 * **The timestamp.** Two approvals of the same artifact are the same approval,
 * which is what makes a double-click harmless (§12).
 */
/**
 * Which evidence a human was shown, as one opaque string.
 *
 * Two forms, tagged so they can never collide: a comparison of two screenshots,
 * or a diff of two commits. The tag is what stops a review artifact id from
 * ever hashing to the same identity as a diff digest that happened to share its
 * characters — and, more usefully, it makes the identity say *which kind of
 * review this was*, so an approval given for a diff can never come to stand for
 * a visual one.
 */
export type ApprovalEvidence =
  /** Two stored screenshots. Historical: nothing creates one from Sprint 0114. */
  | { kind: "review_artifact"; reviewArtifactId: string }
  /** A reproducible diff, for a change that alters no rendered page. */
  | { kind: "code_diff"; codeReviewDigest: string }
  /**
   * A reproducible diff *and* the interactive preview that ran beside it.
   *
   * The form a visual change takes from Sprint 0114 on. The diff is in it
   * because a preview shows what a change looks like and only the diff shows
   * what it does — so a visual approval now binds to strictly more than it did
   * when it named a photograph of one route (ADR 0065).
   */
  | { kind: "code_diff_with_preview"; codeReviewDigest: string; previewSessionId: string };

export function approvalEvidenceKey(evidence: ApprovalEvidence): string {
  if (evidence.kind === "review_artifact") {
    return `review_artifact:${evidence.reviewArtifactId}`;
  }
  if (evidence.kind === "code_diff") return `code_diff:${evidence.codeReviewDigest}`;
  return `code_diff_with_preview:${evidence.codeReviewDigest}:${evidence.previewSessionId}`;
}

export function computeApprovalIdentity(params: {
  projectId: string;
  preparedChangeId: string;
  preparedCommitSha: string;
  preparedBaseSha: string;
  validationRunId: string;
  evidence: ApprovalEvidence;
  approvalPolicyVersion: string;
}): string {
  // Fixed order rather than object key order, so a refactor cannot silently
  // rehash every stored approval and orphan the rows it was meant to match.
  const canonical = JSON.stringify([
    params.projectId,
    params.preparedChangeId,
    params.preparedCommitSha,
    params.preparedBaseSha,
    params.validationRunId,
    approvalEvidenceKey(params.evidence),
    params.approvalPolicyVersion,
  ]);

  return createHash("sha256").update(canonical).digest("hex");
}
