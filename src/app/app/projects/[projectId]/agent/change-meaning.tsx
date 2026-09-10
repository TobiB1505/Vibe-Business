import { planMoveHref } from "@/modules/action-plans/source";
import type { PreparedChangeWorkspaceItem } from "@/modules/execution/workspace";
import { ChangeOrigin, MoveBacklink } from "../change-origin";
import { ChangeRationale } from "../change-rationale";

/**
 * What a change is for, before anything asks for authorization.
 *
 * ## Why this exists as a component
 *
 * Because it was the header of `ChangeGates`, and `ChangeGates` was deleted.
 *
 * That component was the review surface before the Agent workspace, and the
 * workspace replaced every gate in it — validation, preview, review, approval,
 * merge, outcome, impact — panel for panel. Every gate, but not the three
 * things above them: the written rationale, the origin block, and the way back
 * to the Move. Those had no second call site, so from the day the workspace
 * shipped they were reachable on exactly one surface: the fixture route.
 *
 * Which means the sentence a founder most needs before approving a change —
 * *what was this for* — was on no screen in the product. `ChangeOrigin`'s own
 * docblock says where that bites hardest: `agentic_execution_v1` is the
 * capability of every change an agent writes, so `businessRationaleFor`
 * returns null for all of them and the origin block is what renders. The
 * agent is the product now (rule 78). So this was missing for every change
 * the product makes.
 *
 * Deleting the shell without this would have made that permanent, and called
 * it a cleanup.
 *
 * ## The precedence, unchanged
 *
 * The written rationale wins when there is one: two answers to the same
 * question would stack, and the hand-written one is the stronger claim. When
 * it wins, the origin block is suppressed and the Move travels on its own as a
 * link — navigation rather than a second account of why the change exists,
 * because without it a deterministic change names its Move nowhere.
 *
 * Both components keep their own unconditional last line, and that is their
 * business rather than this one's: a rationale without its limitation is a
 * promise, and an origin without its is a finding.
 */
export function AgentChangeMeaning({
  change,
  planHref,
}: {
  change: PreparedChangeWorkspaceItem;
  /** The Action Plan, which the Move link is resolved against. */
  planHref: string;
}) {
  const moveHref = change.opportunityId ? planMoveHref(planHref, change.opportunityId) : null;

  return (
    <>
      <ChangeRationale rationale={change.rationale} />

      {!change.rationale && <ChangeOrigin origin={change.origin} moveHref={moveHref} />}

      {change.rationale && change.origin && moveHref && (
        <MoveBacklink title={change.origin.title} href={moveHref} />
      )}
    </>
  );
}
