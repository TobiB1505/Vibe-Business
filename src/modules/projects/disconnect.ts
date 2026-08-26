import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export type DisconnectProjectResult =
  | { ok: true }
  | { ok: false; error: "not_found" }
  | { ok: false; error: "unknown" };

/**
 * Removes Vibe Business's local Project and everything derived from it —
 * Sprint 1 §11. Never touches GitHub: does not uninstall the App, does not
 * delete or modify the repository.
 *
 * ## Why this is an RPC rather than a delete (VB-001 M1a)
 *
 * The behaviour here is unchanged, deliberately. What changed is the
 * privilege behind it.
 *
 * `DELETE ON public.projects` is the entry authority for the cascade that
 * reaches `execution_specs`, because a referential-integrity cascade runs with
 * the referencing table's owner authority rather than the caller's. While
 * `authenticated` holds it, M1's lifecycle marker — a forgeable custom GUC —
 * is enough for a user to destroy their own project's execution history
 * outside the lifecycle routine ([2026-08-26] correction, ADR 0056 §5). This
 * was one of the two call sites keeping that privilege alive.
 *
 * `disconnect_project` is `SECURITY DEFINER`, so it takes no owner argument:
 * a `SECURITY DEFINER` function granted to `authenticated` is reachable
 * directly over `/rest/v1/rpc/` with arguments the browser chooses, and an
 * owner *passed in* would be a claim rather than a check. It reads
 * `auth.uid()` instead — which is why this wrapper no longer forwards a
 * `userId`, and why the function's reach is exactly the `delete own projects`
 * RLS policy it replaces.
 *
 * It also **clears** the lifecycle marker before deleting, rather than merely
 * not setting one. `set_config(…, true)` is transaction-local and the function
 * runs inside the caller's transaction, so a marker forged before the call
 * would otherwise still be visible to the cascade it triggers. Cleared, the
 * cascade reaches the immutability trigger with no marker and is refused — so
 * a project that has ever resolved an execution spec remains undeletable
 * through this path, exactly as it is today, and exactly as VB-001 exists to
 * fix properly.
 *
 * ## This is temporary
 *
 * ADR 0056 §1 decided that Disconnect Repository detaches GitHub and *keeps*
 * the project; migration family M5 implements that and deletes this function.
 * Nothing here is the final Disconnect design — it is today's semantics, moved
 * off a privilege that had to go first.
 *
 * ## Why the database error is dropped rather than returned (VB-003)
 *
 * `unknown` used to carry `error.message`. A PostgREST message names the
 * table, constraint or trigger that refused — here, most often the
 * `execution_specs` immutability trigger — and the only caller is a Server
 * Action, one careless `state.message` away from rendering the schema to a
 * founder. Narrowing the union removes that possibility at the type level
 * rather than relying on every future caller to remember. The RPC now
 * classifies that refusal in SQL and returns a value instead of raising, so
 * the message no longer even reaches this module.
 *
 * It is dropped, not logged: `setProductionUrl` is the sibling precedent and
 * returns a bare `save_failed` the same way. What a failed disconnect needs to
 * be observable is a *bounded* fact — that it failed, for which project — and
 * that is recorded as an audit event by the action, not as console prose here.
 */
export async function disconnectProject(
  supabase: SupabaseClient,
  params: { projectId: string },
): Promise<DisconnectProjectResult> {
  const { data, error } = await supabase.rpc("disconnect_project", {
    p_project_id: params.projectId,
  });

  if (error) {
    return { ok: false, error: "unknown" };
  }
  if (data === "not_found") {
    return { ok: false, error: "not_found" };
  }
  if (data !== "disconnected") {
    // `blocked_by_execution_history`, and anything a future revision of the
    // function adds. Both map to the same closed failure the action already
    // renders — this slice moves the privilege, not the copy.
    return { ok: false, error: "unknown" };
  }
  return { ok: true };
}
