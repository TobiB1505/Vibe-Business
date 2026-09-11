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
 * *what was this for* — was on no screen in the product.
 *
 * ## [2026-09-11] What that reasoning got wrong
 *
 * It went one step further than the evidence and was corrected by a founder's
 * phone. `ChangeOrigin`'s docblock says `agentic_execution_v1` has no written
 * rationale, so the origin block is what renders — and the port read that as
 * *the origin renders for every agent change*. It renders for none of them.
 *
 * `changeOriginFrom` needs the opportunity, and the opportunity needs
 * `opportunity_set_id` and `opportunity_id` on the prepared change. The agent
 * writes both as null, deliberately, and says so where it does it: *"An
 * agentic change traces to a plan step, not to an opportunity set."* So for
 * an agent change the rationale is null and the origin is null, and this
 * component has nothing to draw.
 *
 * What actually shipped from the port, therefore, was a bordered empty band
 * above the diff on the one path the product runs. The frame is gone —
 * `hasChangeMeaning` is what the caller asks — and the gap the port set out
 * to close is still open: an agent change still names what it was for
 * nowhere in the thread. Closing it needs the plan step the spec carries,
 * which is a read this card does not make, and that is a decision rather
 * than a patch.
 *
 * The deterministic path is unaffected: a capability with a written rationale
 * still shows it, and a change carrying an opportunity still shows its
 * origin and its Move.
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
/**
 * Whether there is anything to say at all.
 *
 * Asked by the caller before it draws a frame, because a separator and a
 * padded block around nothing is worse than the absence it decorates — and
 * that is exactly what shipped: a founder's phone showed two rules with an
 * empty band between them, above the diff.
 *
 * It returns false more often than the port assumed, and the reason is
 * recorded on the component below.
 */
export function hasChangeMeaning(change: PreparedChangeWorkspaceItem): boolean {
  return change.rationale !== null || change.origin !== null;
}

export function AgentChangeMeaning({
  change,
  planHref,
}: {
  change: PreparedChangeWorkspaceItem;
  /** The Action Plan, which the Move link is resolved against. */
  planHref: string;
}) {
  /* Nothing to say draws nothing, whatever a caller wraps this in. */
  if (!hasChangeMeaning(change)) return null;

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
