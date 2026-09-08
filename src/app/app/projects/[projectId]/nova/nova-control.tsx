"use client";

import { useActionState, useState } from "react";
import { NovaMoveButton, NovaMoveLink } from "@/components/nova/nova-move";
import { ConfirmPanel, useReturnFocus } from "@/components/ui/confirm-panel";
import { Notice } from "@/components/ui/states";
import type { CostBalance } from "@/components/system/cost-disclosure";
import type { RetailOperationKind } from "@/modules/credits/retail";
import { runNovaHomeAction, type NovaHomeActionState } from "./nova-home-actions";
import type { DispatchableNovaActionId } from "./nova-dispatch";

/**
 * The one control the Focus Card carries (UI Sourcing Spec §14, S12).
 *
 * ## Three shapes, because there are honestly three
 *
 * A **server action** runs something and reports back. **Navigation** goes
 * somewhere and nothing runs. **Elsewhere** also goes somewhere, but says so in
 * its own words rather than the catalog's, because the decision belongs to a
 * screen that holds arguments Home does not — a control labelled "Merge it"
 * that navigated instead of merging would be the label lying about the act.
 *
 * ## Why the confirmation replaces the button
 *
 * `ConfirmPanel` swaps into the same slot rather than opening over the card.
 * A confirmation that covered the card would hide the evidence the founder is
 * deciding on at the moment they need it — the argument that file already
 * makes for not being a modal. `useReturnFocus` puts focus back on the control
 * when the confirmation is dismissed, because the opener unmounts while it is
 * on screen.
 *
 * ## Why these are Moves and not buttons
 *
 * `study-move` compared three designs for this one control in all four states
 * the product produces, and B was chosen: a dark surface with one lit edge,
 * mint as line and label, and **the price inside the control rather than
 * beside it**. The filled mint block these used to be belongs to a direction
 * that was not chosen — and the separate price line above it made a spend two
 * objects for one commitment.
 *
 * So `operation` and `balance` come down to here now. `ActionBlock` still owns
 * the consequence disclosure and is deliberately no longer given a price:
 * showing it in both places would be the duplication the Move exists to end.
 */

export function NovaServerActionControl({
  projectId,
  actionId,
  subjectId,
  label,
  consequential,
  requiresConfirmation,
  confirmationNote,
  /** The retail kind this charges under, shown inside the control. */
  operation = null,
  balance,
}: {
  projectId: string;
  actionId: DispatchableNovaActionId;
  subjectId: string | null;
  label: string;
  consequential: boolean;
  requiresConfirmation: boolean;
  confirmationNote: string | null;
  operation?: RetailOperationKind | null;
  balance?: CostBalance | null;
}) {
  const [state, formAction, pending] = useActionState<NovaHomeActionState, FormData>(
    runNovaHomeAction.bind(null, projectId, actionId, subjectId),
    null,
  );
  const [confirming, setConfirming] = useState(false);
  const openerRef = useReturnFocus<HTMLButtonElement>(confirming);

  const form = (
    <form action={formAction} className="contents">
      {confirming ? (
        <ConfirmPanel
          title={label}
          tone={consequential ? "caution" : "action"}
          confirmLabel={pending ? "Starting…" : label}
          confirmType="submit"
          pending={pending}
          onCancel={() => setConfirming(false)}
        >
          <p>{confirmationNote}</p>
        </ConfirmPanel>
      ) : requiresConfirmation ? (
        <NovaMoveButton
          ref={openerRef}
          label={label}
          operation={operation}
          balance={balance}
          onClick={() => setConfirming(true)}
        />
      ) : (
        <NovaMoveButton
          type="submit"
          label={label}
          operation={operation}
          balance={balance}
          busy={pending}
          disabled={pending}
        />
      )}
    </form>
  );

  return (
    /*
     * `items-start` matters: a column flex container stretches its children by
     * default, which made the one primary control span the whole Focus Card.
     * A button as wide as the card it sits in reads as a banner rather than as
     * the one thing to press.
     */
    <div className="flex w-full flex-col items-start gap-3">
      {form}
      {state?.ok === false && (
        <Notice tone="problem" label="It did not start">
          {state.message}
        </Notice>
      )}
      {/*
        A reuse is a real outcome and a good one — the work already exists and
        nothing was charged for it again. Saying "started" would be false, and
        saying nothing would look like a button that did nothing.
      */}
      {state?.ok === true && "reused" in state && (
        <Notice tone="info" label="Already done">
          That work already exists, so nothing new was started and nothing was charged.
        </Notice>
      )}
    </div>
  );
}

export function NovaLinkControl({ href, label }: { href: string; label: string }) {
  /*
   * No cost and no destination note. Every target here is a Vibe screen — the
   * plan, the Agent, the reconnect page — so there is no price to state and
   * nothing about leaving to warn of. `leavesTo` exists on the Move for the
   * control that genuinely goes outside, and none of these is it.
   */
  return (
    <div className="w-full max-w-[24rem]">
      <NovaMoveLink href={href} label={label} />
    </div>
  );
}
