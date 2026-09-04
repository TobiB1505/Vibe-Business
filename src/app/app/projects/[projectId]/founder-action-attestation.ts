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
  // Reachable only if the form is submitted without the field the screen makes
  // required, so it names the field rather than apologising.
  finding_required: "Write what you found before confirming this step.",
  finding_not_accepted: "This step is confirmed on its own, without a written finding.",
  attestation_failed: "Your confirmation could not be saved. Please try again.",
} as const;

export async function attestFounderActionStepAction(
  projectId: string,
  actionPlanId: string,
  stepKey: string,
  _previous: FounderActionAttestationState,
  formData: FormData,
): Promise<FounderActionAttestationState> {
  void _previous;
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
       about which steps a founder is allowed to close (ADR 0090). */
    !isFounderAttestable(current.firstActionableStep)
  ) {
    return { ok: false, message: ERROR_COPY.step_not_attestable };
  }

  /*
   * Read from the form, trimmed, and empty means absent.
   *
   * Which step kinds must carry one is not decided here — the database owns
   * that, and it re-derives the step's actor to enforce it (ADR 0093). This
   * only turns "the field was left blank" into "there is no finding", so the
   * two shapes reaching the database are the two it distinguishes.
   */
  const submitted = formData.get("finding");
  const finding = typeof submitted === "string" && submitted.trim().length > 0
    ? submitted.trim()
    : null;

  const result = await attestFounderAction({
    projectId,
    userId: session.userId,
    actionPlanId,
    stepKey,
    finding,
  });
  if (!result.ok) return { ok: false, message: ERROR_COPY[result.error] };

  revalidatePath(`/app/projects/${projectId}/plan`);
  return { ok: true };
}
