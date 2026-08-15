"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/modules/auth/session";
import { VercelWorkflowExecutor } from "@/modules/operations/vercel/executor";
import type { OperationView } from "@/modules/operations/view";
import { outcomeFailureMessage } from "@/modules/outcome-verification/messages";
import type { OutcomeFailureCode } from "@/modules/outcome-verification/schema";
import { getOutcomeCard, startOutcomeVerification } from "@/modules/outcome-verification/service";
import type { OutcomeCard } from "@/modules/outcome-verification/view";

/**
 * The outcome verification server actions (Sprint 12A §11, §25, §26).
 *
 * ## What the client can say
 *
 * A project id and a prepared change id. That is the entire surface.
 *
 * It cannot name the production URL, the hostname, the protocol, a path, a
 * redirect target, the endpoints to request, the expected outcome or the
 * observation window. Not because those are validated and rejected — because
 * there is no parameter to put them in (§11). Every one of them is resolved on
 * the server from persisted project state, and the outbound requests go through
 * the safe-fetch boundary regardless.
 *
 * ## Why there is no `confirmed` argument
 *
 * Because this action has nothing to confirm. It makes a handful of read-only
 * GETs against the customer's own public website and writes nothing anywhere
 * else. The merge action takes an explicit confirmation because it moves
 * somebody's default branch; copying that ceremony here would teach users to
 * click through dialogs, which is how the one that matters stops being read
 * (§26).
 *
 * ## What this action does not do
 *
 * It does not observe. It enqueues a durable operation that owns a fifteen
 * minute window, so a closed browser tab cannot leave a verification
 * half-finished — and so nothing is holding an HTTP request open while a
 * customer's deployment finishes (§18).
 */

export type OutcomeActionState =
  | { ok: true; kind: "started" | "active"; operation: OperationView | null }
  | { ok: false; error: OutcomeFailureCode; message: string }
  | null;

export async function checkProductionOutcomeAction(
  projectId: string,
  preparedChangeId: string,
): Promise<NonNullable<OutcomeActionState>> {
  const session = await requireSession();
  const supabase = await createClient();

  const outcome = await startOutcomeVerification(supabase, new VercelWorkflowExecutor(), {
    projectId,
    userId: session.userId,
    preparedChangeId,
  });

  switch (outcome.kind) {
    case "started":
    case "active":
      revalidatePath(`/app/projects/${projectId}`);
      return { ok: true, kind: outcome.kind, operation: outcome.operation };
    case "blocked":
      return {
        ok: false,
        error: outcome.reason,
        message: outcomeFailureMessage(outcome.reason),
      };
  }
}

/**
 * The current outcome state, for the panel's poll while a window is open.
 *
 * Read-only in the strongest sense available: it reads two rows and makes no
 * outbound request, so a page left open for the whole window costs a handful of
 * database reads and nothing else. Polling must never be a way to start,
 * extend, or re-run an observation (§43).
 */
export async function readProductionOutcomeAction(
  projectId: string,
  preparedChangeId: string,
): Promise<OutcomeCard> {
  await requireSession();
  const supabase = await createClient();

  return getOutcomeCard(supabase, { projectId, preparedChangeId });
}
