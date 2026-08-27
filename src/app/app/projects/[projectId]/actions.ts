"use server";

import { redirect } from "next/navigation";
import { requireSession } from "@/modules/auth/session";
import { createClient } from "@/lib/supabase/server";
import { recordAuditEvent } from "@/modules/audit-log/events";
import { detachRepository } from "@/modules/operations/project-lifecycle/detach";
import { deleteProjectLifecycle } from "@/modules/operations/project-lifecycle/service";

/**
 * Why a disconnect can fail is a closed set (VB-003).
 *
 * Every reason is something a founder can act on, and none of them names a
 * trigger, a table or an SQLSTATE — a code per database reason would leak the
 * schema through the copy and give them nothing to do differently.
 *
 * The live-work reasons are shared with deletion on purpose: both ask
 * `findBlockingWork` the same question, so both can answer with the same words.
 */
export type ProjectWorkBlocked =
  | "active_operation"
  | "agent_running"
  | "merge_in_progress"
  | "billing_not_finalized";

export type DisconnectProjectFailure =
  | "project_not_found"
  | ProjectWorkBlocked
  | "detach_failed";

/**
 * `null` is the pre-submission state, matching `useActionState`'s initial
 * value across the app. There is deliberately no `{ ok: true }` arm: success
 * redirects, and `redirect()` throws, so a successful call never returns.
 */
export type DisconnectProjectActionState =
  | { ok: false; error: DisconnectProjectFailure }
  | null;

/** Deleting adds the two failures only a destructive path can have. */
export type DeleteProjectFailure =
  | "project_not_found"
  | ProjectWorkBlocked
  | "storage_cleanup_failed"
  | "deletion_failed";

export type DeleteProjectActionState =
  | { ok: false; error: DeleteProjectFailure }
  | null;

/**
 * Every reason the button has copy for.
 *
 * The services and the screen have to agree on this set, and "they will,
 * because I updated both" is how the disagreement ships. A reason that reaches
 * here unrecognised becomes the generic failure rather than travelling on as
 * `undefined` — which the button would render as blank space where the
 * explanation belongs, the VB-003 defect in a quieter form.
 */
const DISCONNECT_FAILURES = new Set<string>([
  "project_not_found",
  "active_operation",
  "agent_running",
  "merge_in_progress",
  "billing_not_finalized",
  "detach_failed",
]);

const DELETE_FAILURES = new Set<string>([
  "project_not_found",
  "active_operation",
  "agent_running",
  "merge_in_progress",
  "billing_not_finalized",
  "storage_cleanup_failed",
  "deletion_failed",
]);

function asDisconnectFailure(reason: string): DisconnectProjectFailure {
  return DISCONNECT_FAILURES.has(reason) ? (reason as DisconnectProjectFailure) : "detach_failed";
}

function asDeleteFailure(reason: string): DeleteProjectFailure {
  return DELETE_FAILURES.has(reason) ? (reason as DeleteProjectFailure) : "deletion_failed";
}

/**
 * Sprint 1 §11: removes Vibe Business's local Project/RepositoryConnection
 * relationship after explicit confirmation (see disconnect-button.tsx).
 * Never touches GitHub — no App uninstall, no repository changes.
 *
 * ## Why this returns a state instead of always redirecting (VB-003)
 *
 * It used to call `redirect("/app")` unconditionally, outside the `result.ok`
 * check. A refused delete therefore looked identical to a successful one: the
 * project list reappeared, still containing the project, with no error and no
 * audit event. That is the worst available failure mode for a destructive
 * action — a person believes their data is gone when it is not — and it is
 * reachable today, because any project that ever resolved an ExecutionSpec
 * cannot currently be deleted at all.
 *
 * So the redirect now happens only on success, and every failure comes back as
 * a closed code the button renders as fixed copy.
 *
 * Called through `useActionState` after `.bind(null, projectId)`, so React
 * passes the previous state and the `FormData` as trailing arguments. Neither
 * is declared: this action reads no form field, and its only input — the
 * project id — is bound by the server component that renders the button.
 */
export async function disconnectProjectAction(
  projectId: string,
): Promise<DisconnectProjectActionState> {
  const session = await requireSession();
  const supabase = await createClient();

  const result = await detachRepository({ projectId, userId: session.userId });

  if (!result.ok) {
    if (result.reason === "project_not_found") {
      // Deliberately no audit event, for two reasons that point the same way.
      //
      // Mechanically it cannot be written: `recordAuditEvent` resolves
      // `projectId` out of `metadata` into the real `project_id` column, and
      // that column's foreign key — plus the table's own insert policy —
      // require the project to exist and to belong to the caller.
      //
      // And it should not be: `not_found` deliberately does not distinguish
      // "no such project" from "not yours", so anything written or reported
      // per-outcome here would be an ownership oracle. One code, one silence.
      return { ok: false, error: "project_not_found" };
    }

    // Live work refused it, or the write failed. The service has already
    // dropped the raw message, so there is nothing schema-shaped to leak; the
    // bounded fact and its closed reason are what get recorded.
    await recordAuditEvent(supabase, {
      userId: session.userId,
      eventType: "project.deletion_failed",
      metadata: { projectId, reason: result.reason },
    });

    return { ok: false, error: asDisconnectFailure(result.reason) };
  }

  await recordAuditEvent(supabase, {
    userId: session.userId,
    eventType: "project.disconnected",
    metadata: { projectId },
  });

  // Stays on the project. Disconnecting no longer removes it, so sending the
  // founder to the project list would be the copy and the behaviour disagreeing
  // in the other direction (ADR 0056 §1).
  redirect(`/app/projects/${projectId}/settings`);
}

/**
 * Deleting a project — the destructive half of the split ADR 0056 §1 makes.
 *
 * Separate from disconnecting on purpose. One severs a link and keeps
 * everything; this destroys the project, its intelligence, its audits, plans
 * and execution history. They were one control until M5, which is the defect
 * the split exists to fix, so they must not share a code path or a confirmation.
 *
 * Refusals are the orchestrator's closed set: live work, an unsettled Credit
 * hold, a storage sweep that failed. None of them names a table.
 */
export async function deleteProjectAction(
  projectId: string,
): Promise<DeleteProjectActionState> {
  const session = await requireSession();
  const supabase = await createClient();

  const result = await deleteProjectLifecycle({ projectId, userId: session.userId });

  if (!result.ok) {
    if (result.reason === "project_not_found") {
      // The same silence disconnecting keeps, and for the same reason: the
      // outcome does not distinguish "no such project" from "not yours", so
      // recording it per-outcome would be an ownership oracle.
      return { ok: false, error: "project_not_found" };
    }

    await recordAuditEvent(supabase, {
      userId: session.userId,
      eventType: "project.delete_refused",
      metadata: { projectId, reason: result.reason },
    });

    return { ok: false, error: asDeleteFailure(result.reason) };
  }

  // Recorded before the redirect, and deliberately without a `projectId` in
  // metadata: `recordAuditEvent` resolves that into the real `project_id`
  // column, whose foreign key the row no longer satisfies.
  await recordAuditEvent(supabase, {
    userId: session.userId,
    eventType: "project.deleted",
    metadata: {},
  });

  redirect("/app");
}
