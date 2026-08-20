"use client";

import { useState } from "react";
import { TextAction } from "@/components/ui/button";
import { ConfirmPanel, useReturnFocus } from "@/components/ui/confirm-panel";
import { disconnectProjectAction } from "./actions";

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
 */
export function DisconnectButton({ projectId }: { projectId: string }) {
  const [confirming, setConfirming] = useState(false);
  const openerRef = useReturnFocus<HTMLButtonElement>(confirming);
  const action = disconnectProjectAction.bind(null, projectId);

  if (confirming) {
    return (
      <form action={action} className="w-full">
        <ConfirmPanel
          title="Disconnect this project?"
          tone="caution"
          confirmLabel="Disconnect project"
          confirmType="submit"
          onCancel={() => setConfirming(false)}
        >
          <>
            <p>Vibe Business will stop tracking this repository.</p>
            <p>This does not uninstall the GitHub App and does not change your repository.</p>
          </>
        </ConfirmPanel>
      </form>
    );
  }

  return (
    <TextAction
      ref={openerRef}
      type="button"
      tone="danger"
      className="text-sm"
      onClick={() => setConfirming(true)}
    >
      Disconnect project
    </TextAction>
  );
}
