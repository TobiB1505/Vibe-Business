"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/states";
import type { AgentStartRefusal } from "@/modules/coding-agent/service";
import {
  AGENT_START_REFUSAL_LABELS,
  DOGFOOD_START_REFUSAL_LABELS,
} from "@/modules/coding-agent/view";
import {
  startDogfoodRunAction,
  type StartDogfoodRunState,
} from "../agent-dogfood/[stepKey]/actions";
import { AgentStartRefusalNotice } from "./agent-start-refusal-notice";

const initialState: StartDogfoodRunState = null;

/**
 * The real, allowlisted Agent start inside the new workspace.
 *
 * The server action owns fresh admission, immutable spec persistence, Credit
 * reservation and idempotency. This component submits only the plan step key;
 * it never decides that a run is allowed and stays disabled through the
 * redirect so a double click cannot look like two separate tasks.
 */
export function AgentStartAction({
  projectId,
  stepKey,
  repositoryReadHref,
}: {
  projectId: string;
  stepKey: string;
  /**
   * Where the founder re-reads their own code, for the refusals a stale read
   * causes. Built by the route — this component does not know the segment name.
   */
  repositoryReadHref: string;
}) {
  const action = startDogfoodRunAction.bind(null, projectId, stepKey);
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="flex w-full flex-col gap-3">
      {state && !state.ok && state.error === "not_eligible" && (
        <AgentStartRefusalNotice
          detail={state.detail}
          repositoryReadHref={repositoryReadHref}
        />
      )}
      {state && !state.ok && state.error !== "not_eligible" && (
        <Notice tone="problem" label="couldn't start">
          {state.error in DOGFOOD_START_REFUSAL_LABELS
            ? DOGFOOD_START_REFUSAL_LABELS[
                state.error as keyof typeof DOGFOOD_START_REFUSAL_LABELS
              ]
            : AGENT_START_REFUSAL_LABELS[state.error as AgentStartRefusal]}
        </Notice>
      )}
      <Button
        type="submit"
        variant="primary"
        size="md"
        disabled={pending}
        busy={pending}
        className="w-full justify-center"
      >
        {pending ? "Starting…" : "Run with Vibe"}
      </Button>
    </form>
  );
}
