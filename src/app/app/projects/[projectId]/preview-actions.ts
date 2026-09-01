"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/modules/auth/session";
import {
  getPreviewStatus,
  startChangePreview,
  stopChangePreview,
} from "@/modules/change-preview/service";
import type { PreviewFailureCode } from "@/modules/change-preview/schema";
import { createVercelSandboxProvider } from "@/modules/validation/vercel/provider";
import { VercelWorkflowExecutor } from "@/modules/operations/vercel/executor";
import { OPERATION_FAILURE_MESSAGES } from "@/modules/operations/messages";

/**
 * Preview server actions (Sprint 10B-3 §5, §6, §9, §12).
 *
 * A thin, safe boundary and nothing more. Every action here:
 *
 *  1. resolves the user from the server session — `userId` is never accepted
 *     from the client, so a caller cannot act as someone else;
 *  2. delegates every decision to the service, which owns ownership, expiry,
 *     eligibility, confirmation and provider lifecycle;
 *  3. returns a typed failure code, never a provider error, response body, or
 *     capability URL.
 *
 * ## What the client is allowed to say
 *
 * A project id, a validated artifact id, a preview session id, and an explicit
 * confirmation boolean. That is the entire input surface.
 *
 * It cannot name a snapshot, a sandbox, a provider, a port, a command, a
 * network policy, a repository, a commit, an environment variable, or a preview
 * URL. Not because those are validated and rejected — because there is no
 * parameter to put them in.
 *
 * ## The confirmation is not the modal
 *
 * The dialog in `preview-panel.tsx` is how a user expresses the decision. The
 * *authority* is the boolean the service requires, checked before an operation
 * row exists. A modal is a component; a second caller — a future API route, a
 * script, a different page — would not have one (§5).
 */

export type StartPreviewActionState =
  | { ok: true; kind: "starting"; previewSessionId: string; operationId: string }
  /** This exact preview is already live or already starting. No second sandbox. */
  | { ok: true; kind: "reused"; previewSessionId: string; status: string }
  | { ok: true; kind: "running"; operationId: string }
  | { ok: false; error: string; message: string }
  | null;

function failureMessage(code: string): string {
  return (
    OPERATION_FAILURE_MESSAGES[code as keyof typeof OPERATION_FAILURE_MESSAGES] ??
    "The preview could not be started."
  );
}

/**
 * Starts a temporary preview.
 *
 * `confirmPublicExposure` is a required argument rather than an optional flag
 * with a default. A default of `true` would make the confirmation decorative; a
 * default of `false` would make forgetting it a silent no-op. Required means a
 * caller has to make the decision in order to compile.
 */
export async function startPreviewAction(
  projectId: string,
  preparedChangeId: string,
  confirmPublicExposure: boolean,
): Promise<NonNullable<StartPreviewActionState>> {
  const session = await requireSession();
  const supabase = await createClient();

  const outcome = await startChangePreview(supabase, new VercelWorkflowExecutor(), {
    projectId,
    userId: session.userId,
    preparedChangeId,
    confirmPublicExposure,
  });

  switch (outcome.kind) {
    case "starting":
      revalidatePath(`/app/projects/${projectId}`);
      return {
        ok: true,
        kind: "starting",
        previewSessionId: outcome.previewSessionId,
        operationId: outcome.operation.operationId,
      };
    case "reused":
      revalidatePath(`/app/projects/${projectId}`);
      return {
        ok: true,
        kind: "reused",
        previewSessionId: outcome.previewSessionId,
        status: outcome.status,
      };
    case "running":
      return { ok: true, kind: "running", operationId: outcome.operation.operationId };
    case "failed":
      return { ok: false, error: outcome.error, message: failureMessage(outcome.error) };
  }
}

export type PreviewStatusActionState =
  | {
      ok: true;
      status: string;
      stage: string;
      failureCode: PreviewFailureCode | null;
      failureMessage: string | null;
      expiresAt: string;
      readyAt: string | null;
      /**
       * The current preview origin, or null.
       *
       * Present only for a session the caller owns, that is `running`, and that
       * has not passed its deadline — checked on the server, on this read.
       * Never persisted, never logged, never placed in an audit event, AI
       * evidence or analytics (§9, ADR 0016 §4).
       */
      origin: string | null;
      verdict: "preview_available" | null;
    }
  | { ok: false };

/**
 * Live status, including the preview origin when there is one to give.
 *
 * The origin is resolved from the provider on this call rather than read from a
 * row, which is what makes "the URL is not in the database" true rather than
 * intended. A stale client asking for an expired session gets no origin and a
 * converged status, because the service converges before answering (§13).
 */
export async function getPreviewStatusAction(
  projectId: string,
  previewSessionId: string,
): Promise<PreviewStatusActionState> {
  const session = await requireSession();
  const supabase = await createClient();

  const view = await getPreviewStatus(
    supabase,
    createVercelSandboxProvider(),
    // An expired session hands itself to the durable teardown, which is the one
    // place allowed to write the ledger. This read notices the deadline; it does
    // not do the work.
    new VercelWorkflowExecutor(),
    { projectId, userId: session.userId, previewSessionId },
  );

  if (!view) return { ok: false };

  return {
    ok: true,
    status: view.status,
    stage: view.stage,
    failureCode: view.failureCode,
    failureMessage: view.failureCode ? failureMessage(view.failureCode) : null,
    expiresAt: view.expiresAt,
    readyAt: view.readyAt,
    origin: view.origin,
    verdict: view.verdict,
  };
}

export type StopPreviewActionState =
  | { ok: true; kind: "stopping" | "already_stopped" }
  | { ok: false; message: string }
  | null;

/**
 * Stops a preview the caller owns.
 *
 * Returns as soon as the teardown is *claimed*, not when it is done. Ending a
 * preview stops a sandbox, deletes a snapshot and writes to a ledger only
 * durable execution may write, so the work belongs to a workflow (ADR 0016
 * §14).
 *
 * Idempotent by way of the service: the claim moves the session out of
 * `running` in one statement, so a second call — or an expiry racing a manual
 * stop — returns `already_stopped` rather than starting a second teardown. The
 * UI deliberately does not pretend to have stopped before the backend confirms
 * (§12).
 */
export async function stopPreviewAction(
  projectId: string,
  previewSessionId: string,
): Promise<NonNullable<StopPreviewActionState>> {
  const session = await requireSession();
  const supabase = await createClient();

  const outcome = await stopChangePreview(supabase, new VercelWorkflowExecutor(), {
    projectId,
    userId: session.userId,
    previewSessionId,
  });

  if (outcome.kind === "failed") {
    return { ok: false, message: "This preview could not be stopped." };
  }

  revalidatePath(`/app/projects/${projectId}`);
  return { ok: true, kind: outcome.kind };
}
