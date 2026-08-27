"use client";

import { useActionState, useState } from "react";
import { TextAction } from "@/components/ui/button";
import { ConfirmPanel, useReturnFocus } from "@/components/ui/confirm-panel";
import { Surface } from "@/components/ui/surface";
import type { ErasureFailureReason, ErasureViewState } from "@/modules/operations/account-erasure/view";
import { deleteAccountAction, type DeleteAccountActionState } from "./delete-account-actions";

/**
 * Erasing an account (ADR 0056 §4, §9).
 *
 * ## Why the confirmation says what survives, not only what goes
 *
 * Because financial records survive on purpose, and a person consenting to
 * "delete everything" has not consented to that. ADR 0056 §6 retains the credit
 * ledger whole and §9 keeps the Stripe identifiers so a past charge stays
 * attributable — both with the owner removed. Saying so is the difference
 * between erasure and a promise Vibe would be breaking the moment it kept its
 * books.
 *
 * ## The two things Vibe does not do, stated before the click
 *
 * The GitHub App is **not** uninstalled on GitHub's side — Vibe has never had
 * that behaviour, and adding an outbound mutation to an erasure path is exactly
 * the kind of external effect that must not appear silently (§4). And the
 * subscription is cancelled immediately with no refund of the remaining paid
 * period (§9), which is a consequence of erasure being immediate rather than an
 * oversight.
 *
 * ## Why a failure is not an error message
 *
 * Most of them are the account still being busy, and the honest reading is that
 * the erasure is waiting for work that can still write — not that something
 * broke. It also has not left a half-erased account behind: every step stops
 * the sequence rather than pressing on.
 */

const FAILURE_MESSAGES: Record<ErasureFailureReason, string> = {
  billing_not_finalized:
    "A Credit hold has not settled yet. Nothing was erased. Try again in a moment.",
  stripe_cancel_failed:
    "Your subscription could not be cancelled, so nothing was erased — Vibe will not delete an account it can still be charged for. Try again in a moment.",
  project_deletion_failed:
    "One of your projects is still busy, so nothing was erased. Try again once Vibe has finished working on it.",
  erasure_start_failed: "The erasure could not be started. Nothing was changed. Try again in a moment.",
  unknown: "The erasure did not complete, and your account is still here. Try again in a moment.",
};

const initialState: DeleteAccountActionState = null;

export function DeleteAccountSection({ state }: { state: ErasureViewState }) {
  const [confirming, setConfirming] = useState(false);
  const openerRef = useReturnFocus<HTMLButtonElement>(confirming);
  const [result, formAction, pending] = useActionState(deleteAccountAction, initialState);

  const failure: ErasureFailureReason | null =
    result && !result.ok ? result.error : state.kind === "failed" ? state.reason : null;

  return (
    <Surface
      level="panel"
      padding="md"
      className="flex flex-col gap-4"
      data-testid="delete-account"
    >
      <div className="flex flex-col gap-2">
        <h2 className="text-fg text-title font-bold">Delete your account</h2>
        <p className="text-fg-muted text-sm leading-6">
          Erase your Vibe account, every project in it, and your sign-in.
        </p>
      </div>

      {state.kind === "running" ? (
        <p role="status" className="text-fg-muted text-sm leading-6">
          Your account is being erased. Vibe has stopped starting new work, and you will be signed
          out once it finishes.
        </p>
      ) : confirming ? (
        <form action={formAction}>
          <ConfirmPanel
            title="Erase this account?"
            tone="caution"
            confirmLabel="Erase account"
            confirmType="submit"
            pending={pending}
            onCancel={() => setConfirming(false)}
          >
            <>
              <p>
                Every project and everything Vibe has learned about it is permanently deleted, along
                with your GitHub connection and your sign-in. You will not be able to sign back in.
              </p>
              <p>
                Your billing history is kept without your name on it. Vibe has to be able to account
                for payments it has already taken, so the Credit ledger and the payment references
                survive with the owner removed — they are no longer linked to you.
              </p>
              <p>
                Your subscription is cancelled straight away. The rest of the period you have paid
                for is not refunded.
              </p>
              <p>
                This does not uninstall the Vibe GitHub App. Remove it yourself in your GitHub
                settings if you want Vibe&apos;s access gone as well.
              </p>
              <p>This cannot be undone.</p>
            </>
          </ConfirmPanel>
        </form>
      ) : (
        <div>
          <TextAction
            ref={openerRef}
            type="button"
            tone="danger"
            className="text-sm"
            onClick={() => setConfirming(true)}
          >
            Delete account
          </TextAction>
        </div>
      )}

      {failure && (
        <p role="alert" className="text-sm text-amber">
          {FAILURE_MESSAGES[failure]}
        </p>
      )}
    </Surface>
  );
}
