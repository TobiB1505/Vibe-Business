"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/modules/auth/session";
import { OPERATION_FAILURE_MESSAGES } from "@/modules/operations/messages";
import { VercelWorkflowExecutor } from "@/modules/operations/vercel/executor";
import { getReviewImages, startChangeReview } from "@/modules/review/service";
import type { ReviewImages } from "@/modules/review/service";

/**
 * Review server actions (Sprint 11A §33, §34).
 *
 * A thin, safe boundary and nothing more. Every action:
 *
 *  1. resolves the user from the server session — `userId` is never accepted
 *     from the client, so a caller cannot act as someone else;
 *  2. delegates every decision to the service, which owns ownership,
 *     eligibility, the route, the viewport, the provider and the storage path;
 *  3. returns typed failures and short-lived URLs, never a provider error and
 *     never a persistent capability.
 *
 * ## What the client can say
 *
 * A project id, a prepared change id, a preview session id, a review artifact
 * id. Four identifiers, all re-checked server-side against the caller's own
 * project.
 *
 * It cannot name a before URL, an after URL, a route, a viewport, a browser
 * provider, a storage path or a signed URL. A caller who could name the
 * "before" URL could point Vibe's browser at any site on the internet and have
 * the screenshot stored under their project as though it were their product.
 */

export type StartReviewActionState =
  | { ok: true; kind: "capturing"; reviewArtifactId: string; operationId: string }
  /** This exact comparison already exists. No second browser session (§19). */
  | { ok: true; kind: "reused"; reviewArtifactId: string; status: string }
  | { ok: true; kind: "running"; operationId: string }
  | { ok: false; error: string; message: string }
  | null;

function failureMessage(code: string): string {
  return (
    OPERATION_FAILURE_MESSAGES[code as keyof typeof OPERATION_FAILURE_MESSAGES] ??
    "The comparison could not be created."
  );
}

/**
 * Starts one comparison.
 *
 * Reached only from an explicit click. There is no caller that runs this on
 * render, on poll, or when a preview becomes ready — a browser session costs
 * money by the second, and spending it without being asked is the invisible
 * cost CLAUDE.md rule 60 forbids (§23, §40).
 */
export async function startReviewAction(
  projectId: string,
  preparedChangeId: string,
  previewSessionId: string,
): Promise<NonNullable<StartReviewActionState>> {
  const session = await requireSession();
  const supabase = await createClient();

  const outcome = await startChangeReview(supabase, new VercelWorkflowExecutor(), {
    projectId,
    userId: session.userId,
    preparedChangeId,
    previewSessionId,
  });

  switch (outcome.kind) {
    case "capturing":
      revalidatePath(`/app/projects/${projectId}`);
      return {
        ok: true,
        kind: "capturing",
        reviewArtifactId: outcome.reviewArtifactId,
        operationId: outcome.operation.operationId,
      };
    case "reused":
      revalidatePath(`/app/projects/${projectId}`);
      return {
        ok: true,
        kind: "reused",
        reviewArtifactId: outcome.reviewArtifactId,
        status: outcome.status,
      };
    case "running":
      return { ok: true, kind: "running", operationId: outcome.operation.operationId };
    case "failed":
      return { ok: false, error: outcome.error, message: failureMessage(outcome.error) };
  }
}

export type ReviewImagesActionState = { ok: true; images: ReviewImages } | { ok: false };

/**
 * Resolves viewable images for one comparison.
 *
 * The signed URLs are minted inside this call, after the service has confirmed
 * the caller owns the project and the artifact is ready and unexpired. They are
 * short-lived by construction and are never persisted — the panel re-asks on
 * its next authorized read rather than holding one open (§16, §34).
 */
export async function getReviewImagesAction(
  projectId: string,
  reviewArtifactId: string,
): Promise<ReviewImagesActionState> {
  const session = await requireSession();
  const supabase = await createClient();

  const images = await getReviewImages(supabase, {
    projectId,
    userId: session.userId,
    reviewArtifactId,
  });

  // Null covers every refusal — another project's artifact, one still
  // capturing, one that failed, one past retention. The boundary must not
  // invent a shape or explain which, because a caller guessing ids learns
  // nothing from a uniform answer.
  if (!images) return { ok: false };
  return { ok: true, images };
}
