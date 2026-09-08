import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { normalizeFounderName } from "./founder-name";

/**
 * What a founder asked to be called.
 *
 * ## Why this exists at all
 *
 * `identity-view.ts` next door has said since CORE-6 that this product stores
 * no name, and refused to make one up — an email address is shown whole rather
 * than truncated into a first name, because "tobivlog@outlook.de" becoming
 * "Tobi" is a guess about a person presented as a fact about them.
 *
 * That refusal was right and it is unchanged. What changes is that a name is
 * now **asked for**, which is the only way to have one without guessing. Nova
 * is the reason: an assistant that opens with "Hallo" and no name is a
 * dashboard with a friendly font.
 *
 * ## The name is the customer's own statement, so they own every write
 *
 * Every other table in this product is written by the server on a customer's
 * behalf. This one is the opposite. `service_role` is granted `select` and
 * none of INSERT, UPDATE or DELETE — the durable step that composes what Nova
 * says needs to read the name and has no business changing it, and the grant
 * is what makes that true rather than intended.
 *
 * Not a claim about the whole grant list: Supabase's platform defaults hand
 * `service_role` REFERENCES, TRIGGER and TRUNCATE on every table in `public`,
 * this one included. What is narrowed here is row modification, which is what
 * "Vibe does not change a person's name" actually means.
 *
 * ## What lives here, and what does not
 *
 * The I/O. The rule about what a name may be is `founder-name.ts` next door —
 * pure, and importable by the form, which this module is not: `server-only`
 * here is what keeps a database client out of the browser bundle.
 */

/**
 * The name on file, or null when none was given.
 *
 * Filtered on `user_id` explicitly rather than left to row-level security.
 * With a session client the policy would do it; with the service-role client
 * that policy does not apply, and rule 53 requires the ownership filter to be
 * in the query rather than in the caller's assumption. One function serving
 * both is only safe because it always filters.
 */
export async function getFounderName(
  supabase: SupabaseClient,
  userId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("founder_profiles")
    .select("display_name")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return (data as { display_name: string } | null)?.display_name ?? null;
}

export type SetFounderNameResult =
  /** Stored, and what was stored — which may differ from what was typed. */
  | { ok: true; name: string }
  /** Nothing usable was typed, so the name on file was removed. */
  | { ok: true; name: null };

/**
 * Records what a founder asked to be called, or removes it.
 *
 * An empty box clears rather than storing an empty name, because a row here
 * means "a name was given" and a row holding nothing would make that untrue.
 * The two outcomes are one function because they are one gesture from the
 * founder's side: they edited the field and saved.
 */
export async function setFounderName(
  supabase: SupabaseClient,
  userId: string,
  input: string | null | undefined,
): Promise<SetFounderNameResult> {
  const name = normalizeFounderName(input);

  if (name === null) {
    const { error } = await supabase.from("founder_profiles").delete().eq("user_id", userId);
    if (error) throw error;
    return { ok: true, name: null };
  }

  const { error } = await supabase
    .from("founder_profiles")
    .upsert({ user_id: userId, display_name: name }, { onConflict: "user_id" });

  if (error) throw error;
  return { ok: true, name };
}
