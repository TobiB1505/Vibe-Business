import { createHash } from "node:crypto";

/**
 * What makes two merges "the same merge" (Sprint 11C §20).
 *
 * ## Why the approval is part of it
 *
 * Because the approval is what authorized the write, and two different
 * approvals of the same commit are two different authorizations. Folding it in
 * means a revoked-then-re-approved change is a genuinely new merge attempt
 * rather than a re-run of the old one — which is the honest reading, since a
 * human decided twice.
 *
 * ## What is deliberately absent
 *
 * **The default branch's current head.** For the opposite reason to the
 * approval's identity: there it was excluded so a push could not unmake a
 * decision; here it is excluded so identity stays stable across the retry a
 * blocked merge invites. Where `main` is right now is a *precondition*, checked
 * live immediately before the write, and it must not silently mint a new
 * identity every time somebody else pushes.
 *
 * **The timestamp.** Two clicks on the same button are one merge, which is what
 * makes a double click harmless: the second loses at the partial unique index.
 */
export function computeMergeIdentity(params: {
  projectId: string;
  preparedChangeId: string;
  changeApprovalId: string;
  preparedCommitSha: string;
  preparedBaseSha: string;
  mergePolicyVersion: string;
}): string {
  // Fixed order rather than object key order, so a refactor cannot silently
  // rehash every stored merge and orphan the rows it was meant to match.
  const canonical = JSON.stringify([
    params.projectId,
    params.preparedChangeId,
    params.changeApprovalId,
    params.preparedCommitSha,
    params.preparedBaseSha,
    params.mergePolicyVersion,
  ]);

  return createHash("sha256").update(canonical).digest("hex");
}
