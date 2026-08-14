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
 *  - which comparison the human actually looked at
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
export function computeApprovalIdentity(params: {
  projectId: string;
  preparedChangeId: string;
  preparedCommitSha: string;
  preparedBaseSha: string;
  validationRunId: string;
  reviewArtifactId: string;
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
    params.reviewArtifactId,
    params.approvalPolicyVersion,
  ]);

  return createHash("sha256").update(canonical).digest("hex");
}
