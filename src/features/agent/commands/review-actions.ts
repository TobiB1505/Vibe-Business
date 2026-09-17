"use server";

import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/modules/auth/session";
import { OPERATION_FAILURE_MESSAGES } from "@/modules/operations/messages";
import { getReviewCard, getReviewImages } from "@/modules/review/service";
import type { ReviewImages } from "@/modules/review/service";
import type { ReviewCard } from "@/modules/review/view";

/**
 * Review server actions (Sprint 11A §33, §34).
 *
 * ## Read-only since Sprint 0114
 *
 * There is no longer an action that *starts* a comparison. A preview is the
 * review now (ADR 0065), so no screen offers one — and an exported server
 * action is a reachable endpoint whether or not a screen calls it, which would
 * leave a paid browser session one crafted request away from being spent on
 * evidence nothing asks for any more.
 *
 * What remains reads historical artifacts, so an approval taken on a comparison
 * can still show what it was bound to.
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

/**
 * One reading of the review's state (UI-4 §5).
 *
 * ## Why this exists
 *
 * The panel had no status action, so while a comparison was capturing it
 * polled by calling `router.refresh()` every two and a half seconds. That
 * re-rendered the whole prepared-change route each time — every card, its
 * merge preflight, its signed image URLs — and a render can outlast the gap
 * until the next one, so each refresh superseded the one still in flight. A
 * capture of a minute cost roughly twenty-four full re-renders to learn one
 * thing.
 *
 * This is the cheap question that was missing: the same read the page already
 * performs for this card, and nothing else. The panel now refreshes on the
 * transition, once.
 *
 * Read-only. Opening or watching a review must never capture, approve or
 * spend anything — the failure copy is resolved identically to the page's, so
 * a polled card and a rendered card cannot disagree about what happened.
 */
export async function getReviewStatusAction(
  projectId: string,
  preparedChangeId: string,
): Promise<ReviewCard> {
  await requireSession();
  const supabase = await createClient();

  return await getReviewCard(supabase, {
    projectId,
    preparedChangeId,
    resolveFailureMessage: (code) =>
      OPERATION_FAILURE_MESSAGES[code as keyof typeof OPERATION_FAILURE_MESSAGES] ?? null,
  });
}
