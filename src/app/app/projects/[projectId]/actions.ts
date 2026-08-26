"use server";

import { redirect } from "next/navigation";
import { requireSession } from "@/modules/auth/session";
import { createClient } from "@/lib/supabase/server";
import { recordAuditEvent } from "@/modules/audit-log/events";
import { disconnectProject } from "@/modules/projects/disconnect";

/**
 * Why a disconnect can fail is a closed set (VB-003).
 *
 * Two outcomes, because two are all a person can act on:
 *
 *  * `project_not_found` — nothing was deleted and nothing is going to be.
 *    The project is gone already, or it is not this account's.
 *  * `deletion_failed` — the project is there, it is theirs, and the database
 *    refused. Today that is usually the `execution_specs` immutability trigger
 *    firing on the cascade (VB-001), but the *user-facing* vocabulary must not
 *    name a trigger, a table or an SQLSTATE. Adding a code per database reason
 *    would leak the schema through the copy and would give a founder nothing
 *    they could do differently.
 */
export type DisconnectProjectFailure = "project_not_found" | "deletion_failed";

/**
 * `null` is the pre-submission state, matching `useActionState`'s initial
 * value across the app. There is deliberately no `{ ok: true }` arm: success
 * redirects, and `redirect()` throws, so a successful call never returns.
 */
export type DisconnectProjectActionState =
  | { ok: false; error: DisconnectProjectFailure }
  | null;

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

  const result = await disconnectProject(supabase, { projectId, userId: session.userId });

  if (!result.ok) {
    if (result.error === "not_found") {
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

    // The database refused a delete on a project this account owns. The store
    // has already dropped the raw message, so there is nothing schema-shaped
    // to leak here; the bounded fact that it failed is what gets recorded.
    await recordAuditEvent(supabase, {
      userId: session.userId,
      eventType: "project.deletion_failed",
      metadata: { projectId, reason: "deletion_failed" },
    });

    return { ok: false, error: "deletion_failed" };
  }

  await recordAuditEvent(supabase, {
    userId: session.userId,
    eventType: "project.disconnected",
    metadata: { projectId },
  });

  redirect("/app");
}
