"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isFounderAttestable } from "@/modules/action-plans/completion";
import { getLatestActionPlan } from "@/modules/action-plans/service";
import { requireSession } from "@/modules/auth/session";
import { attestFounderAction } from "@/modules/operations/founder-action/server-writes";

export type FounderActionAttestationState =
  | { ok: true }
  | { ok: false; message: string }
  | null;

const ERROR_COPY = {
  project_not_found: "This project is no longer available.",
  step_not_attestable: "This action is no longer the current step. Reload the plan and try again.",
  attestation_failed: "Your confirmation could not be saved. Please try again.",
} as const;

export async function attestFounderActionStepAction(
  projectId: string,
  actionPlanId: string,
  stepKey: string,
  _previous: FounderActionAttestationState,
  _formData: FormData,
): Promise<FounderActionAttestationState> {
  void _previous;
  void _formData;
  const session = await requireSession();
  const supabase = await createClient();
  const current = await getLatestActionPlan(supabase, projectId);

  if (
    !current ||
    current.plan.id !== actionPlanId ||
    current.staleness.length > 0 ||
    current.firstActionableStep?.id !== stepKey ||
    /* One predicate, shared with the completion projection and the database
       function behind this call, so the three cannot drift into disagreeing
       about which steps a founder is allowed to close (ADR 0088). */
    !isFounderAttestable(current.firstActionableStep)
  ) {
    return { ok: false, message: ERROR_COPY.step_not_attestable };
  }

  const result = await attestFounderAction({
    projectId,
    userId: session.userId,
    actionPlanId,
    stepKey,
  });
  if (!result.ok) return { ok: false, message: ERROR_COPY[result.error] };

  revalidatePath(`/app/projects/${projectId}/plan`);
  return { ok: true };
}
