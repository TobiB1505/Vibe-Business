import { createHash } from "node:crypto";

/**
 * What makes two agent executions "the same work" (CORE-4 §56, §59).
 *
 * ## Two identities, and why conflating them would be expensive
 *
 * ```
 * run identity        spec + policy + prompt + model      "is this the same job?"
 * candidate identity  run + the bytes it produced          "is this the same change?"
 * ```
 *
 * The first is the idempotency key. A double-click, a retried request, a
 * duplicated queue message — all resolve to one `AgentExecutionRun`, one
 * reservation and one provider execution, because they compute the same string
 * and the database has a unique index on it (§56). Nothing about the *result*
 * is in it, because the result does not exist when the claim is made.
 *
 * The second is the PreparedChange key, and it must be the opposite. Two agent
 * runs of one spec legitimately produce different code — that is what a model
 * is. If the prepared change were keyed on the spec, the second run would find
 * the first run's branch, decide it had already prepared this change, and hand
 * a reviewer bytes that no run of this execution ever produced. That is exactly
 * the silent-reuse failure `execution/identity.ts` warns about, one layer up.
 *
 * So the candidate identity includes the run **and** a digest of the accepted
 * files. Replaying the same run with the same bytes is idempotent; producing
 * different bytes is a different change, with a different branch.
 *
 * Field order is fixed rather than derived from object keys, so both hashes are
 * stable across refactors.
 */

export function computeAgentRunIdentity(params: {
  projectId: string;
  /** The immutable spec this run implements. Carries base SHA and snapshot. */
  executionSpecIdentity: string;
  /** What the runtime was allowed to do. */
  codingAgentPolicyVersion: string;
  /** What the agent was told. */
  promptCompilerVersion: string;
  /** Which model wrote the code. */
  model: string;
  /** What it could spend. */
  budgetPolicyVersion: string;
}): string {
  const canonical = JSON.stringify([
    params.projectId,
    params.executionSpecIdentity,
    params.codingAgentPolicyVersion,
    params.promptCompilerVersion,
    params.model,
    params.budgetPolicyVersion,
  ]);
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * A digest of exactly the change a candidate would write.
 *
 * Path plus content hash per file, in sorted order, and since ADR 0074 the
 * removed paths beside them. Content hashes rather than content, so this
 * function never holds a whole change in one string and never becomes a place
 * source could be persisted.
 *
 * ## Why a change with no deletions digests as it always did
 *
 * The digest is not only compared against itself. It feeds
 * `computeAgentChangeIdentity`, which is stored on `prepared_changes` and is
 * the immutable identity a human approval binds to (rule 67). Appending an
 * empty list to the canonical form would give every already-stored change a
 * different identity than the same bytes produce today — quietly reinterpreting
 * rows nobody touched. So the deletion set enters the canonical form only when
 * there is one, and the old shape keeps meaning what it meant.
 */
export function computeCandidateDigest(
  files: readonly { path: string; contentHash: string }[],
  deletions: readonly string[] = [],
): string {
  const writes = [...files]
    .map((file) => [file.path, file.contentHash])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

  const canonical = JSON.stringify(
    deletions.length === 0 ? writes : [writes, [...deletions].sort()],
  );
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * The execution identity an agent-produced PreparedChange is stored under (§59).
 *
 * Includes the base SHA for the reason Sprint 9B gives: a prepared change is a
 * commit *on top of a specific parent*, so the same files against a moved base
 * are not the same change.
 */
/**
 * The sandbox name for one agent execution.
 *
 * Derived from the run id — not from the run *identity* — for the reason
 * `sandboxNameFor` records after it cost a validation dogfood: an identity is
 * stable by design, so naming a sandbox after one guarantees that a second
 * attempt asks the provider for a name that already exists and is refused.
 *
 * Carries no project, user or repository information. A sandbox name is
 * third-party metadata, and customer identifiers do not belong there.
 */
export function agentSandboxNameFor(agentRunId: string): string {
  return `vibe-agent-${agentRunId.replace(/-/g, "").slice(0, 20)}`;
}

export function computeAgentChangeIdentity(params: {
  projectId: string;
  agentRunIdentity: string;
  baseSha: string;
  candidateDigest: string;
}): string {
  const canonical = JSON.stringify([
    params.projectId,
    params.agentRunIdentity,
    params.baseSha,
    params.candidateDigest,
  ]);
  return createHash("sha256").update(canonical).digest("hex");
}
