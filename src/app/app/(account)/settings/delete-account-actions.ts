"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/modules/auth/session";
import { startAccountErasure } from "@/modules/operations/account-erasure/service";
import { VercelWorkflowExecutor } from "@/modules/operations/vercel/executor";

/**
 * Starting an account erasure from the settings screen (ADR 0056 §4).
 *
 * ## What the browser is allowed to say
 *
 * Nothing. There is no form field and no argument: the owner is
 * `requireSession()`'s, and the RLS insert policy checks it again on the way in
 * (`user_id = auth.uid()`). A request that named somebody else would have
 * nowhere to put the name and would be refused by the database if it did.
 *
 * ## Why the session client and not the service-role one
 *
 * Because RLS can apply here, so it should. The erasure's *steps* run
 * service-role from a workflow with no session, which is the situation that
 * client exists for — starting one is an ordinary authenticated write, and
 * reaching for the RLS-bypassing client to make it would remove the second
 * check for no reason.
 *
 * ## Why this returns rather than redirects
 *
 * The account still exists when this returns; the erasure has only been
 * enqueued. Redirecting somewhere final would claim an outcome that has not
 * happened yet — the VB-003 defect in a new place. The screen re-reads the
 * operation and says what is actually true.
 */

export type DeleteAccountActionState = { ok: false; error: "erasure_start_failed" } | null;

export async function deleteAccountAction(): Promise<DeleteAccountActionState> {
  const session = await requireSession();
  const supabase = await createClient();

  const result = await startAccountErasure(supabase, new VercelWorkflowExecutor(), {
    userId: session.userId,
  });

  if (result.kind === "blocked") return { ok: false, error: "erasure_start_failed" };

  // `started` and `active` are the same answer to the person: an erasure of
  // this account is under way. Distinguishing them would only tell a
  // double-clicker which of their two clicks won.
  revalidatePath("/app/settings");
  return null;
}
