"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/modules/auth/session";
import {
  discardChange,
  DISCARD_BLOCK_MESSAGES,
  type DiscardBlockReason,
} from "@/modules/execution/discard";

/**
 * Rejecting a prepared change.
 *
 * ## What the client can say
 *
 * A project id, a prepared change id, and an explicit confirmation. It cannot
 * name the resulting status, the reason, or whose change it is — those are
 * resolved on the server from persisted state, and the two refusals that matter
 * (a standing approval, a completed merge) are read there rather than trusted
 * from a page that may be minutes stale.
 *
 * The confirmation travels as an argument for the same reason approval's does:
 * a dialog closing is a fact about a browser and authorizes nothing.
 *
 * ## What it does not do
 *
 * It does not touch GitHub. The branch and its commit stay exactly where they
 * are (rule 71) — discarding records a decision, it does not destroy an
 * artifact. It also never withdraws an approval as a side effect; that is its
 * own deliberate act with its own audit event.
 */

export type DiscardActionState =
  | { ok: true; kind: "discarded" | "already_discarded" }
  | { ok: false; error: DiscardBlockReason; message: string }
  | null;

export async function discardChangeAction(
  projectId: string,
  preparedChangeId: string,
  confirmed: boolean,
): Promise<DiscardActionState> {
  if (!confirmed) {
    return {
      ok: false,
      error: "discard_not_discardable",
      message: DISCARD_BLOCK_MESSAGES.discard_not_discardable,
    };
  }

  const session = await requireSession();
  const supabase = await createClient();

  const outcome = await discardChange(supabase, {
    projectId,
    userId: session.userId,
    preparedChangeId,
  });

  if (outcome.kind === "blocked") {
    return {
      ok: false,
      error: outcome.reason,
      message: DISCARD_BLOCK_MESSAGES[outcome.reason],
    };
  }

  // The Move becomes startable again the moment this row leaves the active
  // set, and that is decided on the server — so the page has to be re-read
  // rather than patched in the browser.
  revalidatePath(`/app/projects/${projectId}`);

  return { ok: true, kind: outcome.kind };
}
