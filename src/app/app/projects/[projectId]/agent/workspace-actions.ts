"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/modules/auth/session";
import { getLatestSuccessfulSnapshot } from "@/modules/repository-intelligence/store";
import { chooseWorkspaceRoot } from "@/modules/validation/workspace-store";

/**
 * Naming which application in a repository Vibe works on (Stufe 4).
 *
 * ## What this action does not do
 *
 * It does not validate a path, and that is deliberate rather than an omission.
 * `chooseWorkspaceRoot` re-derives the candidate list from the current snapshot
 * and refuses anything that is not one of them — so an answer naming
 * `../secrets` is refused for exactly the same reason as one naming a real
 * directory Vibe did not offer: **it is not on the list**. A check here would
 * be a second, weaker gate that could drift from the first, and the shape of
 * the string was never what made this safe.
 *
 * It also does not start anything. Choosing an application is free and
 * reversible; running the agent is priced, and belongs where the price is
 * disclosed and confirmed. The screen says so rather than leaving a founder to
 * discover that their click did something they did not ask for.
 *
 * ## Ownership
 *
 * The session is required, the client is cookie-scoped, and the write lands
 * through a column-level grant that lets an owner set these two columns and no
 * others. A caller who does not own the project matches no row, which the store
 * reports as "no repository" rather than as anything about whose it is.
 */

export type WorkspaceChoiceState =
  | { status: "idle" }
  | { status: "chosen"; workspaceRoot: string }
  | { status: "error"; message: string };

const MESSAGES: Record<
  "not_a_candidate" | "no_choice_to_make" | "no_repository" | "write_failed",
  string
> = {
  // Says what changed rather than blaming the click: between rendering the list
  // and answering it, a re-analysis can genuinely have moved the applications.
  not_a_candidate:
    "That app isn't one Vibe found in this repository any more. Refresh the page to see the current list.",
  // Reached when a re-analysis left one application standing between rendering
  // the list and answering it. Nothing to choose is not a failure to explain
  // away — Vibe already knows which application it works on.
  no_choice_to_make:
    "Vibe now finds only one app in this repository, so there's nothing to choose.",
  no_repository: "No repository is connected to this project.",
  write_failed: "Vibe couldn't record that. Try again in a moment.",
};

export async function chooseWorkspaceRootAction(
  projectId: string,
  workspaceRoot: string,
  _previous: WorkspaceChoiceState,
): Promise<WorkspaceChoiceState> {
  await requireSession();
  const supabase = await createClient();

  const snapshot = await getLatestSuccessfulSnapshot(supabase, projectId);
  if (!snapshot?.result) {
    return { status: "error", message: MESSAGES.no_repository };
  }

  const outcome = await chooseWorkspaceRoot(supabase, {
    projectId,
    workspaceRoot,
    snapshot: snapshot.result,
  });

  if (!outcome.ok) return { status: "error", message: MESSAGES[outcome.reason] };

  revalidatePath(`/app/projects/${projectId}/agent`);
  revalidatePath(`/app/projects/${projectId}/plan`);

  return { status: "chosen", workspaceRoot: outcome.workspaceRoot };
}
