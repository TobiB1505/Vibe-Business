import type { SupabaseClient } from "@supabase/supabase-js";
import { readLatestPerPreparedChange } from "@/lib/db/latest-per-change";
import type {
  ChangeOutcomeVerification,
  ExpectedOutcome,
  OutcomeCheckResult,
  OutcomeFailureCode,
  OutcomeProfile,
  OutcomeStatus,
} from "./schema";

/**
 * Persistence for outcome verifications (Sprint 12A §36, §37).
 *
 * ## Two clients, two very different privileges
 *
 * `createOutcomeVerification` runs under the caller's cookie-scoped client,
 * where the insert policy independently re-verifies that the merge exists, is
 * terminal `merged`, and read back exactly the commit this row claims to be
 * about. Everything below it runs under the service-role client that only
 * durable execution holds — because there is **no update policy** on this table
 * at all, so an authoritative result is unreachable from a browser by
 * construction rather than by convention.
 *
 * A user may ask what happened. A user may not answer.
 *
 * Every statement still filters on the project even under service role, exactly
 * as CLAUDE.md rule 53 requires: the client bypasses RLS, so ownership has to be
 * asserted by the query itself, taken from the persisted operation row.
 *
 * ## Why nothing here deletes
 *
 * A `not_observed` row is the most interesting row in this table — it is the
 * product declining to claim something it could not see. Deleting it would be
 * deleting the honest half of the record.
 */

const POSTGRES_UNIQUE_VIOLATION = "23505";

const COLUMNS =
  "id, user_id, project_id, change_merge_id, prepared_change_id, change_approval_id, " +
  "merged_commit_sha, capability, capability_version, outcome_profile, outcome_profile_version, " +
  "outcome_policy_version, evidence_schema_version, public_origin, effective_origin, " +
  "expected_outcome, check_results, verification_identity, operation_run_id, status, failure_code, " +
  "attempt_count, started_at, completed_at, observation_started_at, observation_completed_at, " +
  "verification_window_started_at, verification_window_ends_at, created_at, updated_at";

type Row = Record<string, unknown>;

