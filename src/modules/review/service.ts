import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { assertPrefetchedFor } from "@/lib/db/latest-per-change";
import { recordAuditEvent } from "@/modules/audit-log/events";
import { getPreviewSession } from "@/modules/change-preview/store";
import { isPreviewExpired } from "@/modules/change-preview/schema";
import { getPreparedChange } from "@/modules/execution/store";
import type { OperationExecutor } from "@/modules/operations/executor";
import {
  createOperationRun,
  findActiveOperationByIdentity,
  getProjectOperationRunById,
  type StoredOperationRun,
} from "@/modules/operations/store";
import { buildOperationView, type OperationView } from "@/modules/operations/view";
import { getLatestValidationForPreparedChange } from "@/modules/validation/store";
import { computeReviewIdentity } from "./identity";
import { REVIEW_POLICY } from "./policy";
import {
  REVIEW_POLICY_VERSION,
  isReviewExpired,
  reviewProfileVersionFor,
  type ReviewArtifact,
  type ReviewFailureCode,
} from "./schema";
import { signScreenshot } from "./storage";
import {
  claimReviewArtifact,
  findReusableReviewArtifact,
  getLatestReviewForPreparedChange,
  getReviewArtifact,
} from "./store";
import { buildReviewCard, type ReviewCard } from "./view";

/**
 * Starting and reading a visual review (Sprint 11A §4, §6, §23, §33).
 *
 * ## What the client is allowed to say
 *
 * Three identifiers: which project, which prepared change, which preview
 * session. Plus the click itself.
 *
 * It cannot name a before URL, an after URL, a route, a viewport, a browser
 * provider, a storage path or a signed URL. Not because those are validated and
 * rejected — because there is no parameter to put them in. A caller who could
 * name the "before" URL could point Vibe's browser at anything and have the
 * result stored under their project as though it were their product.
 *
 * ## Nothing here is automatic
 *
 * A browser session costs money by the second. There is no code path that
 * captures on preview-ready, on page load, on panel open, or on validation
 * passing — only an explicit `startChangeReview` (§23, §40).
 */

export type StartReviewParams = {
  projectId: string;
  userId: string;
  preparedChangeId: string;
  /**
   * The preview to photograph as "after".
   *
   * Named by the client but never trusted as *authority*: the server re-reads
   * it scoped to the project and refuses it unless it belongs to this exact
   * prepared change and is still running (§6).
   */
  previewSessionId: string;
};

export type StartReviewOutcome =
  | { kind: "capturing"; operation: OperationView; reviewArtifactId: string }
  /** This exact comparison already exists or is in flight. No second session. */
  | { kind: "reused"; reviewArtifactId: string; status: string }
  | { kind: "running"; operation: OperationView }
  | { kind: "failed"; error: ReviewFailureCode | "project_not_found" | "execution_start_failed" };

function view(operation: StoredOperationRun): OperationView {
  return buildOperationView({
    operationId: operation.id,
    status: operation.status,
    stage: operation.stage,
    failureCode: operation.failureCode,
    resultId: operation.resultId,
    startedAt: operation.startedAt,
    completedAt: operation.completedAt,
    createdAt: operation.createdAt,
  });
}

async function ownedProject(
  supabase: SupabaseClient,
  params: { projectId: string; userId: string },
): Promise<{ productionUrl: string | null } | null> {
  const { data } = await supabase
    .from("projects")
    .select("id, production_url")
    .eq("id", params.projectId)
    .eq("user_id", params.userId)
    .maybeSingle();

  if (!data) return null;
  return { productionUrl: (data as { production_url: string | null }).production_url ?? null };
}

/**
 * Everything the review needs, resolved from server state (§33).
 *
 * Every branch returns a typed failure without creating an operation or
 * touching a browser. Ordered so the cheapest refusals come first.
 */
type ResolvedReview = {
  preparedCommitSha: string;
  validationRunId: string;
  previewSessionId: string;
  beforeOrigin: string;
  identity: string;
};

