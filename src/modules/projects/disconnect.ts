import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export type DisconnectProjectResult =
  | { ok: true }
  | { ok: false; error: "not_found" }
  | { ok: false; error: "unknown" };

/**
 * Removes Vibe Business's local Project (and, via cascade, its
 * RepositoryConnection) — Sprint 1 §11. Never touches GitHub: does not
 * uninstall the App, does not delete or modify the repository.
 *
 * `.eq("user_id", userId)` is defense in depth alongside RLS — the delete
 * would be blocked by RLS alone even without this, but making the
 * ownership check explicit here keeps the function's contract obvious
 * from the code itself.
 *
 * ## Why the database error is dropped rather than returned (VB-003)
 *
 * `unknown` used to carry `error.message`. A PostgREST message names the
 * table, constraint or trigger that refused — here, most often the
 * `execution_specs` immutability trigger — and the only caller was a Server
 * Action, one careless `state.message` away from rendering the schema to a
 * founder. Narrowing the union removes that possibility at the type level
 * rather than relying on every future caller to remember.
 *
 * It is dropped, not logged: `setProductionUrl` is the sibling precedent and
 * returns a bare `save_failed` the same way. What a failed disconnect needs
 * to be observable is a *bounded* fact — that it failed, for which project —
 * and that is recorded as an audit event by the action, not as console prose
 * here.
 */
export async function disconnectProject(
  supabase: SupabaseClient,
  params: { projectId: string; userId: string },
): Promise<DisconnectProjectResult> {
  const { data, error } = await supabase
    .from("projects")
    .delete()
    .eq("id", params.projectId)
    .eq("user_id", params.userId)
    .select("id");

  if (error) {
    return { ok: false, error: "unknown" };
  }
  if (!data || data.length === 0) {
    return { ok: false, error: "not_found" };
  }
  return { ok: true };
}
