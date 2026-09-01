import type { SupabaseClient } from "@supabase/supabase-js";
import { readLatestPerPreparedChange } from "@/lib/db/latest-per-change";
import type { ReviewClassification } from "@/modules/review/classification";
import type {
  ApprovalInvalidationReason,
  ApprovalStatus,
  ChangeApproval,
} from "./schema";

/**
 * Persistence for human approvals (Sprint 11B §12, §15, §16).
 *
 * ## Why every statement filters on the project
 *
 * The same discipline as every other store here: ownership is asserted in the
 * query rather than inherited from whichever client happens to be passed in.
 * These calls run under the caller's cookie-scoped client, where RLS is a real
 * second gate — but a store that only works because of RLS is a store that
 * silently becomes wrong the first time it is called from somewhere privileged.
 *
 * ## Why nothing here deletes
 *
 * An approval is the record of who authorized what. Revocation sets a status
 * and a timestamp; it does not remove the row, and there is no delete policy in
 * the database to make it possible through the product (§16).
 */

const POSTGRES_UNIQUE_VIOLATION = "23505";

const COLUMNS =
  "id, user_id, project_id, prepared_change_id, validation_run_id, review_artifact_id, " +
  "code_review_digest, preview_session_id, review_classification, " +
  "review_classification_policy_version, " +
  "prepared_commit_sha, prepared_base_sha, approval_policy_version, approval_identity, " +
  "status, approved_at, revoked_at, invalidated_at, invalidation_reason, created_at, updated_at";

type Row = Record<string, unknown>;

