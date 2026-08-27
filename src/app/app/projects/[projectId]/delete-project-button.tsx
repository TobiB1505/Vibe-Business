"use client";

import { useActionState, useState } from "react";
import { TextAction } from "@/components/ui/button";
import { ConfirmPanel, useReturnFocus } from "@/components/ui/confirm-panel";
import {
  deleteProjectAction,
  type DeleteProjectActionState,
  type DeleteProjectFailure,
} from "./actions";

/**
 * Deleting a project (ADR 0056 §1).
 *
 * ## Why this control exists separately
 *
 * Until M5 there was one control, labelled Disconnect, which destroyed the
 * project. Its copy described detaching and its behaviour was destruction —
 * the disagreement the launch audit found and ADR 0056 split. Disconnect now
 * detaches; this is the destructive one, and it says so before it runs.
 *
 * ## Why the confirmation enumerates
 *
 * The old dialog named the two things that would *not* happen and stayed silent
 * on the roughly forty tables that would. A person cannot consent to a
 * consequence nobody stated, so this one names what goes: not a table list, but
 * the work the founder recognises as theirs.
 *
 * ## Why a refusal is not an error
 *
 * Most failures here are the project still being busy. That is not something
 * gone wrong — it is the deletion waiting for work that can still write, so it
 * cannot leave a half-deleted project behind. The copy says what is running and
 * that trying later will work.
 */
const FAILURE_MESSAGES: Record<DeleteProjectFailure, string> = {
  project_not_found: "This project could not be found. It may already have been deleted.",
  active_operation: "Vibe is still working on this project. Delete once it has finished.",
  agent_running: "An agent is still working in this project. Delete once the run has finished.",
  merge_in_progress: "A change is being merged right now. Delete once it has finished.",
  billing_not_finalized:
    "A Credit hold for this project has not settled yet. Delete again in a moment.",
  storage_cleanup_failed:
    "The stored screenshots could not be removed, so nothing was deleted. Try again in a moment.",
  deletion_failed: "This project could not be deleted, and is still here. Try again in a moment.",
};

const initialState: DeleteProjectActionState = null;

export function DeleteProjectButton({ projectId }: { projectId: string }) {
  const [confirming, setConfirming] = useState(false);
  const openerRef = useReturnFocus<HTMLButtonElement>(confirming);
  const action = deleteProjectAction.bind(null, projectId);
  const [state, formAction, pending] = useActionState(action, initialState);
  const failure = state && !state.ok ? state.error : null;

  if (confirming) {
    return (
      <form action={formAction} className="w-full">
        <ConfirmPanel
          title="Delete this project?"
          // `caution` is the strongest tone the confirmation surface has.
          // The distinction from disconnecting is carried by the copy — "this
          // cannot be undone" — rather than by inventing a third tone here.
          tone="caution"
          confirmLabel="Delete project"
          confirmType="submit"
          // Disables both buttons and shows the busy state, so a second click
          // cannot submit a second delete while the first is in flight.
          pending={pending}
          onCancel={() => setConfirming(false)}
        >
          <>
            <p>
              This permanently removes the project and everything Vibe has learned about it — its
              audits, opportunities, plans, prepared changes, reviews and merge history.
            </p>
            <p>This cannot be undone.</p>
            <p>This does not uninstall the GitHub App and does not change your repository.</p>
          </>
        </ConfirmPanel>
        {failure && (
          <p role="alert" className="mt-3 text-sm text-amber">
            {FAILURE_MESSAGES[failure]}
          </p>
        )}
      </form>
    );
  }

  return (
    // Not `w-full`: this sits in a `justify-between` flex line, and a
    // full-width child would wrap the control onto its own line. The column
    // keeps the failure directly under the control that caused it.
    <div className="flex flex-col items-end gap-2">
      <TextAction
        ref={openerRef}
        type="button"
        tone="danger"
        className="text-sm"
        onClick={() => setConfirming(true)}
      >
        Delete project
      </TextAction>
      {failure && (
        <p role="alert" className="text-sm text-amber">
          {FAILURE_MESSAGES[failure]}
        </p>
      )}
    </div>
  );
}
