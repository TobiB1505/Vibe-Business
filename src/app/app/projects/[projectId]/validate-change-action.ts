"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/modules/auth/session";
import { VercelWorkflowExecutor } from "@/modules/operations/vercel/executor";
import type { OperationView } from "@/modules/operations/view";
import type { ValidationFailureCode } from "@/modules/validation/schema";
import { startChangeValidation } from "@/modules/validation/service";

/**
 * Starting an isolated validation (Sprint 10A §27, §44).
 *
 * The client sends a project id and a prepared change id. Nothing else — no
 * repository, no commit, no sandbox provider, no runtime, no commands, no
 * network policy, no package manager, no working directory. Every one of those
 * is re-derived from server state inside the durable step.
 *
 * That is not defensive validation of extra parameters; the parameters do not
 * exist. A client that cannot name a command cannot smuggle one.
 *
 * No sandbox is provisioned in this request. The action enqueues durable work
 * and returns, because the whole point of Sprint 7's foundation is that a
 * multi-minute operation does not depend on a browser tab staying open.
 */

export type ValidateChangeActionState =
  | { ok: true; kind: "running"; operation: OperationView }
  /** This exact artifact already passed under this exact policy — no new sandbox. */
  | { ok: true; kind: "reused"; validationRunId: string }
  | { ok: false; error: ValidationFailureCode | "project_not_found" | "execution_start_failed" }
  | null;

/**
 * Takes two identifiers and nothing else — deliberately not the
 * `(prevState, formData)` shape.
 *
 * There is no form payload to read: a `FormData` parameter would be an input
 * surface that exists only to be ignored, and the next person to touch this
 * would reasonably start reading from it.
 */
export async function validateChangeAction(
  projectId: string,
  preparedChangeId: string,
): Promise<NonNullable<ValidateChangeActionState>> {
  const session = await requireSession();
  const supabase = await createClient();

  const outcome = await startChangeValidation(supabase, new VercelWorkflowExecutor(), {
    projectId,
    userId: session.userId,
    preparedChangeId,
  });

  switch (outcome.kind) {
    case "started":
    case "running":
      revalidatePath(`/app/projects/${projectId}`);
      return { ok: true, kind: "running", operation: outcome.operation };
    case "reused":
      revalidatePath(`/app/projects/${projectId}`);
      return { ok: true, kind: "reused", validationRunId: outcome.validationRunId };
    case "failed":
      return { ok: false, error: outcome.error };
  }
}
