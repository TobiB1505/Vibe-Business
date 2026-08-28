import type { SupabaseClient } from "@supabase/supabase-js";
import { assertPrefetchedFor, assertPreparedChangeIs } from "@/lib/db/latest-per-change";
import { resolveOutcomeContract } from "@/modules/execution/outcome-contract";
import { getPreparedChange, type StoredPreparedChange } from "@/modules/execution/store";
import { normalizeProductionUrl } from "@/modules/live-product-intelligence/url";
import { getLatestMergeForPreparedChange } from "@/modules/merge/store";
import type { ChangeMerge } from "@/modules/merge/schema";
import { getSnapshotById, type StoredSnapshot } from "@/modules/repository-intelligence/store";
import { computeVerificationIdentity } from "./identity";
import {
  OUTCOME_EVIDENCE_SCHEMA_VERSION,
  OUTCOME_POLICY_VERSION,
  outcomeProfileVersionFor,
  type ExpectedOutcome,
  type OutcomeFailureCode,
  type OutcomeProfile,
} from "./schema";

/**
 * Who may be verified, and against what (Sprint 12A §10, §11).
 *
 * ## Four gates, in the order the message should name the first thing wrong
 *
 * ```
 * 1. the change was merged, terminally, and the branch was read back
 * 2. the read-back equals the approved commit
 * 3. the capability has a deterministic verifier
 * 4. a safe public origin exists
 * ```
 *
 * Blocked, failed and unmerged merges are not verifiable and never become so.
 * There is deliberately no AI fallback for an unsupported capability (§10): a
 * model asked to invent success criteria after the fact would produce criteria
 * that always seem to be met, which is the most expensive kind of nothing.
 *
 * ## Why the origin is resolved here rather than accepted
 *
 * Because a caller who could name the production URL could point Vibe's
 * outbound requests at any host on the internet. The origin comes from the
 * project row, is re-validated through the same production-URL policy that
 * refuses HTTP, credentials, internal names and unsafe literals, and the client
 * has no parameter to influence it (§11).
 */

export type OutcomeEligibility =
  | {
      eligible: true;
      changeMergeId: string;
      preparedChangeId: string;
      changeApprovalId: string;
      mergedCommitSha: string;
      capability: string;
      capabilityVersion: string;
      outcomeProfile: OutcomeProfile;
      outcomeProfileVersion: string;
      publicOrigin: string;
      expected: ExpectedOutcome;
      verificationIdentity: string;
    }
  | { eligible: false; reason: OutcomeFailureCode };

/**
 * The project's public origin, or a typed refusal (§11).
 *
 * Re-validated on read rather than trusted because it was validated on write:
 * the policy may have tightened since, and this is the last checkpoint before
 * an outbound request is planned.
 */
export type PublicOrigin =
  | { ok: true; origin: string }
  | { ok: false; reason: OutcomeFailureCode };

export async function resolvePublicOrigin(
  supabase: SupabaseClient,
  projectId: string,
): Promise<PublicOrigin> {
  const { data } = await supabase
    .from("projects")
    .select("production_url")
    .eq("id", projectId)
    .maybeSingle();

  const configured = (data as { production_url: string | null } | null)?.production_url ?? null;
  if (configured === null) return { ok: false, reason: "outcome_public_origin_unavailable" };

  const normalized = normalizeProductionUrl(configured);
  if (!normalized.ok) return { ok: false, reason: "outcome_public_origin_unavailable" };

  return { ok: true, origin: normalized.origin };
}

export type PrefetchedOutcomeInputs = {
  merge: ChangeMerge | null;
  prepared: StoredPreparedChange | null;
  publicOrigin: PublicOrigin | null;
  snapshot: StoredSnapshot | null;
};

/**
 * Whether the public outcome of one prepared change can be verified.
 *
 * Read-only and free: no provider call, no GitHub call, no outbound HTTP. It is
 * safe to run on every project-page render, which is the point — opening a page
 * must never spend anything, and must never start an observation (§43).
 */
export async function evaluateOutcomeEligibility(
  supabase: SupabaseClient,
  params: {
    projectId: string;
    preparedChangeId: string;
    /**
     * What the caller already holds (VB-023).
     *
     * The first two are rows a list render has read once for the whole list.
     * The other two are what a *merged* change costs on top: the project's
     * public origin, which is one row per project and was being read once per
     * merged change, and the repository snapshot the change was prepared
     * against, which is usually the same snapshot for every change in the list.
     *
     * `publicOrigin: null` means "resolve it here" — the caller supplies one
     * only when something in its list could reach this branch at all.
     */
    prefetched?: PrefetchedOutcomeInputs;
  },
): Promise<OutcomeEligibility> {
  const [merge, prepared] = params.prefetched
    ? [
        assertPrefetchedFor(params.prefetched.merge, params, "merge"),
        assertPreparedChangeIs(params.prefetched.prepared, params),
      ]
    : await Promise.all([
        getLatestMergeForPreparedChange(supabase, params),
        getPreparedChange(supabase, params),
      ]);

  // 1. A merge that reached `merged`. `blocked` never touched the repository
  //    and `failed` never ended verified, so neither has a production outcome
  //    to look for (§10).
  if (!merge || merge.status !== "merged") {
    return { eligible: false, reason: "outcome_merge_required" };
  }

  // 2. Exact equality with the approved commit, re-checked here rather than
  //    inherited from the merge's own claim. The database enforces it too; this
  //    is the reading that stops a verification being *offered* for something
  //    whose read-back never matched.
  if (
    merge.resultingDefaultHeadSha === null ||
    merge.resultingDefaultHeadSha !== merge.preparedCommitSha
  ) {
    return { eligible: false, reason: "outcome_merge_unverified" };
  }

  if (!prepared) return { eligible: false, reason: "outcome_merge_required" };

  const origin =
    params.prefetched?.publicOrigin ?? (await resolvePublicOrigin(supabase, params.projectId));
  if (!origin.ok) return { eligible: false, reason: origin.reason };

  // The same structured route intelligence the generator consumed. Loaded by
  // the prepared change's own snapshot id, not "the latest snapshot": a
  // contract derived from evidence the change was never prepared against would
  // be describing a different commit's product.
  const snapshot = params.prefetched
    ? params.prefetched.snapshot
    : await getSnapshotById(supabase, {
        snapshotId: prepared.repositorySnapshotId,
        projectId: params.projectId,
      });

  const contract = resolveOutcomeContract({
    capability: prepared.capability,
    publicOrigin: origin.origin,
    repository: snapshot?.result ?? null,
  });

  if (!contract.supported) return { eligible: false, reason: contract.reason };

  return {
    eligible: true,
    changeMergeId: merge.id,
    preparedChangeId: prepared.id,
    changeApprovalId: merge.changeApprovalId,
    mergedCommitSha: merge.preparedCommitSha,
    capability: prepared.capability,
    capabilityVersion: prepared.capabilityVersion,
    outcomeProfile: contract.expected.profile,
    outcomeProfileVersion: contract.expected.profileVersion,
    publicOrigin: origin.origin,
    expected: contract.expected,
    verificationIdentity: computeVerificationIdentity({
      projectId: params.projectId,
      changeMergeId: merge.id,
      mergedCommitSha: merge.preparedCommitSha,
      outcomeProfile: contract.expected.profile,
      outcomeProfileVersion: outcomeProfileVersionFor(contract.expected.profile),
      outcomePolicyVersion: OUTCOME_POLICY_VERSION,
    }),
  };
}

export { OUTCOME_EVIDENCE_SCHEMA_VERSION, OUTCOME_POLICY_VERSION };
