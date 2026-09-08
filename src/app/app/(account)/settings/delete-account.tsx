"use client";

import { useActionState, useState } from "react";
import { ConfirmPanel, useReturnFocus } from "@/components/ui/confirm-panel";
import { DangerRow, DangerZone } from "@/components/system/danger-zone";
import type {
  ErasureFailureReason,
  ErasureViewState,
} from "@/modules/operations/account-erasure/view";
import { deleteAccountAction, type DeleteAccountActionState } from "./delete-account-actions";
import { DeleteIcon } from "@/components/ui/icons.generated";
import { Button } from "@/components/ui/button";

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
  erasure_start_failed:
    "The erasure could not be started. Nothing was changed. Try again in a moment.",
  already_erased:
    "This account has already been erased. Nothing further was started, and nothing was changed.",
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
    <DangerZone
      description="One control, and it is the one that cannot be taken back."
      data-testid="delete-account"
    >
      <DangerRow
        title="Delete your account"
        /*
          What goes, not the whole disclosure. The confirmation below carries
          the rest — the billing history that survives without a name on it,
          the subscription ending, the GitHub App that stays installed — and
          saying any of it twice makes the row and the confirmation two
          differently-worded versions of one fact.
        */
        consequence="Erases your Vibe account, every project in it, and your sign-in."
        reversible={false}
        action={content()}
      />
    </DangerZone>
  );

  function content() {
    return (
      <>
        {state.kind === "running" ? (
          <p role="status" className="text-fg-muted text-body leading-6">
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
              /*
              Typed, not clicked (UI-24). This is reached from a page somebody
              opened to change something small, and a confirmation answered by
              one click can be answered by muscle memory.
            */
              confirmPhrase="delete my account"
              confirmPhraseLabel="Type delete my account to confirm"
              pending={pending}
              onCancel={() => setConfirming(false)}
            >
              <>
                <p>
                  Every project and everything Vibe has learned about it is permanently deleted,
                  along with your GitHub connection and your sign-in. You will not be able to sign
                  back in.
                </p>
                <p>
                  Your billing history is kept without your name on it. Vibe has to be able to
                  account for payments it has already taken, so the Credit ledger and the payment
                  references survive with the owner removed — they are no longer linked to you.
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
            <Button
              variant="danger"
              size="xs"
              ref={openerRef}
              icon={<DeleteIcon size={14} />}
              onClick={() => setConfirming(true)}
            >
              Delete account
            </Button>
          </div>
        )}

        {failure && (
          <p role="alert" className="mt-3 text-body text-amber">
            {FAILURE_MESSAGES[failure]}
          </p>
        )}
      </>
    );
  }
}
