import { createHash } from "node:crypto";
import type { ExecutionCapability } from "./schema";

/**
 * Execution identity (Sprint 9B §5, §14).
 *
 * What makes two preparation attempts "the same work". Two clicks on the same
 * state must produce one operation, one branch and one commit; a genuinely
 * different state must produce a new one.
 *
 * The base HEAD sha is part of it, which is the interesting choice: a prepared
 * change is a commit *on top of a specific parent*. If the default branch has
 * moved, the previously prepared change is no longer the same change, even
 * though the opportunity and capability are unchanged. Reusing it would hand
 * the user a diff against a tree that no longer exists.
 *
 * Opportunity prose is deliberately absent (§5). It is model output, so a
 * reworded title would otherwise invalidate a perfectly good prepared change
 * and buy a second branch for no reason.
 *
 * Field order is fixed rather than derived from object keys, so the hash is
 * stable across refactors.
 */
export function computeExecutionIdentity(params: {
  projectId: string;
  opportunitySetId: string;
  opportunityId: string;
  capability: ExecutionCapability;
  capabilityVersion: string;
  repositorySnapshotId: string;
  baseSha: string;
}): string {
  const canonical = JSON.stringify([
    params.projectId,
    params.opportunitySetId,
    params.opportunityId,
    params.capability,
    params.capabilityVersion,
    params.repositorySnapshotId,
    params.baseSha,
  ]);
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * The branch a given execution identity always maps to (§18).
 *
 * Derived from the identity hash, so it is deterministic (recovery can find
 * it), collision-resistant, not user-controlled, and carries no opportunity
 * text. The `vibe/` prefix makes ownership obvious in a branch list.
 */
export function branchNameFor(identity: string): string {
  return `vibe/seo-foundations-${identity.slice(0, 12)}`;
}
