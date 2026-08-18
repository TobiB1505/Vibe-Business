"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/states";
import { AGENT_START_REFUSAL_LABELS } from "@/modules/coding-agent/view";
import { startDogfoodRunAction, type StartDogfoodRunState } from "./actions";

const initialState: StartDogfoodRunState = null;

/**
 * The one explicit authorization control (EXECUTION CORE-4 website gate,
 * §12, §13).
 *
 * The button disables itself the instant it is pressed (`pending`) and stays
 * disabled through the redirect the server action performs on success — there
 * is no window in which a second click reaches the server before the first
 * one's admission has been decided, and `startAgentExecution`'s own identity
 * check makes the rare race harmless even so.
 */
export function RunPanel({ projectId, stepKey }: { projectId: string; stepKey: string }) {
  const action = startDogfoodRunAction.bind(null, projectId, stepKey);
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      {state && !state.ok && (
        <Notice tone="problem" label="couldn't start">
          {state.error === "not_eligible"
            ? "This step is no longer eligible — the page will show why above."
            : AGENT_START_REFUSAL_LABELS[state.error]}
        </Notice>
      )}
      <div>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Starting…" : "Run with Vibe"}
        </Button>
      </div>
    </form>
  );
}
