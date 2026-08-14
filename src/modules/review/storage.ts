import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Screenshot object storage (Sprint 11A §15, §16, §34).
 *
 * ## Why the images are not in Postgres
 *
 * A viewport PNG is hundreds of kilobytes. Putting binaries in ordinary columns
 * makes every query that touches the row pay for them, bloats backups, and
 * turns a `select *` into a memory problem. The images live in object storage
 * and the row keeps a **path** — never a URL, and never a signed URL.
 *
 * ## Why nothing here is public
 *
 * The bucket is private. Its only `storage.objects` policy is SELECT, for
 * objects under a project the caller owns — there is no INSERT, UPDATE or
 * DELETE policy, so writes and deletions stay service-role-only. The only route
 * to an image is a short-lived signed URL minted server-side *after* the
 * application has checked that the caller owns the project.
 *
 * That SELECT policy is not decoration. `createSignedUrl` is an RLS-checked
 * read performed with the caller's own token, so without it the owner cannot
 * sign their own screenshot — which is exactly how the first real comparison
 * failed: captured, stored, `ready`, and unviewable (ADR 0017 §9).
 *
 * That ordering is the whole authorization story: **authorize, then sign**. A
 * signed URL is a bearer credential — anyone holding it can fetch the object
 * until it expires — which is why one is never persisted, never logged, never
 * placed in an audit event, and never put into an AI prompt.
 */

export const REVIEW_BUCKET = "review-screenshots";

/**
 * How long a retrieval URL stays valid.
 *
 * Long enough to load an image and look at it; short enough that a leaked URL
 * is a small window rather than a durable capability. The page re-signs on its
 * next authorized read rather than holding one open.
 */
export const SIGNED_URL_TTL_SECONDS = 300;

export type StorageOutcome = { ok: true } | { ok: false; detail: string };

/**
 * Uploads one screenshot.
 *
 * `upsert: true` deliberately: a retried capture step writing the same path
 * must overwrite rather than fail. The path is derived from the artifact id and
 * the side, so a retry addresses exactly the object it wrote before — there is
 * no path by which it could overwrite a different artifact's image.
 */
export async function putScreenshot(
  supabase: SupabaseClient,
  params: { objectPath: string; bytes: Uint8Array },
): Promise<StorageOutcome> {
  const { error } = await supabase.storage
    .from(REVIEW_BUCKET)
    .upload(params.objectPath, params.bytes, {
      contentType: "image/png",
      upsert: true,
    });

  if (error) return { ok: false, detail: error.message };
  return { ok: true };
}

/**
 * Removes screenshots, for a comparison that will never be shown.
 *
 * Called when a review fails after one side was already uploaded: a stored
 * image nothing points at is a customer's product sitting in storage with no
 * owner and no expiry anyone is watching (§32).
 *
 * Best effort by nature — the objects also age out with the artifact's own
 * retention — but attempted, because "it will expire eventually" is not a
 * deletion policy.
 */
export async function removeScreenshots(
  supabase: SupabaseClient,
  objectPaths: readonly string[],
): Promise<void> {
  const paths = objectPaths.filter((path): path is string => Boolean(path));
  if (paths.length === 0) return;

  await supabase.storage.from(REVIEW_BUCKET).remove([...paths]);
}

/**
 * Mints a short-lived retrieval URL for one already-authorized image.
 *
 * **This function does not authorize anything.** It is the last step of a
 * sequence that must already have established ownership — the caller resolves
 * the artifact through a project-scoped query first, and only then asks for a
 * URL. Signing before checking would hand out a capability to whoever asked.
 */
export async function signScreenshot(
  supabase: SupabaseClient,
  objectPath: string,
): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(REVIEW_BUCKET)
    .createSignedUrl(objectPath, SIGNED_URL_TTL_SECONDS);

  // A URL that cannot be produced is reported as absent rather than as an
  // error: the image is simply not viewable, and the panel says so.
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}
