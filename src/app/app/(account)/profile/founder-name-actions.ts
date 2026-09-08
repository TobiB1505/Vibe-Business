"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/modules/auth/session";
import { setFounderName } from "@/modules/auth/founder-profile";

/**
 * Recording what a founder asked to be called.
 *
 * ## What the browser is allowed to say
 *
 * One string, and only about themselves. The account is `requireSession()`'s,
 * never the form's, and the row-level policy checks it again on the way in
 * (`user_id = auth.uid()`) — a request naming somebody else has nowhere to put
 * the name and would be refused by the database if it did.
 *
 * ## Why the session client rather than the service-role one
 *
 * Because row-level security can apply here, so it should. This is an
 * ordinary authenticated write of the customer's own statement about
 * themselves; the service-role client has `select` on this table and nothing
 * more, deliberately (rule 53, and the grant in the migration).
 *
 * ## Why it revalidates two paths
 *
 * The name is on this page and in the account rail, which every signed-in
 * screen renders. Revalidating only the profile would leave a founder looking
 * at their new name here and their GitHub login one click away.
 */

export type SaveFounderNameState =
  /** Saved. `name` is what was stored, which may differ from what was typed. */
  { ok: true; name: string | null } | { ok: false; error: "save_failed" } | null;

export async function saveFounderNameAction(
  _previous: SaveFounderNameState,
  formData: FormData,
): Promise<SaveFounderNameState> {
  const session = await requireSession();
  const supabase = await createClient();

  const submitted = formData.get("displayName");

  try {
    const result = await setFounderName(
      supabase,
      session.userId,
      typeof submitted === "string" ? submitted : null,
    );

    revalidatePath("/app/profile");
    revalidatePath("/app", "layout");

    return { ok: true, name: result.name };
  } catch (error) {
    console.error("[founder-profile] could not save the name", {
      message: error instanceof Error ? error.message : "unknown",
    });

    return { ok: false, error: "save_failed" };
  }
}
