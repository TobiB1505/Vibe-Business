"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import type { WorkspaceCandidate } from "@/modules/validation/profile";
import { chooseWorkspaceRootAction, type WorkspaceChoiceState } from "./workspace-actions";

const initialState: WorkspaceChoiceState = { status: "idle" };

/**
 * One submit control for one candidate.
 *
 * The directory travels as a bound argument rather than as form data — not for
 * safety, since the server re-derives the candidate list and matches against it
 * either way, but because there is then no field for anything else to arrive
 * in. The button says which application; it does not carry a path the founder
 * could have edited.
 *
 * Choosing starts nothing. It is free, reversible, and the notice above says so
 * — a control that quietly began a priced run would be the worst kind of
 * surprise on a screen whose whole subject is what Vibe is about to do.
 */
export function AgentWorkspaceChoiceAction({
  projectId,
  candidate,
  chosen,
}: {
  projectId: string;
  candidate: WorkspaceCandidate;
  /** Whether this is already the application Vibe works on. */
  chosen: boolean;
}) {
  const [state, submit, pending] = useActionState(
    chooseWorkspaceRootAction.bind(null, projectId, candidate.workspaceRoot),
    initialState,
  );

  const settled = chosen || state.status === "chosen";

  return (
    <form action={submit}>
      <Button
        type="submit"
        variant={settled ? "secondary" : "primary"}
        disabled={pending || settled}
        data-testid="agent-workspace-choose"
        data-workspace-root={candidate.workspaceRoot}
      >
        {settled ? "Working on this" : pending ? "Saving…" : "Work on this"}
      </Button>
    </form>
  );
}
