"use client";

import { useActionState } from "react";
import { NovaMoveButton } from "@/components/nova/nova-move";
import {
  startPlanAction,
  type StartPlanActionState,
} from "@/app/app/projects/[projectId]/plan-action";

/**
 * The decision onboarding ends on (audit Slice 6, R15).
 *
 * ## What it replaces
 *
 * "Go to your workspace" and nothing else. The founder had just been shown the
 * one Move Vibe would start with, its problem and why it comes first — and was
 * then offered a door out of the flow rather than a way into the work. The
 * whole of onboarding builds to a recommendation nobody could act on from the
 * screen that made it.
 *
 * ## Why the price is inside the control
 *
 * Because it is a decision, and the Move is the one control shape this product
 * has: the price is a child of the button rather than a panel around it, so it
 * cannot come apart from the thing it prices. When the operation is free the
 * same slot says `Included`, which is the difference ADR 0094 exists to make —
 * silence would read as a price that has not loaded.
 *
 * This was an `ActionBlock`, the shape the Move replaced everywhere else, and
 * it was the last control in setup: a founder walked a thread of Moves and met
 * a different kind of button at the end of it. The consequence `ActionBlock`
 * carried is kept, as the line under the control it is about — said before the
 * press, which is the rule it exists for.
 *
 * ## The way out stays
 *
 * Planning is a choice, not a toll gate. The workspace remains reachable
 * beside it, as a quieter control — a founder who wants to look around first
 * is not being asked to pay for the privilege of leaving onboarding.
 */
export function FirstMoveDecision({
  projectId,
  opportunityId,
  skip,
}: {
  projectId: string;
  opportunityId: string;
  /** Null when the surface has not read one. Never suppresses the price. */
  /** The form that completes onboarding and opens the workspace. */
  skip: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState<StartPlanActionState, FormData>(
    startPlanAction.bind(null, projectId, opportunityId),
    null,
  );

  return (
    <div className="flex flex-col gap-2.5" data-testid="first-move-decision">
      <form action={formAction} className="flex flex-col gap-2.5">
        {/* Replanning costs money and is never defaulted on (rule 60). */}
        <input type="hidden" name="force" value="false" />
        <NovaMoveButton
          type="submit"
          label="Plan this move"
          operation="action_plan"
          busy={pending}
          disabled={pending}
        />
        <p className="text-fg-meta text-caption">
          Vibe turns this Move into concrete steps, and says which of them it can carry out itself.
          Nothing is changed in your product by planning.
        </p>
        {skip}
      </form>

      {state?.ok === false && (
        <p className="text-amber text-body" role="status">
          Vibe could not start planning. Nothing was charged — you can try again from your
          workspace.
        </p>
      )}
    </div>
  );
}
