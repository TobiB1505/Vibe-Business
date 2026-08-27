import type { SupabaseClient } from "@supabase/supabase-js";
import { removeProjectScreenshots } from "../project-lifecycle/store";

/**
 * Screenshot retention, actually executed (VB-004).
 *
 * `REVIEW_POLICY.retentionMs` has been seven days since Sprint 11A, and the
 * deadline was honoured everywhere it was *read*: an expired artifact never
 * mints a signed URL, is never reused for a new comparison, and cannot back an
 * approval. What never happened is the deletion. The PNGs — images of a
 * customer's product — stayed in the bucket indefinitely, past a retention
 * period the product had declared to itself.
 *
 * ## Why it runs here
 *
 * Deleting from the bucket is service-role-only by design: `storage.objects`
 * carries a SELECT policy for owners and no INSERT, UPDATE or DELETE policy at
 * all. The screens that could notice an expired artifact run on the caller's
 * own client, so they cannot delete; only durable execution can (rule 53).
 *
 * So the sweep runs at the end of a review — the operation that *fills* this
 * bucket also empties it, and it is a moment the customer already caused, which
 * is the same doctrine the staleness backstop follows rather than introducing a
 * scheduler this product has not decided to have (rule 24).
 *
 * ## What that leaves, honestly
 *
 * A project that runs one review and never another keeps those bytes until the
 * project or account is deleted — which does sweep the whole prefix
 * (`project-lifecycle/store.ts`, ADR 0056). Retention is enforced for any
 * project still in use, and bounded by deletion for one that is not. Closing
 * the remaining case needs a scheduled sweep, which needs its own decision.
 *
 * ## Why the row is left alone
 *
 * The artifact row records that a review happened and what it concluded. It is
 * not edited to say the bytes are gone: `review_artifacts_ready_has_both_sides`
 * requires a `ready` artifact to carry both object paths, so nulling them would
 * mean either violating that check or rewriting the status into something the
 * review never was. Re-removing an object that is already gone succeeds, so a
 * later sweep repeating itself is cheap and harmless — and a dangling path is
 * never dereferenced, because every read refuses an expired artifact before it
 * signs anything.
 */

/**
 * How many expired artifacts one sweep considers.
 *
 * A loop guard rather than a product limit: V0.1 produces one artifact per
 * review, so reaching this means something else is wrong. The next review
 * takes the next batch.
 */
export const EXPIRED_SWEEP_LIMIT = 200;

export type SweepOutcome = { removed: number; failed: boolean };

export async function sweepExpiredReviewScreenshots(
  supabase: SupabaseClient,
  params: { projectId: string; now?: Date },
): Promise<SweepOutcome> {
  const now = params.now ?? new Date();

  const { data, error } = await supabase
    .from("review_artifacts")
    .select("id, before_object_path, after_object_path")
    .eq("project_id", params.projectId)
    .lt("expires_at", now.toISOString())
    .limit(EXPIRED_SWEEP_LIMIT);

  if (error) return { removed: 0, failed: true };

  const paths = ((data ?? []) as Record<string, unknown>[])
    .flatMap((row) => [row.before_object_path, row.after_object_path])
    .filter((path): path is string => typeof path === "string" && path.length > 0);

  if (paths.length === 0) return { removed: 0, failed: false };

  const removed = await removeProjectScreenshots(supabase, paths);
  return { removed: removed ? paths.length : 0, failed: !removed };
}
