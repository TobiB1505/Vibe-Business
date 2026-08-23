"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/modules/auth/session";
import { createClient } from "@/lib/supabase/server";
import { submitFounderAnswer, type AnswerFailure } from "@/modules/business-audit/answer-service";
import { resumeAnsweredAuditOperation } from "@/modules/operations/service";
import { VercelWorkflowExecutor } from "@/modules/operations/vercel/executor";

/**
 * Answering the one question the audit stopped for (CORE-2a.4 §24).
 *
 * The action does three things in a fixed order, and the order is the point:
 * persist the answer, un-pause the audit, put the operation back in the queue.
 * A crash between any two of them leaves a state the founder can recover from
 * by answering again — the one sequence that would lose an answer is
 * un-pausing first, which is why it does not happen here.
 *
 * Nothing about the question comes from the client except *which* question is
 * being answered, and that is checked against the stored one. The prompt, the
 * permitted values and the destination store are all server-side; a crafted
 * submission cannot write an arbitrary value into a canonical field.
 */

export type AnswerActionState =
  | { ok: true; resumed: boolean }
  | { ok: false; error: AnswerFailure }
  | null;

export async function submitFounderAnswerAction(
  projectId: string,
  _prevState: AnswerActionState,
  formData: FormData,
): Promise<AnswerActionState> {
  const session = await requireSession();
  const supabase = await createClient();

  const intent = String(formData.get("intent") ?? "");
  const unsure = formData.get("unsure") === "true";
  const rawValue = formData.get("value");
  const value = typeof rawValue === "string" ? rawValue : null;

  const answered = await submitFounderAnswer(supabase, {
    projectId,
    userId: session.userId,
    intent,
    unsure,
    value,
  });

  if (!answered.ok) return { ok: false, error: answered.error };

  /*
   * Only the submission that actually un-paused the audit starts the work.
   *
   * `resumed: false` means someone already answered this — a double click, or
   * the same answer arriving from a second tab. Re-queuing then would start a
   * second workflow for a run that is already moving, and both would race into
   * the paid call this whole design exists to protect (§38, §53).
   */
  if (answered.resumed) {
    await resumeAnsweredAuditOperation(supabase, new VercelWorkflowExecutor(), {
      projectId,
      userId: session.userId,
      auditId: answered.auditId,
    });
  }

  revalidatePath(`/app/projects/${projectId}/health`);
  revalidatePath(`/app/onboarding/${projectId}`);
  return { ok: true, resumed: answered.resumed };
}
