"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/modules/auth/session";
import { createClient } from "@/lib/supabase/server";
import { runProjectBusinessAudit, type RunAuditFailureCode } from "@/modules/business-audit/service";

export type RunAuditActionState =
  | { ok: true; reused: boolean }
  | { ok: false; error: RunAuditFailureCode }
  | null;

/**
 * Runs the Business Readiness Audit for a project the caller owns.
 *
 * The only input accepted is a project id — evidence, model and prompt all
 * come from the server, so this action cannot be used to run inference on
 * arbitrary content or to select an expensive model on our bill.
 *
 * Synchronous, one paid provider call, guarded against double submission by
 * a database constraint (Sprint 4 §16, §24).
 */
export async function runAuditAction(
  projectId: string,
  _prevState: RunAuditActionState,
  formData: FormData,
): Promise<RunAuditActionState> {
  const session = await requireSession();
  const supabase = await createClient();

  // A refresh is a deliberate act that costs money, so it is only ever
  // triggered by an explicit form value — never defaulted on.
  const force = formData.get("force") === "true";

  const result = await runProjectBusinessAudit(supabase, { projectId, userId: session.userId }, { force });

  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath(`/app/projects/${projectId}`);
  return { ok: true, reused: result.reused };
}
