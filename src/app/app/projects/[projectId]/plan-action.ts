"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/modules/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { OperationFailureCode } from "@/modules/operations/failures";
import { startActionPlanOperation } from "@/modules/operations/service";
import type { OperationView } from "@/modules/operations/view";
import { VercelWorkflowExecutor } from "@/modules/operations/vercel/executor";

/**
 * Starting a durable Action Plan run (ACTION PLANNER UI-1).
 *
 * Mirrors `opportunities-action.ts` exactly: validate and enqueue, never wait
 * for the provider inline. The only input is a project id the caller must
 * already own — the Move, the audit, the conclusion, the model and the
 * prompt are all resolved server-side (`resolveActionPlanIdentity`), so this
 * cannot be used to plan an arbitrary Move or to spend on someone else's
 * project.
 */

export type StartPlanActionState =
  /** Nothing ran: an identical plan already existed. */
  | { ok: true; kind: "reused" }
  | { ok: true; kind: "running"; operation: OperationView }
  | { ok: false; error: OperationFailureCode }
  | null;

export async function startPlanAction(
  projectId: string,
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
  });

  if (outcome.kind === "failed") return { ok: false, error: outcome.error };

  if (outcome.kind === "reused") {
    revalidatePath(`/app/projects/${projectId}/moves`);
    return { ok: true, kind: "reused" };
  }

  return { ok: true, kind: "running", operation: outcome.operation };
}
