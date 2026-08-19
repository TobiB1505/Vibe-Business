"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/modules/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { OperationFailureCode } from "@/modules/operations/failures";
import { isTerminal } from "@/modules/operations/schema";
import {
  getOperationStatus,
  startBusinessAuditOperation,
} from "@/modules/operations/service";
import type { OperationView } from "@/modules/operations/view";
import { VercelWorkflowExecutor } from "@/modules/operations/vercel/executor";

/**
 * Starting and observing a durable Business Audit (Sprint 7 §16, §17).
 *
 * The start action no longer waits for the audit. It validates, decides
 * whether anything needs to run at all, enqueues durable work, and returns —
 * so the browser request is over in well under a second rather than owning a
 * ~50 second provider call.
 *
 * The only input either action accepts is an id the caller must already own.
 * Evidence, model and prompt all come from the server, so neither can be used
 * to run inference on arbitrary content or to spend on someone else's project.
 */

export type StartAuditActionState =
  /** Nothing ran: an identical audit already existed. */
  | { ok: true; kind: "reused" }
  /** Durable work is now running — either just started, or already was. */
  | { ok: true; kind: "running"; operation: OperationView }
  | { ok: false; error: OperationFailureCode }
  | null;

export async function startAuditAction(
  projectId: string,
  _prevState: StartAuditActionState,
  formData: FormData,
): Promise<StartAuditActionState> {
  const session = await requireSession();
  const supabase = await createClient();

  // A re-run costs money, so it is only ever requested by an explicit form
  // value — never defaulted on.
  const force = formData.get("force") === "true";

  const outcome = await startBusinessAuditOperation(supabase, new VercelWorkflowExecutor(), {
    projectId,
    userId: session.userId,
    force,
  });

  if (outcome.kind === "failed") return { ok: false, error: outcome.error };

  if (outcome.kind === "reused") {
    revalidatePath(`/app/projects/${projectId}`);
    return { ok: true, kind: "reused" };
  }

  return { ok: true, kind: "running", operation: outcome.operation };
}

export type OperationStatusActionState =
  | { ok: true; operation: OperationView }
  | { ok: false; error: "not_found" };

/**
 * One poll (§20).
 *
 * Reads Supabase, never the execution provider: the application's own state is
 * canonical, which is what lets a reload answer "is something running?" and
 * what keeps a future change of provider from being visible here (§15).
 */
export async function getOperationStatusAction(
  projectId: string,
  operationId: string,
): Promise<OperationStatusActionState> {
  const session = await requireSession();
  const supabase = await createClient();

  // Ownership is the query. RLS scopes the project to this user, and the
  // project scopes the operation — a guessed id resolves to nothing.
  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("user_id", session.userId)
    .maybeSingle();

  if (!project) return { ok: false, error: "not_found" };

  const operation = await getOperationStatus(supabase, { projectId, operationId });
  if (!operation) return { ok: false, error: "not_found" };

  /*
   * A run that has stopped means the page's server render is stale — whatever
   * it stopped for.
   *
   * This used to fire only on `completed`, so a failed or cancelled run left
   * the screen showing a live operation that had already ended, and the panel
   * had to discover it for itself.
   */
  if (isTerminal(operation.status)) revalidatePath(`/app/projects/${projectId}`);

  return { ok: true, operation };
}
