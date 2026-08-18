import { createHash } from "node:crypto";

/**
 * What makes two ExecutionSpecs "the same spec" (EXECUTION CORE-3 §10, §47).
 *
 * ## Why an identity rather than a row id
 *
 * Because a row id survives everything. §10 requires that once a spec has been
 * used to start an execution, its historical meaning never changes: if the user
 * revises a decision, the repository HEAD moves, the plan is replanned or the
 * policy is bumped, the answer is a **new spec**, not an edited one.
 *
 * An id cannot express that. A content hash can: change any input and the
 * identity changes, the unique index no longer covers it, and creating a new
 * row is the only path. The same construction `approvals/identity.ts` uses, for
 * the same reason — an approval of commit A must never come to apply to commit
 * B (Rule 67).
 *
 * ## What is in it, and why each field earns its place
 *
 * | Field | Why a change makes this a different spec |
 * | --- | --- |
 * | project | obvious, and it is the ownership boundary |
 * | action plan + step | a replanned step is a different instruction |
 * | base SHA | a change is a commit *on top of a specific parent* (§16) |
 * | repository snapshot | the facts the plan reasoned from |
 * | mode / execution class / risk | what kind of work was authorized |
 * | capability + version | which executor, and which generated output |
 * | business context hash | the founder decisions the work rests on (§28) |
 * | resolver / policy / risk-policy / spec-schema versions | the rules it was decided under (§36) |
 *
 * ## What is deliberately absent
 *
 * **The timestamp.** Two resolutions of an unchanged world are the same spec,
 * which is what makes re-resolution idempotent rather than a source of
 * duplicate rows.
 *
 * **The budget policy version and the reservation.** Money is bound at
 * admission, immediately before spending (§24). Folding a reservation into the
 * identity would mean a released hold silently changed what the work *was*.
 *
 * **Every free-text field.** Goal, title, purpose and done-when are the
 * Planner's prose. Including them would mean a reworded step invalidated a spec
 * whose actual instruction did not change — the same reason
 * `execution/identity.ts` excludes opportunity prose.
 */
export function computeExecutionSpecIdentity(params: {
  projectId: string;
  actionPlanId: string;
  stepKey: string;
  baseSha: string;
  repositorySnapshotId: string;
  mode: string;
  executionClass: string | null;
  riskClass: string;
  capability: string | null;
  capabilityVersion: string | null;
  businessContextHash: string;
  specSchemaVersion: string;
  resolverVersion: string;
  policyVersion: string;
  riskPolicyVersion: string;
}): string {
  // Fixed order rather than object key order, so a refactor cannot silently
  // rehash every stored spec and orphan the rows it was meant to match.
  const canonical = JSON.stringify([
    params.projectId,
    params.actionPlanId,
    params.stepKey,
    params.baseSha,
    params.repositorySnapshotId,
    params.mode,
    params.executionClass,
    params.riskClass,
    params.capability,
    params.capabilityVersion,
    params.businessContextHash,
    params.specSchemaVersion,
    params.resolverVersion,
    params.policyVersion,
    params.riskPolicyVersion,
  ]);

  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * The identity of the business input a spec was built on (§28, §10).
 *
 * Hashed rather than embedded in the spec identity directly, so that a decision
 * set of any size collapses to a fixed-width field — and so the decisions
 * themselves stay in the spec document where a reader can see them, rather than
 * being reconstructed from a hash.
 *
 * Sorted by key before hashing: the order decisions were recorded in is not
 * part of what they *are*, and letting it be would make an identical business
 * context hash differently depending on query order.
 */
export function computeBusinessContextHash(
  decisions: readonly { key: string; value: string }[],
): string {
  const canonical = JSON.stringify(
    [...decisions]
      .map((decision) => [decision.key, decision.value] as const)
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)),
  );

  return createHash("sha256").update(canonical).digest("hex");
}