async function resolveReview(
  supabase: SupabaseClient,
  params: StartReviewParams,
  productionUrl: string | null,
): Promise<{ ok: true; value: ResolvedReview } | { ok: false; error: ReviewFailureCode }> {
  const prepared = await getPreparedChange(supabase, {
    projectId: params.projectId,
    preparedChangeId: params.preparedChangeId,
  });
  if (!prepared || prepared.status !== "prepared" || prepared.commitSha === null) {
    return { ok: false, error: "review_not_supported" };
  }

  const validation = await getLatestValidationForPreparedChange(supabase, {
    projectId: params.projectId,
    preparedChangeId: params.preparedChangeId,
  });
  // A review compares a *validated* artifact. Without that, "after" is a
  // screenshot of something nobody checked builds.
  if (!validation || validation.status !== "passed") {
    return { ok: false, error: "review_preview_required" };
  }

  const session = await getPreviewSession(supabase, {
    projectId: params.projectId,
    previewSessionId: params.previewSessionId,
  });

  // Every one of these is a refusal, and they are deliberately one code: from
  // the user's side "there is no preview to photograph" is the same situation
  // whether the session is missing, belongs to a different change, has stopped,
  // or has passed its deadline. What matters is that none of them silently
  // photographs *something else* (§6).
  if (
    !session ||
    session.preparedChangeId !== params.preparedChangeId ||
    session.validationRunId !== validation.id ||
    session.status !== "running" ||
    isPreviewExpired(session)
  ) {
    return { ok: false, error: "review_preview_required" };
  }

  // The "before" side comes from the project's own verified production URL —
  // stored normalized, HTTPS, credential-free — and from nowhere else (§5).
  if (!productionUrl) return { ok: false, error: "review_before_unavailable" };

  return {
    ok: true,
    value: {
      preparedCommitSha: prepared.commitSha,
      validationRunId: validation.id,
      previewSessionId: session.id,
      beforeOrigin: productionUrl,
      identity: computeReviewIdentity({
        projectId: params.projectId,
        preparedChangeId: params.preparedChangeId,
        preparedCommitSha: prepared.commitSha,
        validationRunId: validation.id,
        previewSessionId: session.id,
        beforeOrigin: productionUrl,
        route: REVIEW_POLICY.route,
        reviewProfile: "public_visual_review_v1",
        reviewProfileVersion: reviewProfileVersionFor("public_visual_review_v1"),
        reviewPolicyVersion: REVIEW_POLICY_VERSION,
      }),
    },
  };
}

export async function startChangeReview(
  supabase: SupabaseClient,
  executor: OperationExecutor,
  params: StartReviewParams,
): Promise<StartReviewOutcome> {
  const project = await ownedProject(supabase, params);
  if (!project) return { kind: "failed", error: "project_not_found" };

  const resolved = await resolveReview(supabase, params, project.productionUrl);
  if (!resolved.ok) return { kind: "failed", error: resolved.error };

  // Cheapest answer: this exact comparison already exists under this exact
  // policy, so a second browser session would photograph the same two things.
  const reusable = await findReusableReviewArtifact(supabase, {
    projectId: params.projectId,
    reviewIdentity: resolved.value.identity,
  });
  if (reusable && !isReviewExpired(reusable)) {
    return { kind: "reused", reviewArtifactId: reusable.id, status: reusable.status };
  }

  const running = await findActiveOperationByIdentity(supabase, {
    projectId: params.projectId,
    operationType: "change_review",
    inputIdentity: resolved.value.identity,
  });
  if (running) return { kind: "running", operation: view(running) };

  const created = await createOperationRun(supabase, {
    projectId: params.projectId,
    userId: params.userId,
    operationType: "change_review",
    inputIdentity: resolved.value.identity,
    subjectId: params.preparedChangeId,
    initiatedBy: "customer",
  });

  if (!created.ok) {
    if (created.error === "already_active") {
      const winner = await findActiveOperationByIdentity(supabase, {
        projectId: params.projectId,
        operationType: "change_review",
        inputIdentity: resolved.value.identity,
      });
      if (winner) return { kind: "running", operation: view(winner) };
    }
    return { kind: "failed", error: "review_failed" };
  }

  const claim = await claimReviewArtifact(supabase, {
    projectId: params.projectId,
    userId: params.userId,
    preparedChangeId: params.preparedChangeId,
    validationRunId: resolved.value.validationRunId,
    previewSessionId: resolved.value.previewSessionId,
    operationRunId: created.operation.id,
    reviewProfile: "public_visual_review_v1",
    reviewProfileVersion: reviewProfileVersionFor("public_visual_review_v1"),
    reviewPolicyVersion: REVIEW_POLICY_VERSION,
    provider: "browserbase",
    route: REVIEW_POLICY.route,
    beforeOrigin: resolved.value.beforeOrigin,
    reviewIdentity: resolved.value.identity,
    // Persisted at claim time, so the retention deadline exists before any
    // image does (§17).
    expiresAt: new Date(Date.now() + REVIEW_POLICY.retentionMs).toISOString(),
  });

  if (!claim.ok) {
    // The operation exists with no artifact behind it. Close it rather than
    // leaving the identity's unique index blocked by a run that never happens.
    await supabase
      .from("operation_runs")
      .update({
        status: "failed",
        failure_code: "review_failed",
        completed_at: new Date().toISOString(),
      })
      .eq("id", created.operation.id);

    return { kind: "failed", error: "review_failed" };
  }

  await recordAuditEvent(supabase, {
    userId: params.userId,
    eventType: "change_review.started",
    metadata: {
      projectId: params.projectId,
      operationId: created.operation.id,
      reviewArtifactId: claim.artifact.id,
      preparedChangeId: params.preparedChangeId,
      previewSessionId: resolved.value.previewSessionId,
      route: REVIEW_POLICY.route,
      reviewPolicyVersion: REVIEW_POLICY_VERSION,
      // The origin is the project's own verified production URL, so it is not
      // capability-like and belongs in the record of what was photographed.
      beforeOrigin: resolved.value.beforeOrigin,
    },
  });

  const started = await executor.start({
    operationId: created.operation.id,
    operationType: "change_review",
  });
  if (!started.ok) return { kind: "failed", error: "execution_start_failed" };

  const refreshed = await getProjectOperationRunById(supabase, created.operation.id);
  return {
    kind: "capturing",
    operation: view(refreshed ?? created.operation),
    reviewArtifactId: claim.artifact.id,
  };
}

