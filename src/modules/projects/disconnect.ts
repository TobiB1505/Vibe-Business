import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export type DisconnectProjectResult =
  | { ok: true }
  | { ok: false; error: "not_found" }
  | { ok: false; error: "unknown"; message: string };

/**
 * Removes Vibe Business's local Project (and, via cascade, its
 * RepositoryConnection) — Sprint 1 §11. Never touches GitHub: does not
 * uninstall the App, does not delete or modify the repository.
 *
 * `.eq("user_id", userId)` is defense in depth alongside RLS — the delete
 * would be blocked by RLS alone even without this, but making the
 * ownership check explicit here keeps the function's contract obvious
 * from the code itself.
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
    return { ok: false, error: "unknown", message: error.message };
  }
  if (!data || data.length === 0) {
    return { ok: false, error: "not_found" };
  }
  return { ok: true };
}
