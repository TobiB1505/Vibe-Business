import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CaptureStatus,
  ReviewArtifact,
  ReviewFailureCode,
  ReviewProfile,
  ReviewProviderId,
  ReviewSide,
  ReviewStatus,
} from "./schema";

/**
 * Persistence for review artifacts (Sprint 11A §15, §35, §36).
 *
 * The same two rules as every other store in this codebase:
 *
 *  1. **Ownership is asserted in code, not inherited from RLS.** Durable
 *     execution runs under the service-role client, which bypasses row-level
 *     security entirely, so every statement filters on a `project_id` taken
 *     from the persisted operation row (ADR 0013, CLAUDE.md rule 53).
 *  2. **Nothing large or capability-like is stored.** Object paths, hashes and
 *     dimensions — never image bytes, never page HTML, never a signed URL.
 */

const POSTGRES_UNIQUE_VIOLATION = "23505";

const COLUMNS =
  "id, project_id, user_id, prepared_change_id, validation_run_id, preview_session_id, " +
  "operation_run_id, review_profile, review_profile_version, review_policy_version, provider, " +
  "route, before_origin, before_object_path, after_object_path, before_capture_status, " +
  "after_capture_status, before_sha256, after_sha256, before_width, before_height, " +
  "after_width, after_height, before_captured_at, after_captured_at, status, failure_code, " +
  "review_identity, created_at, updated_at, expires_at";

type Row = Record<string, unknown>;

function mapRow(row: Row): ReviewArtifact {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    userId: String(row.user_id),
    preparedChangeId: String(row.prepared_change_id),
    validationRunId: String(row.validation_run_id),
    previewSessionId: String(row.preview_session_id ?? ""),
    operationRunId: String(row.operation_run_id),
    reviewProfile: row.review_profile as ReviewProfile,
    reviewProfileVersion: String(row.review_profile_version),
    reviewPolicyVersion: String(row.review_policy_version),
    provider: row.provider as ReviewProviderId,
    route: String(row.route),
    beforeOrigin: String(row.before_origin),
    before: {
      objectPath: (row.before_object_path as string | null) ?? null,
      status: row.before_capture_status as CaptureStatus,
      sha256: (row.before_sha256 as string | null) ?? null,
      width: (row.before_width as number | null) ?? null,
      height: (row.before_height as number | null) ?? null,
      capturedAt: (row.before_captured_at as string | null) ?? null,
    },
    after: {
      objectPath: (row.after_object_path as string | null) ?? null,
      status: row.after_capture_status as CaptureStatus,
      sha256: (row.after_sha256 as string | null) ?? null,
      width: (row.after_width as number | null) ?? null,
      height: (row.after_height as number | null) ?? null,
      capturedAt: (row.after_captured_at as string | null) ?? null,
    },
    status: row.status as ReviewStatus,
    failureCode: (row.failure_code as ReviewFailureCode | null) ?? null,
    reviewIdentity: String(row.review_identity),
    createdAt: String(row.created_at),
    expiresAt: String(row.expires_at),
  };
}

export type ClaimReviewResult =
  | { ok: true; artifact: ReviewArtifact }
  | { ok: false; error: "already_active" | "persistence_failed" };

/**
 * Claims the artifact before a browser session is created (§23, §43).
 *
 * The partial unique index does the real work: two concurrent clicks race to
 * insert, one loses on `23505`, and only one browser session is ever paid for.
 * The application check that precedes this is a courtesy, not the guarantee.
 */
export async function claimReviewArtifact(
  supabase: SupabaseClient,
  params: {
    projectId: string;
    userId: string;
    preparedChangeId: string;
    validationRunId: string;
    previewSessionId: string;
    operationRunId: string;
    reviewProfile: ReviewProfile;
    reviewProfileVersion: string;
    reviewPolicyVersion: string;
    provider: ReviewProviderId;
    route: string;
    beforeOrigin: string;
    reviewIdentity: string;
    expiresAt: string;
  },
): Promise<ClaimReviewResult> {
  const { data, error } = await supabase
    .from("review_artifacts")
    .insert({
      project_id: params.projectId,
      user_id: params.userId,
      prepared_change_id: params.preparedChangeId,
      validation_run_id: params.validationRunId,
      preview_session_id: params.previewSessionId,
      operation_run_id: params.operationRunId,
      review_profile: params.reviewProfile,
      review_profile_version: params.reviewProfileVersion,
      review_policy_version: params.reviewPolicyVersion,
      provider: params.provider,
      route: params.route,
      before_origin: params.beforeOrigin,
      review_identity: params.reviewIdentity,
      status: "capturing",
      expires_at: params.expiresAt,
    })
    .select(COLUMNS)
    .single();

  if (error) {
    return {
      ok: false,
      error: error.code === POSTGRES_UNIQUE_VIOLATION ? "already_active" : "persistence_failed",
    };
  }
  if (!data) return { ok: false, error: "persistence_failed" };

  return { ok: true, artifact: mapRow(data as unknown as Row) };
}

