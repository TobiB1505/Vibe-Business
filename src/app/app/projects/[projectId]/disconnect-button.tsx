"use client";

import { useActionState, useState } from "react";
import { TextAction } from "@/components/ui/button";
import { ConfirmPanel, useReturnFocus } from "@/components/ui/confirm-panel";
import {
  disconnectProjectAction,
  type DisconnectProjectActionState,
  type DisconnectProjectFailure,
} from "./actions";

/**
 * Disconnecting a project (UI-6 §3).
 *
 * ## Why this stopped being `window.confirm`
 *
 * It was a native `confirm()`, chosen to get an explicit confirmation without
 * a new dependency. That was the right call when the product had no
 * confirmation of its own, and stopped being one when it did.
 *
 * What the browser dialog cost here: it is the only thing in the product that
 * looks like the browser rather than like Vibe, it cannot be styled or tested
 * in the browser suite, and it puts three sentences — what disconnecting does,
 * and the two things it explicitly does not do — into one line of unstyled
 * system text that a person dismisses rather than reads.
 *
 * The same sentences now sit in the same confirmation every other consequential
 * action uses, with the keyboard behaviour that comes with it.
 *
 * ## Why a failure is rendered here at all (VB-003)
 *
 * A disconnect that the database refuses used to redirect to `/app` exactly
 * like one that succeeded, so the project reappeared in the list and the person
 * was left to work out for themselves that nothing had happened. Neither
 * sentence below promises anything the product cannot currently deliver: they
 * say the project is still connected, which is true, and offer the one action
 * that can change the outcome.
 */
const FAILURE_MESSAGES: Record<DisconnectProjectFailure, string> = {
  project_not_found: "This project could not be found. It may already have been disconnected.",
  deletion_failed: "This project could not be disconnected, and is still connected. Try again in a moment.",
};

const initialState: DisconnectProjectActionState = null;

export function DisconnectButton({ projectId }: { projectId: string }) {
  const [confirming, setConfirming] = useState(false);
  const openerRef = useReturnFocus<HTMLButtonElement>(confirming);
  const action = disconnectProjectAction.bind(null, projectId);
  const [state, formAction, pending] = useActionState(action, initialState);
  const failure = state && !state.ok ? state.error : null;

  if (confirming) {
    return (
      <form action={formAction} className="w-full">
        <ConfirmPanel
          title="Disconnect this project?"
          tone="caution"
          confirmLabel="Disconnect project"
          confirmType="submit"
          // Disables both buttons and shows the busy state, so a second click
          // cannot submit a second delete while the first is in flight.
          pending={pending}
          onCancel={() => setConfirming(false)}
        >
          <>
            <p>Vibe Business will stop tracking this repository.</p>
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
    // Not `w-full`: this sits in the settings row's `justify-between` flex
    // line, and a full-width child would wrap the control onto its own line.
    // The column keeps the failure directly under the control that caused it.
    <div className="flex flex-col items-end gap-2">
      <TextAction
        ref={openerRef}
        type="button"
        tone="danger"
        className="text-sm"
        onClick={() => setConfirming(true)}
      >
        Disconnect project
      </TextAction>
      {failure && (
        <p role="alert" className="text-sm text-amber">
          {FAILURE_MESSAGES[failure]}
        </p>
      )}
    </div>
  );
}
