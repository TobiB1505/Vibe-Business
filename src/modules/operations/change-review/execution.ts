import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { recordAuditEvent } from "@/modules/audit-log/events";
import { resolvePreviewOrigin } from "@/modules/change-preview/orchestrator";
import { getPreviewSession } from "@/modules/change-preview/store";
import { isPreviewExpired } from "@/modules/change-preview/schema";
import type { BrowserCaptureProvider, CaptureRequest, CaptureUsage } from "@/modules/review/browser-port";
import { hashImage, reviewObjectPath } from "@/modules/review/identity";
import { REVIEW_POLICY, SCREENSHOT_STABILIZATION_CSS } from "@/modules/review/policy";
import type { ReviewArtifact, ReviewFailureCode, ReviewSide } from "@/modules/review/schema";
import { putScreenshot, removeScreenshots } from "@/modules/review/storage";
import {
  completeReviewArtifact,
  findReviewByOperation,
  recordCapturedSide,
  recordFailedSide,
  recordReviewBrowserUsage,
} from "@/modules/review/store";
import type { SandboxProvider } from "@/modules/validation/sandbox-port";
import {
  completeOperationRun,
  failOperationRun,
  getProjectOperationRunById,
  setOperationStage,
} from "../store";

/**
 * Durable steps for a visual review (Sprint 11A §21, §32).
 *
 * ## Why this is durable at all
 *
 * Two browser captures and two storage uploads are four external side effects,
 * and a browser session is billed by the second. If the initiating request
 * dies mid-capture, a request-bound implementation leaves a remote browser
 * running and an uploaded image nothing points at.
 *
 * The Sprint 10B lesson is applied ahead of time rather than after: the usage
 * ledger has **no INSERT policy**, so its write requires the service-role
 * client, and only durable execution may hold one (CLAUDE.md rule 53). A
 * request-bound review would have had its spend silently refused by RLS,
 * exactly as the first preview stop did.
 *
 * ## Why both captures happen in one step
 *
 * The comparison's meaning depends on the two images sharing a browser build,
 * a viewport and a policy. Splitting them across durable steps would put two
 * browser sessions behind one comparison — different Chrome instances,
 * different rendering, and a "difference" that is an artefact of our own
 * orchestration.
 *
 * So one session captures both, and the step reports per-side outcomes. The
 * operation's stages still name the two captures, because a user watching
 * wants to know which half is happening.
 *
 * ## Partial failure is failure
 *
 * If either side fails, the artifact is `failed` and any uploaded image is
 * removed. A one-sided comparison rendered as success reads as "the change
 * deleted the page" (§32), and the database refuses `ready` without both sides
 * anyway.
 */

export type ReviewDeps = {
  /** Service-role client: workflow steps have no user session (ADR 0013). */
  supabase: SupabaseClient;
  /**
   * The screenshot capability.
   *
   * Injected so tests can supply a fake that opens no browser. There is no
   * local-rendering implementation and there must never be one: the whole point
   * is that untrusted pages render somewhere that is not Vibe (§8).
   */
  capture: BrowserCaptureProvider;
  /**
   * The sandbox provider, used only to resolve the preview's public origin.
   *
   * The origin is capability-like and is never persisted, so it is fetched at
   * capture time from the provider that created the sandbox — never taken from
   * a row and never from a client (ADR 0016 §4).
   */
  sandbox: SandboxProvider;
};

export type ReviewStepOutcome = { ok: true } | { ok: false; failureCode: ReviewFailureCode };

async function loadContext(
  supabase: SupabaseClient,
  operationId: string,
): Promise<{ artifact: ReviewArtifact; projectId: string; userId: string } | null> {
  const operation = await getProjectOperationRunById(supabase, operationId);
  if (!operation) return null;

  const artifact = await findReviewByOperation(supabase, operationId);
  if (!artifact) return null;

  // Ownership from the persisted operation row, because the service-role client
  // bypasses RLS entirely (CLAUDE.md rule 53).
  if (artifact.projectId !== operation.projectId) return null;

  return { artifact, projectId: operation.projectId, userId: operation.userId };
}

/**
 * Step 1 — photograph both sides and store them.
 *
 * The only step that touches a browser or object storage, and the only one that
 * costs money.
 */
