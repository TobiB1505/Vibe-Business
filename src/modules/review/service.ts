import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { assertPrefetchedFor } from "@/lib/db/latest-per-change";
import { isReviewExpired, type ReviewArtifact } from "./schema";
import { signScreenshot } from "./storage";
import { getLatestReviewForPreparedChange, getReviewArtifact } from "./store";
import { buildReviewCard, type ReviewCard } from "./view";

/**
 * Reading a historical visual review (ADR 0074).
 *
 * ## What is left, and why anything is
 *
 * This module used to start one: a browser session, two screenshots, a stored
 * comparison. [ADR 0065](../../../docs/decisions/0065-the-preview-is-the-review.md)
 * replaced that with the preview a founder can click through, left the capture
 * path unreachable, and named its deletion as a later slice — once the last
 * artifact had passed its seven-day retention. It has: the only one was written
 * on 2026-08-14.
 *
 * What survives is a **read**, because one historical approval still binds to a
 * screenshot and rule 67 is about an approval keeping its meaning. A record
 * nobody can open is not a record.
 *
 * ## Nothing here spends anything
 *
 * No browser, no session, no operation, no artifact. Opening the panel is a
 * read of rows that already exist — which used to be a property this file had
 * to defend, and is now simply all it can do.
 */

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
