"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Button, buttonClasses } from "@/components/ui/button";
import { ConfirmPanel, useReturnFocus } from "@/components/ui/confirm-panel";
import { Notice } from "@/components/ui/states";
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
 */

export function NovaServerActionControl({
  projectId,
  actionId,
  subjectId,
  label,
  consequential,
  requiresConfirmation,
  confirmationNote,
}: {
  projectId: string;
  actionId: DispatchableNovaActionId;
  subjectId: string | null;
  label: string;
  consequential: boolean;
  requiresConfirmation: boolean;
  confirmationNote: string | null;
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
        <Button ref={openerRef} type="button" variant="primary" onClick={() => setConfirming(true)}>
          {label}
        </Button>
      ) : (
        <Button type="submit" variant="primary" busy={pending} disabled={pending}>
          {pending ? "Starting…" : label}
        </Button>
      )}
    </form>
  );

  return (
    <div className="flex w-full flex-col gap-3">
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

export function NovaLinkControl({
  href,
  label,
  variant = "primary",
}: {
  href: string;
  label: string;
  variant?: "primary" | "secondary";
}) {
  return (
    <Link href={href} className={buttonClasses({ variant })}>
      {label}
    </Link>
  );
}