function mapRow(row: Row): ChangeApproval {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    projectId: String(row.project_id),
    preparedChangeId: String(row.prepared_change_id),
    validationRunId: String(row.validation_run_id),
    reviewArtifactId: (row.review_artifact_id as string | null) ?? null,
    codeReviewDigest: (row.code_review_digest as string | null) ?? null,
    previewSessionId: (row.preview_session_id as string | null) ?? null,
    reviewClassification: (row.review_classification as ReviewClassification | null) ?? null,
    reviewClassificationPolicyVersion:
      (row.review_classification_policy_version as string | null) ?? null,
    preparedCommitSha: String(row.prepared_commit_sha),
    preparedBaseSha: String(row.prepared_base_sha),
    approvalPolicyVersion: String(row.approval_policy_version),
    approvalIdentity: String(row.approval_identity),
    status: row.status as ApprovalStatus,
    approvedAt: String(row.approved_at),
    revokedAt: (row.revoked_at as string | null) ?? null,
    invalidatedAt: (row.invalidated_at as string | null) ?? null,
    invalidationReason: (row.invalidation_reason as ApprovalInvalidationReason | null) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export type CreateApprovalResult =
  | { ok: true; approval: ChangeApproval }
  /** The partial unique index refused a second active row for this identity. */
  | { ok: false; error: "already_active" | "persistence_failed" };

/**
 * Records one human's approval of one exact artifact (§12).
 *
 * The partial unique index is what makes a double click harmless: both requests
 * race to insert, the loser gets `23505`, and the caller resolves that to the
 * approval that already exists. The application check that precedes this is a
 * courtesy for a good error message — the index is the guarantee.
 */
export async function createApproval(
  supabase: SupabaseClient,
  params: {
    projectId: string;
    userId: string;
    preparedChangeId: string;
    validationRunId: string;
    /** Exactly one of these two is set. The database refuses any other shape. */
    reviewArtifactId: string | null;
    codeReviewDigest: string | null;
    previewSessionId: string | null;
    reviewClassification: ReviewClassification | null;
    reviewClassificationPolicyVersion: string | null;
    preparedCommitSha: string;
    preparedBaseSha: string;
    approvalPolicyVersion: string;
    approvalIdentity: string;
  },
): Promise<CreateApprovalResult> {
  const { data, error } = await supabase
    .from("change_approvals")
    .insert({
      project_id: params.projectId,
      user_id: params.userId,
      prepared_change_id: params.preparedChangeId,
      validation_run_id: params.validationRunId,
      review_artifact_id: params.reviewArtifactId,
      code_review_digest: params.codeReviewDigest,
      preview_session_id: params.previewSessionId,
      review_classification: params.reviewClassification,
      review_classification_policy_version: params.reviewClassificationPolicyVersion,
      prepared_commit_sha: params.preparedCommitSha,
      prepared_base_sha: params.preparedBaseSha,
      approval_policy_version: params.approvalPolicyVersion,
      approval_identity: params.approvalIdentity,
      status: "approved",
    })
    .select(COLUMNS)
    // `single`, not `maybeSingle`: an insert that returns no row is a failure,
    // not an absence, and an approval the caller cannot read back is one it
    // must not report as recorded.
    .single();

  if (error) {
    if (error.code === POSTGRES_UNIQUE_VIOLATION) return { ok: false, error: "already_active" };
    return { ok: false, error: "persistence_failed" };
  }
  if (!data) return { ok: false, error: "persistence_failed" };

  return { ok: true, approval: mapRow(data as unknown as Row) };
}

/** The standing approval for one exact artifact, if a human has given one. */
export async function findActiveApprovalByIdentity(
  supabase: SupabaseClient,
  params: { projectId: string; approvalIdentity: string },
): Promise<ChangeApproval | null> {
  const { data, error } = await supabase
    .from("change_approvals")
    .select(COLUMNS)
    .eq("project_id", params.projectId)
    .eq("approval_identity", params.approvalIdentity)
    .eq("status", "approved")
    .maybeSingle();

  if (error) throw error;
  return data ? mapRow(data as unknown as Row) : null;
}

/**
 * The most recent approval for one exact artifact, whatever became of it.
 *
 * Distinct from `findActiveApprovalByIdentity`, and both are needed: the active
 * lookup answers "is this approved", while this one answers "has this been
 * decided before" — which is how a revoked approval keeps its own artifact's
 * card honest instead of reading as though nothing ever happened. Ordered
 * because one identity can accumulate rows: approve, revoke, approve again.
 */
export async function findApprovalByIdentity(
  supabase: SupabaseClient,
  params: { projectId: string; approvalIdentity: string },
): Promise<ChangeApproval | null> {
  const { data, error } = await supabase
    .from("change_approvals")
    .select(COLUMNS)
    .eq("project_id", params.projectId)
    .eq("approval_identity", params.approvalIdentity)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data ? mapRow(data as unknown as Row) : null;
}

/**
 * The most recent approval for a prepared change, in any state.
 *
 * "Most recent" is a *display* question, never an authority one. The read model
 * uses this to decide what to tell the user about history — that a previous
 * approval no longer applies, or that they revoked one — and never to decide
 * that something is approved. That decision only ever comes from an identity
 * match (§24).
 */
export async function getLatestApprovalForPreparedChange(
  supabase: SupabaseClient,
  params: { projectId: string; preparedChangeId: string },
): Promise<ChangeApproval | null> {
  const { data, error } = await supabase
    .from("change_approvals")
    .select(COLUMNS)
    .eq("project_id", params.projectId)
    .eq("prepared_change_id", params.preparedChangeId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data ? mapRow(data as unknown as Row) : null;
}

/**
 * The same answer for a whole list, in one query (VB-023).
 *
 * The Agent screen assembles every prepared change at once, and asking this
 * table once per card is the cost that made one render 261 round trips. Ids
 * with no row are absent from the map, so `.get(id) ?? null` reads exactly as
 * the single-change query above.
 */
export async function getLatestApprovalsForPreparedChanges(
  supabase: SupabaseClient,
  params: { projectId: string; preparedChangeIds: readonly string[] },
): Promise<Map<string, ChangeApproval>> {
  const rows = await readLatestPerPreparedChange(supabase, {
    table: "change_approvals",
    columns: COLUMNS,
    projectId: params.projectId,
    preparedChangeIds: params.preparedChangeIds,
  });

  return new Map([...rows].map(([id, row]) => [id, mapRow(row as unknown as Row)]));
}

export async function getApproval(
  supabase: SupabaseClient,
  params: { projectId: string; approvalId: string },
): Promise<ChangeApproval | null> {
  const { data, error } = await supabase
    .from("change_approvals")
    .select(COLUMNS)
    .eq("project_id", params.projectId)
    .eq("id", params.approvalId)
    .maybeSingle();

  if (error) throw error;
  return data ? mapRow(data as unknown as Row) : null;
}

/**
 * Withdraws a standing approval (§15, §32).
 *
 * Conditional on `status = 'approved'`, which makes a second revoke a no-op
 * rather than a second write: the caller reads the row back and reports the
 * same terminal state either way. The row is never deleted and the original
 * `approved_at` is never cleared — what happened, happened.
 */
export async function revokeApproval(
  supabase: SupabaseClient,
  params: { projectId: string; approvalId: string; userId: string },
): Promise<ChangeApproval | null> {
  const { data, error } = await supabase
    .from("change_approvals")
    .update({ status: "revoked", revoked_at: new Date().toISOString() })
    .eq("project_id", params.projectId)
    .eq("id", params.approvalId)
    // Only the human who approved may withdraw it. Enforced here *and* by the
    // update policy, because one of them being the only check is how a gap
    // becomes invisible.
    .eq("user_id", params.userId)
    .eq("status", "approved")
    .select(COLUMNS)
    .maybeSingle();

  if (error) throw error;
  return data ? mapRow(data as unknown as Row) : null;
}

/**
 * Marks an approval as no longer applying to what would be merged (§13, §25).
 *
 * Called when a read notices the artifact has moved on, not by a background
 * job — nothing in this product runs on a timer, and claiming otherwise would
 * be a promise nothing keeps. The transition happens when someone looks, which
 * is the same honest model preview expiry uses.
 *
 * Conditional on `status = 'approved'` so repeated reads converge on one write
 * and a revoked approval is never rewritten into an invalidated one.
 */
export async function invalidateApproval(
  supabase: SupabaseClient,
  params: { projectId: string; approvalId: string; reason: ApprovalInvalidationReason },
): Promise<ChangeApproval | null> {
  const { data, error } = await supabase
    .from("change_approvals")
    .update({
      status: "invalidated",
      invalidated_at: new Date().toISOString(),
      invalidation_reason: params.reason,
    })
    .eq("project_id", params.projectId)
    .eq("id", params.approvalId)
    .eq("status", "approved")
    .select(COLUMNS)
    .maybeSingle();

  if (error) throw error;
  return data ? mapRow(data as unknown as Row) : null;
}