/** The live-or-ready review for one exact identity, if any (§19). */
export async function findReusableReviewArtifact(
  supabase: SupabaseClient,
  params: { projectId: string; reviewIdentity: string },
): Promise<ReviewArtifact | null> {
  const { data, error } = await supabase
    .from("review_artifacts")
    .select(COLUMNS)
    .eq("project_id", params.projectId)
    .eq("review_identity", params.reviewIdentity)
    .in("status", ["capturing", "ready"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data ? mapRow(data as unknown as Row) : null;
}

export async function findReviewByOperation(
  supabase: SupabaseClient,
  operationRunId: string,
): Promise<ReviewArtifact | null> {
  const { data, error } = await supabase
    .from("review_artifacts")
    .select(COLUMNS)
    .eq("operation_run_id", operationRunId)
    .maybeSingle();

  if (error) throw error;
  return data ? mapRow(data as unknown as Row) : null;
}

/**
 * The most recent review for one prepared change, in any state (§29).
 *
 * Scoped by prepared change rather than by preview session, so a comparison
 * stays visible after the preview it recorded has been stopped and its row
 * cleaned up. That outliving is the point of the whole artifact (§7).
 */
export async function getLatestReviewForPreparedChange(
  supabase: SupabaseClient,
  params: { projectId: string; preparedChangeId: string },
): Promise<ReviewArtifact | null> {
  const { data, error } = await supabase
    .from("review_artifacts")
    .select(COLUMNS)
    .eq("project_id", params.projectId)
    .eq("prepared_change_id", params.preparedChangeId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data ? mapRow(data as unknown as Row) : null;
}

/** One artifact the caller owns. Ownership is the query, not a later check. */
export async function getReviewArtifact(
  supabase: SupabaseClient,
  params: { projectId: string; reviewArtifactId: string },
): Promise<ReviewArtifact | null> {
  const { data, error } = await supabase
    .from("review_artifacts")
    .select(COLUMNS)
    .eq("id", params.reviewArtifactId)
    .eq("project_id", params.projectId)
    .maybeSingle();

  if (error) throw error;
  return data ? mapRow(data as unknown as Row) : null;
}

/**
 * Records one captured side.
 *
 * Written per side as each completes, so a failure after the first capture
 * still leaves a truthful row rather than an empty one — and so a retry can see
 * what already exists.
 */
export async function recordCapturedSide(
  supabase: SupabaseClient,
  params: {
    reviewArtifactId: string;
    projectId: string;
    side: ReviewSide;
    objectPath: string;
    sha256: string;
    width: number;
    height: number;
    capturedAt: string;
  },
): Promise<void> {
  const prefix = params.side;
  const { error } = await supabase
    .from("review_artifacts")
    .update({
      [`${prefix}_object_path`]: params.objectPath,
      [`${prefix}_capture_status`]: "captured",
      [`${prefix}_sha256`]: params.sha256,
      [`${prefix}_width`]: params.width,
      [`${prefix}_height`]: params.height,
      [`${prefix}_captured_at`]: params.capturedAt,
    })
    .eq("id", params.reviewArtifactId)
    .eq("project_id", params.projectId)
    .eq("status", "capturing");

  if (error) throw error;
}

/** Records that one side could not be captured. */
export async function recordFailedSide(
  supabase: SupabaseClient,
  params: { reviewArtifactId: string; projectId: string; side: ReviewSide },
): Promise<void> {
  const { error } = await supabase
    .from("review_artifacts")
    .update({ [`${params.side}_capture_status`]: "failed" })
    .eq("id", params.reviewArtifactId)
    .eq("project_id", params.projectId)
    .eq("status", "capturing");

  if (error) throw error;
}

/**
 * Writes the terminal result.
 *
 * Scoped to `status = 'capturing'` and reports whether it applied, so a
 * workflow replay cannot overwrite an already-terminal artifact.
 *
 * The database's own CHECKs are the real guarantee that `ready` means what it
 * says: both sides captured, both paths present, both hashes present, and
 * identical dimensions. This function cannot mark a one-sided or mismatched
 * comparison ready even if a caller asked it to.
 */
export async function completeReviewArtifact(
  supabase: SupabaseClient,
  params: {
    reviewArtifactId: string;
    projectId: string;
    status: "ready" | "failed";
    failureCode: ReviewFailureCode | null;
  },
): Promise<boolean> {
  const { data, error } = await supabase
    .from("review_artifacts")
    .update({ status: params.status, failure_code: params.failureCode })
    .eq("id", params.reviewArtifactId)
    .eq("project_id", params.projectId)
    .eq("status", "capturing")
    .select("id");

  if (error) throw error;
  return (data ?? []).length > 0;
}

/**
 * Records browser spend (§22, §53).
 *
 * Called only from durable execution, under the service-role client. The table
 * has **no INSERT policy** — a request-bound write would be refused by RLS and,
 * if that failure were swallowed the way a best-effort ledger write usually is,
 * the spend would vanish silently. That is exactly what happened to preview
 * usage in Sprint 10B, and it is why this write lives where it does.
 *
 * The unique index on `review_artifact_id` makes a retry safe: a second insert
 * loses at the database rather than double-counting a session that ran once.
 */
export async function recordReviewBrowserUsage(
  supabase: SupabaseClient,
  params: {
    projectId: string;
    userId: string;
    reviewArtifactId: string;
    provider: ReviewProviderId;
    status: "ready" | "failed";
    durationMs: number;
    captures: number;
    failureCode: ReviewFailureCode | null;
  },
): Promise<void> {
  const { error } = await supabase.from("review_browser_usage").insert({
    project_id: params.projectId,
    user_id: params.userId,
    review_artifact_id: params.reviewArtifactId,
    operation: "change_review",
    provider: params.provider,
    status: params.status,
    duration_ms: Math.max(0, Math.round(params.durationMs)),
    captures: params.captures,
    // Browserbase reports no attributable price with a session. A figure
    // derived from a public rate card would be a guess wearing an accounting
    // figure's clothes.
    provider_cost_usd: null,
    failure_code: params.failureCode,
  });

  // A ledger write must never take down the review that earned it — the browser
  // already ran and the spend is real either way. The unique index means a
  // retried terminal step lands here and loses, which is the outcome wanted.
  if (error) return;
}
