"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/modules/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { OperationFailureCode } from "@/modules/operations/failures";
import { startOpportunityOperation } from "@/modules/operations/service";
import type { OperationView } from "@/modules/operations/view";
import { VercelWorkflowExecutor } from "@/modules/operations/vercel/executor";

/**
 * Starting a durable opportunity generation (Sprint 8 §24, §30).
 *
 * Like the audit action, this validates and enqueues rather than waiting. The
 * only input is a project id the caller must already own; the audit, evidence,
 * model and prompt all come from the server, so this cannot be used to
 * prioritize arbitrary content or spend on someone else's project.
 */

export type StartOpportunitiesActionState =
  /** Nothing ran: an identical set already existed. */
  | { ok: true; kind: "reused" }
  | { ok: true; kind: "running"; operation: OperationView }
  | { ok: false; error: OperationFailureCode }
  | null;

export async function startOpportunitiesAction(
  projectId: string,
  _prevState: StartOpportunitiesActionState,
  formData: FormData,
): Promise<StartOpportunitiesActionState> {
  const session = await requireSession();
  const supabase = await createClient();

  // A refresh costs money, so it is only ever requested explicitly.
  const force = formData.get("force") === "true";

  const outcome = await startOpportunityOperation(supabase, new VercelWorkflowExecutor(), {
    projectId,
    userId: session.userId,
    force,
    // A deliberate regeneration from the workspace, so it costs Credits
    // (BILLING CORE-2 §40). The bundled run inside onboarding does not.
    requestedBy: "customer_requested",
  });

  if (outcome.kind === "failed") return { ok: false, error: outcome.error };

  if (outcome.kind === "reused") {
    revalidatePath(`/app/projects/${projectId}`);
    return { ok: true, kind: "reused" };
  }

  return { ok: true, kind: "running", operation: outcome.operation };
}