export async function captureReviewStep(
  deps: ReviewDeps,
  operationId: string,
): Promise<ReviewStepOutcome> {
  const loaded = await loadContext(deps.supabase, operationId);
  if (!loaded) return { ok: false, failureCode: "review_failed" };
  const { artifact, projectId, userId } = loaded;

  await setOperationStage(deps.supabase, {
    operationId,
    stage: "capturing_before",
    markRunning: true,
  });

  // The preview must still be alive to be photographed. Re-checked here rather
  // than trusted from the click: between the two there is a queue, and a
  // fifteen-minute preview can end inside it (§6).
  const session = await getPreviewSession(deps.supabase, {
    projectId,
    previewSessionId: artifact.previewSessionId,
  });
  if (!session || session.status !== "running" || isPreviewExpired(session)) {
    return { ok: false, failureCode: "review_preview_required" };
  }

  const previewOrigin = await resolvePreviewOrigin(deps.sandbox, {
    previewSessionId: session.id,
  });
  if (!previewOrigin) return { ok: false, failureCode: "review_preview_required" };

  // One policy object, read twice. This is what makes the two images
  // comparable, and writing it once is what stops the two sides drifting (§12).
  const request = (url: string): CaptureRequest => ({
    url,
    viewport: REVIEW_POLICY.viewport,
    navigationTimeoutMs: REVIEW_POLICY.navigationTimeoutMs,
    settleMs: REVIEW_POLICY.settleMs,
    captureTimeoutMs: REVIEW_POLICY.captureTimeoutMs,
    fullPage: REVIEW_POLICY.fullPage,
    stabilizationCss: REVIEW_POLICY.disableAnimations ? SCREENSHOT_STABILIZATION_CSS : null,
  });

  const beforeUrl = new URL(artifact.route, artifact.beforeOrigin).toString();
  const afterUrl = new URL(artifact.route, previewOrigin).toString();

  const { outcomes, usage } = await deps.capture.captureAll([request(beforeUrl), request(afterUrl)]);

  await setOperationStage(deps.supabase, { operationId, stage: "capturing_after" });

  const sides: readonly ReviewSide[] = ["before", "after"];
  const uploaded: string[] = [];
  let failure: ReviewFailureCode | null = null;

  for (const [index, side] of sides.entries()) {
    const outcome = outcomes[index];

    if (!outcome || !outcome.ok) {
      await recordFailedSide(deps.supabase, {
        reviewArtifactId: artifact.id,
        projectId,
        side,
      });
      // The first failure decides the code; the loop continues so the other
      // side's status is recorded truthfully rather than left `pending`.
      failure ??=
        outcome?.layer === "provider"
          ? "review_browser_unavailable"
          : side === "before"
            ? "review_before_capture_failed"
            : "review_after_capture_failed";
      continue;
    }

    const objectPath = reviewObjectPath({
      projectId,
      reviewArtifactId: artifact.id,
      side,
    });

    const stored = await putScreenshot(deps.supabase, {
      objectPath,
      bytes: outcome.value.bytes,
    });

    if (!stored.ok) {
      await recordFailedSide(deps.supabase, { reviewArtifactId: artifact.id, projectId, side });
      failure ??= "review_storage_failed";
      continue;
    }

    uploaded.push(objectPath);
    await recordCapturedSide(deps.supabase, {
      reviewArtifactId: artifact.id,
      projectId,
      side,
      objectPath,
      sha256: hashImage(outcome.value.bytes),
      width: outcome.value.width,
      height: outcome.value.height,
      capturedAt: new Date().toISOString(),
    });
  }

  await recordUsage(deps, {
    projectId,
    userId,
    artifactId: artifact.id,
    usage,
    status: failure === null ? "ready" : "failed",
    failureCode: failure,
  });

  if (failure !== null) {
    // A stored image nothing points at is a customer's product sitting in
    // storage with no owner. Removed rather than left to age out (§32).
    await removeScreenshots(deps.supabase, uploaded);
    return { ok: false, failureCode: failure };
  }

  return { ok: true };
}

/**
 * Records browser spend (§22).
 *
 * Written whether the review succeeded or failed: a session that ran cost what
 * it cost, and a ledger that only records successes systematically understates
 * unit economics. Never fails the review — the unique index makes a retry lose
 * at the database rather than double-count.
 */
async function recordUsage(
  deps: ReviewDeps,
  params: {
    projectId: string;
    userId: string;
    artifactId: string;
    usage: CaptureUsage;
    status: "ready" | "failed";
    failureCode: ReviewFailureCode | null;
  },
): Promise<void> {
  await recordReviewBrowserUsage(deps.supabase, {
    projectId: params.projectId,
    userId: params.userId,
    reviewArtifactId: params.artifactId,
    provider: deps.capture.id,
    status: params.status,
    durationMs: params.usage.durationMs,
    captures: params.usage.captures,
    failureCode: params.failureCode,
  });
}

/** Step 2 — mark the comparison ready. */
export async function completeReviewStep(deps: ReviewDeps, operationId: string): Promise<void> {
  const loaded = await loadContext(deps.supabase, operationId);
  if (!loaded) return;
  const { artifact, projectId, userId } = loaded;

  await setOperationStage(deps.supabase, { operationId, stage: "persisting_artifacts" });

  // The database refuses `ready` unless both sides are captured, both paths and
  // hashes exist, and the dimensions match. This call cannot produce a
  // one-sided or mismatched comparison even if the step logic were wrong.
  const persisted = await completeReviewArtifact(deps.supabase, {
    reviewArtifactId: artifact.id,
    projectId,
    status: "ready",
    failureCode: null,
  });

  if (persisted) {
    await recordAuditEvent(deps.supabase, {
      userId,
      eventType: "change_review.ready",
      metadata: {
        projectId,
        operationId,
        reviewArtifactId: artifact.id,
        preparedChangeId: artifact.preparedChangeId,
        previewSessionId: artifact.previewSessionId,
        route: artifact.route,
        // Object paths, never signed URLs: a signed URL is a bearer credential
        // and an audit log is durable (§16).
        beforeObjectPath: artifact.before.objectPath,
        afterObjectPath: artifact.after.objectPath,
      },
    });
  }

  await completeOperationRun(deps.supabase, { operationId, resultId: artifact.id });
}

/** Records a terminal failure on both the artifact and the operation. */
export async function failReviewStep(
  deps: ReviewDeps,
  operationId: string,
  failureCode: ReviewFailureCode,
): Promise<void> {
  const loaded = await loadContext(deps.supabase, operationId);

  if (loaded) {
    const persisted = await completeReviewArtifact(deps.supabase, {
      reviewArtifactId: loaded.artifact.id,
      projectId: loaded.projectId,
      status: "failed",
      failureCode,
    });

    if (persisted) {
      await recordAuditEvent(deps.supabase, {
        userId: loaded.userId,
        eventType: "change_review.failed",
        metadata: {
          projectId: loaded.projectId,
          operationId,
          reviewArtifactId: loaded.artifact.id,
          failureCode,
        },
      });
    }
  }

  await failOperationRun(deps.supabase, { operationId, failureCode });
}
