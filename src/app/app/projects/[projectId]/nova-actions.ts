import { agentChangeHref, planMoveHref } from "@/modules/action-plans/source";
import { preparedChangeHref, projectSectionHref } from "@/components/layout/project-shell";
import { NOVA_ACTION_META } from "@/modules/nova/actions";
import type { NovaActionId } from "@/modules/nova/focus";

import {
  confirmProductAction,
  confirmProductAndStartAuditAction,
  markNovaIntroducedAction,
  setNovaWorkflowStatusAction,
} from "@/app/app/onboarding/[projectId]/actions";

import { resolveAgentInterruptAction } from "./agent/interrupt-actions";
import { chooseWorkspaceRootAction } from "./agent/workspace-actions";
import { startAgentRunAction } from "./agent/agent-run-actions";
import { resolveFounderInputAction } from "./founder-input-action";
import { mergeApprovedChangeAction } from "./merge-actions";
import { checkProductionOutcomeAction } from "./outcome-actions";
import { startPlanAction } from "./plan-action";
import { startAuditAction } from "./run-audit-action";
import { startUnderstandingAction } from "./understanding-actions";
import { rerunChangeValidationAction } from "./validate-change-action";

/**
 * What each of Nova's controls actually is.
 *
 * ## Why this file exists here rather than in `src/modules/nova/`
 *
 * Every Server Action in this codebase lives under `src/app/`, and nothing
 * under `src/modules/` imports one. Nova's catalog — the label, the price, the
 * consequence — is domain policy and stays in the module; the binding is
 * plumbing and belongs beside the plumbing. Keeping them apart is also what
 * lets the feed read a price without dragging a route's dependency graph
 * behind it.
 *
 * ## What the binding proves, and what it does not
 *
 * It proves the export exists. `NOVA_ACTIONS` is a total
 * `Record<NovaActionId, …>`, so a new id fails to compile until it is bound,
 * and a renamed or deleted action fails to compile here — which is a stronger
 * statement than any test could make, and the reason the reference is held
 * rather than the name.
 *
 * It does **not** make the actions interchangeable. Their signatures differ on
 * purpose: two take positional identifiers because they have no form payload
 * to read, three take `(…bound, prevState, formData)` because they do, and one
 * takes `confirmed` as a required argument because the confirmation is the
 * caller's to hold. `NovaServerAction` is therefore an existence marker, not a
 * calling convention — a control is still rendered by the domain component
 * that owns its arguments, which is what keeps the product from growing a
 * second set of lookalike buttons beside the real ones.
 */

/**
 * A function, whatever its shape.
 *
 * `never[]` accepts every parameter list, which is exactly the claim being
 * made: this names something callable that exists. Anything narrower would be
 * a fiction, because these nine actions genuinely do not share a signature.
 */
type NovaServerAction = (...args: never[]) => unknown;

export type NovaActionBinding =
  | { control: "server_action"; action: NovaServerAction }
  /** An address that is not about one subject. Reconnecting leaves the app. */
  | { control: "navigation"; subject: "account"; href: () => string }
  /** An address for one prepared change. Nothing runs. */
  | {
      control: "navigation";
      subject: "prepared_change";
      href: (projectId: string, preparedChangeId: string) => string;
    }
  /** An address for one Move. Nothing runs. */
  | {
      control: "navigation";
      subject: "move";
      href: (projectId: string, opportunityId: string) => string;
    }
  /** Named in the catalog, and not buildable at HEAD. */
  | { control: "unbound" };

/**
 * The change, addressed exactly.
 *
 * `?change=` makes the identity visible to the server render and the fragment
 * makes it addressable in the browser; neither grants anything, and the read
 * behind the page still scopes the change to the signed-in user's project
 * (`action-plans/source.ts:275-284`).
 */
function changeHref(projectId: string, preparedChangeId: string): string {
  const agent = projectSectionHref(projectId, "agent");
  return preparedChangeHref(agentChangeHref(agent, preparedChangeId), preparedChangeId);
}

function moveHref(projectId: string, opportunityId: string): string {
  return planMoveHref(projectSectionHref(projectId, "action-plan"), opportunityId);
}

export const NOVA_ACTIONS: Record<NovaActionId, NovaActionBinding> = {
  "nova.continue_introduction": { control: "server_action", action: markNovaIntroducedAction },
  /*
   * Both answers are one action with two arguments rather than two actions.
   * The status is the founder's answer, not a different operation, and a
   * second export whose only difference was a string literal would be two
   * places to keep one rule.
   */
  "nova.explain_workflow": { control: "server_action", action: setNovaWorkflowStatusAction },
  "nova.skip_workflow": { control: "server_action", action: setNovaWorkflowStatusAction },
  "nova.confirm_product": { control: "server_action", action: confirmProductAction },
  /*
   * The coupled action, bound deliberately. `novaRevealControls` offers this id
   * only where the audit is free, so the one press that starts a paid operation
   * as part of a different question is a press that cannot happen (rule 60).
   */
  "nova.confirm_product_and_audit": {
    control: "server_action",
    action: confirmProductAndStartAuditAction,
  },
  /*
   * The GitHub App install flow, which is account-level and leaves the
   * product. A Server Action could not finish what it starts.
   */
  "nova.reconnect_source": {
    control: "navigation",
    subject: "account",
    href: () => "/app/connect/github",
  },
  "nova.validate_again": { control: "server_action", action: rerunChangeValidationAction },
  "nova.review_change": { control: "navigation", subject: "prepared_change", href: changeHref },
  "nova.merge_change": { control: "server_action", action: mergeApprovedChangeAction },
  "nova.answer_plan_question": { control: "server_action", action: resolveFounderInputAction },
  /*
   * The interrupt action, not the dogfood route's `resolveAgentFounderInputAction`.
   * That one answers *and* starts a fresh paid run; binding it here would have
   * put a 150-to-350-Credit restart behind a control the catalog calls free.
   */
  "nova.answer_agent_question": { control: "server_action", action: resolveAgentInterruptAction },
  "nova.choose_workspace": { control: "server_action", action: chooseWorkspaceRootAction },
  "nova.rescan_product": { control: "server_action", action: startUnderstandingAction },
  "nova.start_agent": { control: "server_action", action: startAgentRunAction },
  "nova.verify_outcome": { control: "server_action", action: checkProductionOutcomeAction },
  "nova.plan_move": { control: "server_action", action: startPlanAction },
  "nova.view_move": { control: "navigation", subject: "move", href: moveHref },
  "nova.refresh_audit": { control: "server_action", action: startAuditAction },
};

/**
 * The binding and the catalog agree about what kind of control this is.
 *
 * Checked at the boundary rather than trusted, because the two tables are in
 * different layers and only this function ever sees both.
 */
export function novaActionBinding(id: NovaActionId): NovaActionBinding {
  const binding = NOVA_ACTIONS[id];
  if (binding.control !== NOVA_ACTION_META[id].control) {
    throw new Error(`Nova action ${id} is bound as ${binding.control} and catalogued otherwise`);
  }
  return binding;
}
