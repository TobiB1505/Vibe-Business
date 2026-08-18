"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/modules/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { OperationFailureCode } from "@/modules/operations/failures";
import { startActionPlanOperation } from "@/modules/operations/service";
import type { OperationView } from "@/modules/operations/view";
import { VercelWorkflowExecutor } from "@/modules/operations/vercel/executor";

/**
 * Starting a durable Action Plan run (ACTION PLANNER UI-1; §83 extension).
 *
 * Mirrors `opportunities-action.ts` exactly: validate and enqueue, never wait
 * for the provider inline. The input is a project id the caller must already
 * own, plus which Move to plan — the audit, the conclusion, the model and the
 * prompt are all resolved server-side (`resolveActionPlanIdentity`), so this
 * cannot be used to spend on someone else's project, and `opportunityId` is
 * only ever whatever `ActionPlanPanel` was itself rendered with (bound here,
 * not read from form data) — the same trust boundary `projectId` already has,
 * not a new one. A Move the caller names that no longer exists in the current
 * set refuses (`move_not_found`) rather than silently planning rank 1
 * instead.
 */

export type StartPlanActionState =
  /** Nothing ran: an identical plan already existed. */
  | { ok: true; kind: "reused" }
  | { ok: true; kind: "running"; operation: OperationView }
  | { ok: false; error: OperationFailureCode }
  | null;

export async function startPlanAction(
  projectId: string,
  opportunityId: string | null,
  _prevState: StartPlanActionState,
  formData: FormData,
): Promise<StartPlanActionState> {
  const session = await requireSession();
  const supabase = await createClient();

  // Replanning costs money, so it is only ever requested by an explicit form
  // value — never defaulted on (Rule 60).
  const force = formData.get("force") === "true";

  const outcome = await startActionPlanOperation(supabase, new VercelWorkflowExecutor(), {
    projectId,
    userId: session.userId,
    force,
    requestedOpportunityId: opportunityId,
  });

  if (outcome.kind === "failed") return { ok: false, error: outcome.error };

  if (outcome.kind === "reused") {
    revalidatePath(`/app/projects/${projectId}/moves`);
    return { ok: true, kind: "reused" };
  }

  return { ok: true, kind: "running", operation: outcome.operation };
}
