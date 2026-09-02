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
 * | absorbed preparation | which preparatory steps this boundary carries (§13) |
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
  /**
   * Step keys of the preparation folded into this execution, in plan order.
   *
   * Keys rather than orders: a replanned step at position 1 is a different
   * instruction, and the key is what says so. Included because two runs
   * delivering the same primary step while carrying different preparation are
   * genuinely different boundaries — the agent is asked to establish different
   * things before it writes — and a shared identity would let one be reused for
   * the other.
   */
  absorbedPreparationKeys: readonly string[];
  /**
   * Every step this run delivers, head first (`build-chain-v1`).
   *
   * Kept apart from `absorbedPreparationKeys` on purpose: preparation is
   * performed and never completed, a chained delivery is delivered and
   * completed, and a field carrying both meanings would lose one of them.
   *
   * Omitted, or a list of one, for a run that delivers a single step — which is
   * every run there was before build chains, and every run whose founder
   * declined the offer.
   */
  chainStepKeys?: readonly string[];
  specSchemaVersion: string;
  resolverVersion: string;
  policyVersion: string;
  riskPolicyVersion: string;
  /** The rules the chain above was resolved under (rule 65). */
  chainPolicyVersion?: string;
}): string {
  // Fixed order rather than object key order, so a refactor cannot silently
  // rehash every stored spec and orphan the rows it was meant to match.
  const base = [
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
    params.absorbedPreparationKeys,
    params.specSchemaVersion,
    params.resolverVersion,
    params.policyVersion,
    params.riskPolicyVersion,
  ];

  /*
   * The chain enters only when there is one, and that is not tidiness.
   *
   * This identity is hashed into `computeAgentRunIdentity`, and
   * `startAgentExecution` returns a *succeeded* run by that identity as
   * `kind: "reused"`. Appending an empty list to every canonical form would
   * give every already-stored spec a different identity than the same
   * resolution produces today — so a re-resolution of already-delivered work
   * would stop finding the run that delivered it and take a second
   * reservation. The same reasoning `coding-agent/identity.ts` records for the
   * deletion set, with the same consequence.
   *
   * A single-member chain is the same case: it *is* the head, so it says
   * nothing the `stepKey` above has not already said.
   */
  const chain = params.chainStepKeys ?? [];
  const canonical = JSON.stringify(
    chain.length > 1
      ? [...base, [params.chainPolicyVersion ?? null, chain]]
      : base,
  );

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
