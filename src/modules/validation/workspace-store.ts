import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { liveConnections, updateLiveConnection } from "@/modules/projects/repository-connection";
import type { RepositoryIntelligenceSnapshot } from "@/modules/repository-intelligence/schema";
import { resolveValidationProfile, type ProfileResolution } from "./profile";
import { selectValidationTarget } from "./workspace";

/**
 * Reading and writing the founder's answer to "which application?" (Stufe 4).
 *
 * ## Why the write goes through the resolver
 *
 * `chooseWorkspaceRoot` re-derives the candidates and refuses anything that is
 * not one of them, rather than trusting the caller to have checked. That is not
 * belt-and-braces: the value it stores becomes a sandbox working directory, and
 * "the caller validated it" is a property of today's callers rather than of the
 * data. The database constrains the shape as well, and neither of those is what
 * makes this safe — `selectValidationTarget` matching against Vibe's own list
 * is.
 *
 * ## Why it re-reads rather than accepting the candidates
 *
 * A list passed in from a screen is a list the screen rendered, which may be
 * minutes old and was assembled from a snapshot that has since been replaced.
 * Deriving it here, immediately before the write, is the same discipline every
 * consequential write in this product follows: stored evidence routes, live
 * state decides (rule 55).
 */

export type ChooseWorkspaceRootResult =
  | { ok: true; workspaceRoot: string }
  | {
      ok: false;
      reason: "not_a_candidate" | "no_choice_to_make" | "no_repository" | "write_failed";
    };

/** The application this project's owner named, or null if they have not. */
export async function getChosenWorkspaceRoot(
  supabase: SupabaseClient,
  projectId: string,
): Promise<string | null> {
  const { data } = await liveConnections(supabase, "workspace_root")
    .eq("project_id", projectId)
    .maybeSingle();

  return (data as { workspace_root: string | null } | null)?.workspace_root ?? null;
}

/**
 * The resolution for a project, with the founder's answer applied.
 *
 * The one place those two are combined, so a caller cannot accidentally act on
 * the un-narrowed resolution — which for a multi-application repository would
 * mean refusing a project whose owner has already said which application to
 * work on.
 */
export async function resolveProjectValidationTarget(
  supabase: SupabaseClient,
  params: { projectId: string; snapshot: RepositoryIntelligenceSnapshot },
): Promise<ProfileResolution> {
  const resolution = resolveValidationProfile(params.snapshot);

  // Only a choice-shaped refusal can be narrowed, so nothing else pays for the
  // read. A project with one application never asks the database this question.
  if (resolution.supported || resolution.reason !== "workspace_choice_required") {
    return resolution;
  }

  return selectValidationTarget(
    resolution,
    await getChosenWorkspaceRoot(supabase, params.projectId),
  );
}

/** Records which application this project's owner works on. */
export async function chooseWorkspaceRoot(
  supabase: SupabaseClient,
  params: {
    projectId: string;
    workspaceRoot: string;
    snapshot: RepositoryIntelligenceSnapshot;
  },
): Promise<ChooseWorkspaceRootResult> {
  const resolution = resolveValidationProfile(params.snapshot);

  /*
   * Only a question that was actually asked can be answered.
   *
   * A repository Vibe resolves on its own never posed a choice, so there is no
   * answer to record — and recording one would not stay inert. A root stored
   * for a single-application repository would silently answer the question the
   * day a second application appears, and the screen would show a choice its
   * founder was never offered as one they made.
   */
  if (resolution.supported || resolution.reason !== "workspace_choice_required") {
    return { ok: false, reason: "no_choice_to_make" };
  }

  const selected = selectValidationTarget(resolution, params.workspaceRoot);

  // Refused because it is not one of Vibe's candidates — never because a
  // pattern rejected the string. An answer naming a real directory Vibe did not
  // offer is refused for the same reason as one naming `../secrets`.
  if (!selected.supported || selected.workspaceRoot !== params.workspaceRoot) {
    return { ok: false, reason: "not_a_candidate" };
  }

  /*
   * `authenticated` may update these two columns and no others.
   *
   * A plain UPDATE grant was withdrawn deliberately — the row's RLS policy lets
   * the owner set *any* column, so it would have made `detached_at` writable
   * over PostgREST and the detach gate advisory. A column-level grant says the
   * narrow thing without adding a `SECURITY DEFINER` function, which
   * `lifecycle-authority.migration.ts` asserts there are none of.
   */
  const { error, count } = await updateLiveConnection(supabase, params.projectId, {
    workspace_root: selected.workspaceRoot,
    workspace_root_chosen_at: new Date().toISOString(),
  });

  if (error) return { ok: false, reason: "write_failed" };
  // A cookie-scoped client sees no row it does not own, so zero rows updated
  // covers "no live connection" and "not this caller's" with one answer —
  // telling them apart would be an ownership oracle.
  if (count === 0) return { ok: false, reason: "no_repository" };

  return { ok: true, workspaceRoot: selected.workspaceRoot };
}
