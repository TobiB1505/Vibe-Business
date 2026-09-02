"use client";

import { useState, useTransition } from "react";
import { buttonClasses } from "@/components/ui/button";
import { ConfirmPanel } from "@/components/ui/confirm-panel";
import { Notice } from "@/components/ui/states";
import { discardChangeAction, type DiscardActionState } from "./discard-actions";

/**
 * The other half of a decision.
 *
 * "Your decision" offered approve and merge, and no way to say no. A change a
 * founder did not want stayed prepared indefinitely — still answering "this
 * Move already has a prepared change", still holding its execution identity, so
 * the step could not be run again either. The only two options were to approve
 * something unwanted or to abandon the Move.
 *
 * Deliberately quiet: a text button rather than a filled one, and below the two
 * controls that move work forward. Rejecting is a real outcome, not the
 * suggested one.
 */
export function DiscardPanel({
  projectId,
  preparedChangeId,
  approved,
  merged,
}: {
  projectId: string;
  preparedChangeId: string;
  /** A standing approval; the server refuses regardless, this only explains. */
  approved: boolean;
  merged: boolean;
}) {
  const [state, setState] = useState<DiscardActionState>(null);
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  if (merged || state?.ok) {
    return state?.ok ? (
      <Notice tone="info" label="Discarded">
        This change is closed. You can run the step again from the Action Plan.
      </Notice>
    ) : null;
  }

  function discard() {
    startTransition(async () => {
      setState(await discardChangeAction(projectId, preparedChangeId, true));
      setConfirming(false);
    });
  }

  if (confirming) {
    return (
      <ConfirmPanel
        title="Discard this change?"
        tone="caution"
        pending={pending}
        onCancel={() => setConfirming(false)}
        onConfirm={discard}
        confirmLabel={pending ? "Discarding…" : "Discard change"}
      >
        <>
          <p>Vibe will stop offering this change, and you can run the step again.</p>
          {/* Said plainly, because "discard" reads as "delete" and this deletes
              nothing. The commit stays reachable and the record is kept. */}
          <p className="text-fg-secondary">
            The branch and its commit stay in your repository, and the record is kept for
            audit history.
          </p>
        </>
      </ConfirmPanel>
    );
  }

  return (
    <div className="flex flex-col gap-2" data-testid="discard-change">
      {state?.ok === false && (
        <Notice tone="problem" label="Not discarded">
          {state.message}
        </Notice>
      )}

      <button
        type="button"
        onClick={() => setConfirming(true)}
        disabled={pending}
        className={`${buttonClasses({ variant: "secondary", size: "sm" })} self-start`}
      >
        {approved ? "Discard (withdraw approval first)" : "Discard this change"}
      </button>
    </div>
  );
}
