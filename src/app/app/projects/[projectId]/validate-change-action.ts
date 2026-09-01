"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/modules/auth/session";
import { VercelWorkflowExecutor } from "@/modules/operations/vercel/executor";
import { OPERATION_FAILURE_MESSAGES } from "@/modules/operations/messages";
import type { OperationView } from "@/modules/operations/view";
import { SANDBOX_POLICY_VERSION, type ValidationFailureCode } from "@/modules/validation/schema";
import {
  getLatestValidation,
  getValidationStatus,
  startChangeValidation,
} from "@/modules/validation/service";
import { buildValidationSummary, type ValidationSummary } from "@/modules/validation/view";

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
  /** This exact artifact passed and its captured filesystem is still usable. */
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
/**
 * Live phase progress for a validation the user is watching.
 *
 * Reads persisted state and nothing else: the ValidationRun row that each
 * durable step writes as it finishes. The workflow's own step index is not
 * consulted and must not be — it is a third-party execution detail, and it
 * would report progress for work whose result was never recorded (§4).
 *
 * Scoped to the session's own project, like every other read here. The prepared
 * change id decides which artifact's validation is returned, and both are
 * checked against the user before anything is read.
 */
export async function getValidationProgressAction(
  projectId: string,
  preparedChangeId: string,
  operationId: string,
): Promise<
  | { ok: true; operation: OperationView; summary: ValidationSummary | null }
  | { ok: false }
> {
  const session = await requireSession();
  const supabase = await createClient();

  const operation = await getValidationStatus(supabase, {
    projectId,
    userId: session.userId,
    operationId,
  });
  if (!operation) return { ok: false };

  const validation = await getLatestValidation(supabase, { projectId, preparedChangeId });

  return {
    ok: true,
    operation,
    summary: validation
      ? buildValidationSummary(validation, {
          currentPolicyVersion: SANDBOX_POLICY_VERSION,
          failureMessage: validation.failureCode
            ? (OPERATION_FAILURE_MESSAGES[validation.failureCode] ?? null)
            : null,
        })
      : null,
  };
}

export async function validateChangeAction(
  projectId: string,
  preparedChangeId: string,
): Promise<NonNullable<ValidateChangeActionState>> {
  return startValidationAction(projectId, preparedChangeId, true);
}

/**
 * An explicit founder retry is a new observation, not a lookup of the pass
 * already on screen. It still accepts only the same two identifiers and runs
 * through the same ownership, identity, operation and sandbox boundaries.
 */
export async function rerunChangeValidationAction(
  projectId: string,
  preparedChangeId: string,
): Promise<NonNullable<ValidateChangeActionState>> {
  return startValidationAction(projectId, preparedChangeId, false);
}

async function startValidationAction(
  projectId: string,
  preparedChangeId: string,
  reusePassed: boolean,
): Promise<NonNullable<ValidateChangeActionState>> {
  const session = await requireSession();
  const supabase = await createClient();

  const outcome = await startChangeValidation(supabase, new VercelWorkflowExecutor(), {
    projectId,
    userId: session.userId,
    preparedChangeId,
    reusePassed,
  });

  switch (outcome.kind) {
    case "started":
    case "running":
      revalidatePath(`/app/projects/${projectId}`);
      revalidatePath(`/app/projects/${projectId}/agent`);
      return { ok: true, kind: "running", operation: outcome.operation };
    case "reused":
      revalidatePath(`/app/projects/${projectId}`);
      revalidatePath(`/app/projects/${projectId}/agent`);
      return { ok: true, kind: "reused", validationRunId: outcome.validationRunId };
    case "failed":
      return { ok: false, error: outcome.error };
  }
}