function mapRow(row: Row): ChangeOutcomeVerification {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    projectId: String(row.project_id),
    changeMergeId: String(row.change_merge_id),
    preparedChangeId: String(row.prepared_change_id),
    changeApprovalId: String(row.change_approval_id),
    mergedCommitSha: String(row.merged_commit_sha),
    capability: String(row.capability),
    capabilityVersion: String(row.capability_version),
    outcomeProfile: row.outcome_profile as OutcomeProfile,
    outcomeProfileVersion: String(row.outcome_profile_version),
    outcomePolicyVersion: String(row.outcome_policy_version),
    evidenceSchemaVersion: String(row.evidence_schema_version),
    publicOrigin: String(row.public_origin),
    effectiveOrigin: (row.effective_origin as string | null) ?? null,
    expectedOutcome: row.expected_outcome as ExpectedOutcome,
    checkResults: (row.check_results as OutcomeCheckResult[] | null) ?? null,
    verificationIdentity: String(row.verification_identity),
    operationRunId: (row.operation_run_id as string | null) ?? null,
    status: row.status as OutcomeStatus,
    failureCode: (row.failure_code as OutcomeFailureCode | null) ?? null,
    attemptCount: Number(row.attempt_count ?? 0),
    startedAt: (row.started_at as string | null) ?? null,
    completedAt: (row.completed_at as string | null) ?? null,
    observationStartedAt: (row.observation_started_at as string | null) ?? null,
    observationCompletedAt: (row.observation_completed_at as string | null) ?? null,
    verificationWindowStartedAt: (row.verification_window_started_at as string | null) ?? null,
    verificationWindowEndsAt: (row.verification_window_ends_at as string | null) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export type CreateOutcomeVerificationResult =
  | { ok: true; verification: ChangeOutcomeVerification }
  /** The identity index refused a second verification of the same question. */
  | { ok: false; error: "already_exists" | "persistence_failed" };

/**
 * Records a requested verification (§27).
 *
 * Created as `queued` with the expectation already frozen onto it (§9). The
 * insert policy is what makes this more than an application check — a row
 * cannot exist unless the database itself can see a merged merge whose
 * read-back head is this exact commit.
 */
export async function createOutcomeVerification(
  supabase: SupabaseClient,
  params: {
    projectId: string;
    userId: string;
    changeMergeId: string;
    preparedChangeId: string;
    changeApprovalId: string;
    mergedCommitSha: string;
    capability: string;
    capabilityVersion: string;
    outcomeProfile: OutcomeProfile;
    outcomeProfileVersion: string;
    outcomePolicyVersion: string;
    evidenceSchemaVersion: string;
    publicOrigin: string;
    expectedOutcome: ExpectedOutcome;
    verificationIdentity: string;
    operationRunId: string;
  },
): Promise<CreateOutcomeVerificationResult> {
  const { data, error } = await supabase
    .from("change_outcome_verifications")
    .insert({
      project_id: params.projectId,
      user_id: params.userId,
      change_merge_id: params.changeMergeId,
      prepared_change_id: params.preparedChangeId,
      change_approval_id: params.changeApprovalId,
      merged_commit_sha: params.mergedCommitSha,
      capability: params.capability,
      capability_version: params.capabilityVersion,
      outcome_profile: params.outcomeProfile,
      outcome_profile_version: params.outcomeProfileVersion,
      outcome_policy_version: params.outcomePolicyVersion,
      evidence_schema_version: params.evidenceSchemaVersion,
      public_origin: params.publicOrigin,
      expected_outcome: params.expectedOutcome,
      verification_identity: params.verificationIdentity,
      operation_run_id: params.operationRunId,
      status: "queued",
    })
    .select(COLUMNS)
    .single();

  if (error) {
    if (error.code === POSTGRES_UNIQUE_VIOLATION) return { ok: false, error: "already_exists" };
    return { ok: false, error: "persistence_failed" };
  }
  if (!data) return { ok: false, error: "persistence_failed" };

  return { ok: true, verification: mapRow(data as unknown as Row) };
}

/**
 * The verification for one exact question, in any state except a Vibe-side
 * failure (§27).
 *
 * The authority lookup — "has this already been answered?" — and therefore
 * matched by identity, never by "the latest verification for this merge".
 */
export async function findVerificationByIdentity(
  supabase: SupabaseClient,
  params: { projectId: string; verificationIdentity: string },
): Promise<ChangeOutcomeVerification | null> {
  const { data, error } = await supabase
    .from("change_outcome_verifications")
    .select(COLUMNS)
    .eq("project_id", params.projectId)
    .eq("verification_identity", params.verificationIdentity)
    .in("status", ["queued", "observing", "verified", "partial", "not_observed"])
    .maybeSingle();

  if (error) throw error;
  return data ? mapRow(data as unknown as Row) : null;
}

/**
 * The most recent verification for a prepared change, in any state.
 *
 * A **display** question, never an authority one — the same discipline the
 * merge and approval stores apply to their own "latest" lookups.
 */
export async function getLatestVerificationForPreparedChange(
  supabase: SupabaseClient,
  params: { projectId: string; preparedChangeId: string },
): Promise<ChangeOutcomeVerification | null> {
  const { data, error } = await supabase
    .from("change_outcome_verifications")
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
export async function getLatestVerificationsForPreparedChanges(
  supabase: SupabaseClient,
  params: { projectId: string; preparedChangeIds: readonly string[] },
): Promise<Map<string, ChangeOutcomeVerification>> {
  const rows = await readLatestPerPreparedChange(supabase, {
    table: "change_outcome_verifications",
    columns: COLUMNS,
    projectId: params.projectId,
    preparedChangeIds: params.preparedChangeIds,
  });

  return new Map([...rows].map(([id, row]) => [id, mapRow(row as unknown as Row)]));
}

/** The verification a workflow step owns. Ownership comes from the operation. */
export async function findVerificationByOperation(
  supabase: SupabaseClient,
  operationRunId: string,
): Promise<ChangeOutcomeVerification | null> {
  const { data, error } = await supabase
    .from("change_outcome_verifications")
    .select(COLUMNS)
    .eq("operation_run_id", operationRunId)
    .maybeSingle();

  if (error) throw error;
  return data ? mapRow(data as unknown as Row) : null;
}

/**
 * Opens the observation window, **once** (§17, §42).
 *
 * Conditional on `verification_window_started_at is null`, which is what makes
 * this replay-safe: a re-entered step finds the window already open and gets
 * the existing row back rather than pushing the deadline out. The row is the
 * bound, not a variable in a workflow.
 */
export async function openObservationWindow(
  supabase: SupabaseClient,
  params: {
    verificationId: string;
    projectId: string;
    windowStartedAt: Date;
    windowEndsAt: Date;
  },
): Promise<ChangeOutcomeVerification | null> {
  const { error } = await supabase
    .from("change_outcome_verifications")
    .update({
      status: "observing",
      started_at: params.windowStartedAt.toISOString(),
      observation_started_at: params.windowStartedAt.toISOString(),
      verification_window_started_at: params.windowStartedAt.toISOString(),
      verification_window_ends_at: params.windowEndsAt.toISOString(),
    })
    .eq("id", params.verificationId)
    .eq("project_id", params.projectId)
    .eq("status", "queued")
    .is("verification_window_started_at", null);

  if (error) throw error;

  // Re-read rather than returning the update's own rows: on a replay the
  // conditional update matches nothing and the caller still needs the row —
  // including the deadline it must not recompute.
  const { data, error: readError } = await supabase
    .from("change_outcome_verifications")
    .select(COLUMNS)
    .eq("id", params.verificationId)
    .eq("project_id", params.projectId)
    .maybeSingle();

  if (readError) throw readError;
  return data ? mapRow(data as unknown as Row) : null;
}

/**
 * Records one observation's per-check truth.
 *
 * Overwrites rather than appends: the recorded evidence is the *latest*
 * observation, which is the one the terminal classification is made from. An
 * append-only history of seven attempts would be seven times the evidence to
 * justify one answer, and the answer is only ever about the last look.
 *
 * `attempt_count` is set from the caller's index rather than incremented, so a
 * retried step cannot inflate it — the count says how many attempts the
 * schedule reached, not how many times a step ran.
 */
export async function recordObservationAttempt(
  supabase: SupabaseClient,
  params: {
    verificationId: string;
    projectId: string;
    attemptNumber: number;
    checkResults: OutcomeCheckResult[];
    effectiveOrigin: string | null;
  },
): Promise<ChangeOutcomeVerification | null> {
  const { data, error } = await supabase
    .from("change_outcome_verifications")
    .update({
      check_results: params.checkResults,
      attempt_count: params.attemptNumber,
      ...(params.effectiveOrigin ? { effective_origin: params.effectiveOrigin } : {}),
    })
    .eq("id", params.verificationId)
    .eq("project_id", params.projectId)
    // Only while still observing. A terminal verification is immutable: a late
    // step must never rewrite an answer the user has already been shown.
    .eq("status", "observing")
    .select(COLUMNS)
    .maybeSingle();

  if (error) throw error;
  return data ? mapRow(data as unknown as Row) : null;
}

/**
 * Records the terminal product answer (§20, §21, §22).
 *
 * `verified`, `partial` and `not_observed` are all *outcomes*, so all three
 * come through here and all three carry the evidence that produced them — the
 * database refuses them otherwise.
 */
export async function completeOutcomeVerification(
  supabase: SupabaseClient,
  params: {
    verificationId: string;
    projectId: string;
    status: Extract<OutcomeStatus, "verified" | "partial" | "not_observed">;
    checkResults: OutcomeCheckResult[];
    attemptNumber: number;
    effectiveOrigin: string | null;
  },
): Promise<ChangeOutcomeVerification | null> {
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("change_outcome_verifications")
    .update({
      status: params.status,
      check_results: params.checkResults,
      attempt_count: params.attemptNumber,
      ...(params.effectiveOrigin ? { effective_origin: params.effectiveOrigin } : {}),
      observation_completed_at: now,
      completed_at: now,
      failure_code: null,
    })
    .eq("id", params.verificationId)
    .eq("project_id", params.projectId)
    .in("status", ["queued", "observing"])
    .select(COLUMNS)
    .maybeSingle();

  if (error) throw error;
  return data ? mapRow(data as unknown as Row) : null;
}

/**
 * Records that Vibe could not observe reliably (§23).
 *
 * Kept structurally separate from the three product answers, because "the
 * outcome was not observed" and "Vibe could not observe the outcome" are
 * different claims and a shared code path is how they eventually become one.
 */
export async function failOutcomeVerification(
  supabase: SupabaseClient,
  params: { verificationId: string; projectId: string; failureCode: OutcomeFailureCode },
): Promise<ChangeOutcomeVerification | null> {
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("change_outcome_verifications")
    .update({
      status: "failed",
      failure_code: params.failureCode,
      observation_completed_at: now,
      completed_at: now,
    })
    .eq("id", params.verificationId)
    .eq("project_id", params.projectId)
    .in("status", ["queued", "observing"])
    .select(COLUMNS)
    .maybeSingle();

  if (error) throw error;
  return data ? mapRow(data as unknown as Row) : null;
}