/**
 * The review state for one prepared change (§24).
 *
 * A read and nothing more. Opening the panel must create no browser session, no
 * operation and no artifact — a user looking at a page has not asked to spend
 * money (§40).
 */
export async function getReviewCard(
  supabase: SupabaseClient,
  params: {
    projectId: string;
    preparedChangeId: string;
    /**
     * The latest review this change already has, when the caller read it as
     * part of a batch (VB-023). Present means "use this and read nothing";
     * absent means "read it here", which is what every single-change caller
     * still does.
     */
    prefetched?: { review: ReviewArtifact | null };
    resolveFailureMessage: (code: string) => string | null;
  },
): Promise<ReviewCard> {
  const artifact = params.prefetched
    ? assertPrefetchedFor(params.prefetched.review, params, "review")
    : await getLatestReviewForPreparedChange(supabase, {
        projectId: params.projectId,
        preparedChangeId: params.preparedChangeId,
      });

  return buildReviewCard({
    artifact,
    failureMessage: artifact?.failureCode
      ? params.resolveFailureMessage(artifact.failureCode)
      : null,
  });
}

export type ReviewImages = {
  reviewArtifactId: string;
  route: string;
  beforeOrigin: string;
  beforeCapturedAt: string | null;
  afterCapturedAt: string | null;
  width: number | null;
  height: number | null;
  /** Short-lived, server-minted, never persisted (§16, §34). */
  beforeUrl: string;
  afterUrl: string;
};

/**
 * Resolves viewable images for one artifact the caller owns (§34, §41).
 *
 * The order is the authorization: the artifact is fetched **scoped to the
 * caller's project**, checked for readiness and expiry, and only then is a
 * signed URL minted. Signing first and checking afterwards would hand out a
 * capability to whoever asked.
 *
 * Returns null for anything not viewable — another project's artifact, one that
 * is still capturing, one that failed, one past its retention deadline. An
 * expired artifact never produces a URL, whatever a stale client believes.
 */
export async function getReviewImages(
  supabase: SupabaseClient,
  params: { projectId: string; userId: string; reviewArtifactId: string },
): Promise<ReviewImages | null> {
  const project = await ownedProject(supabase, params);
  if (!project) return null;

  const artifact = await getReviewArtifact(supabase, {
    projectId: params.projectId,
    reviewArtifactId: params.reviewArtifactId,
  });
  if (!artifact) return null;
  if (artifact.status !== "ready") return null;
  if (isReviewExpired(artifact)) return null;
  if (!artifact.before.objectPath || !artifact.after.objectPath) return null;

  const [beforeUrl, afterUrl] = await Promise.all([
    signScreenshot(supabase, artifact.before.objectPath),
    signScreenshot(supabase, artifact.after.objectPath),
  ]);

  // Both or neither. A comparison missing one side is not a comparison, and a
  // half-rendered one invites exactly the misreading §32 exists to prevent.
  if (!beforeUrl || !afterUrl) return null;

  return {
    reviewArtifactId: artifact.id,
    route: artifact.route,
    beforeOrigin: artifact.beforeOrigin,
    beforeCapturedAt: artifact.before.capturedAt,
    afterCapturedAt: artifact.after.capturedAt,
    width: artifact.before.width,
    height: artifact.before.height,
    beforeUrl,
    afterUrl,
  };
}

export type { ReviewArtifact };
