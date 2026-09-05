"use client";

import { useActionState } from "react";
import { ActionBlock } from "@/components/system/action-block";
import type { CostBalance } from "@/components/system/cost-disclosure";
import { Button } from "@/components/ui/button";
import { startPlanAction, type StartPlanActionState } from "@/app/app/projects/[projectId]/plan-action";

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
 * ## Why the price is on the control and not in a sentence
 *
 * Because it is a decision. `ActionBlock` puts the price directly under the
 * button, from the rate card in force, with the balance beside it when the
 * surface has read one — so "Plan this move" and what it costs are read in one
 * glance. When the operation is free the same slot says `Included`, which is
 * the difference ADR 0094 exists to make: silence would read as a price that
 * has not loaded.
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
  balance,
  skip,
}: {
  projectId: string;
  opportunityId: string;
  /** Null when the surface has not read one. Never suppresses the price. */
  balance: CostBalance | null;
  /** The form that completes onboarding and opens the workspace. */
  skip: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState<StartPlanActionState, FormData>(
    startPlanAction.bind(null, projectId, opportunityId),
    null,
  );

  return (
    <div className="flex flex-col gap-4" data-testid="first-move-decision">
      <ActionBlock
        operation="action_plan"
        balance={balance}
        control={
          <form action={formAction} className="flex flex-wrap items-center gap-3">
            {/* Replanning costs money and is never defaulted on (rule 60). */}
            <input type="hidden" name="force" value="false" />
            <Button type="submit" disabled={pending} busy={pending}>
              {pending ? "Starting…" : "Plan this move"}
            </Button>
            {skip}
          </form>
        }
        consequence="Vibe turns this Move into concrete steps, and says which of them it can carry out itself. Nothing is changed in your product by planning."
      />

      {state?.ok === false && (
        <p className="text-amber text-sm" role="status">
          Vibe could not start planning. Nothing was charged — you can try again from your
          workspace.
        </p>
      )}
    </div>
  );
}
