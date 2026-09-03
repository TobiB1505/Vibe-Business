import type { RetailOperationKind } from "../credits/retail";
import { NOVA_ACTION_IDS } from "./focus";
import type { NovaActionId } from "./focus";

/**
 * What each of Nova's controls says, costs, and does to the world.
 *
 * ## Why the function is not here
 *
 * §K described this as a registry of `{ serverAction, price, consequential }`,
 * and the middle two are here. The function reference is not, because every
 * Server Action in this codebase lives under `src/app/` and nothing under
 * `src/modules/` imports one — the single existing crossing is a `import type`
 * (`coding-agent/agent-workspace.ts:11`). A runtime import the other way would
 * make the domain layer depend on a route's file layout.
 *
 * So the binding lives beside the actions, in `src/app/app/projects/
 * [projectId]/nova-actions.ts`, where the compiler proves each id names a real
 * export. This file holds the half that is policy rather than plumbing, and
 * stays pure — which is what lets the feed read a price without pulling a
 * route's dependency graph behind it.
 *
 * ## Two ids are not actions at all
 *
 * `nova.review_change` and `nova.view_move` are addresses. Nothing starts; a
 * founder goes and looks. Modelling them as actions would have meant inventing
 * a Server Action whose only job was to navigate — and ADR 0065 removed the
 * last "start a comparison" action deliberately, because a preview *is* the
 * review now. A `navigation` control is the honest shape for both.
 *
 * ## One id has nothing behind it yet
 *
 * `nova.choose_workspace` is `unbound`: `chooseWorkspaceRootAction` exists on
 * the Stage 4 branch and not at HEAD. That is recorded here rather than
 * quietly omitted, and it is safe because the fact that raises the candidate
 * (`workspaceChoiceRequired`) is likewise still false in `read.ts` — a test
 * below holds those two facts together, so the day one of them moves without
 * the other, the build says so.
 */

export type NovaActionControl =
  /** A Server Action runs. The app layer holds the reference. */
  | "server_action"
  /** A place to go. Nothing runs, nothing is charged, nothing is written. */
  | "navigation"
  /** Named, and not buildable yet. Nothing may offer it. */
  | "unbound";

export type NovaActionMeta = {
  control: NovaActionControl;
  /**
   * The words on the control.
   *
   * Static copy, held here rather than written per screen so that one control
   * cannot come to say two different things in two places — and so the
   * language rules below can be asserted over all of them at once.
   */
  label: string;
  /**
   * The retail operation the founder is charged under, or null when pressing
   * this costs nothing at all.
   *
   * A kind rather than a number: prices are effective-dated in
   * `credits/pricing.ts` and `CreditPrice` renders today's, so a number copied
   * into a label here would be a second price that silently goes stale.
   * `product_understanding` is free under the current policy and still named,
   * because "free" is a fact about the policy, not about the control.
   */
  price: RetailOperationKind | null;
  /**
   * Reaches outside Vibe, spends Credits, or cannot be undone by doing
   * something else.
   *
   * Answering a question is not consequential by this definition even though
   * it writes an immutable row: a replan supersedes the answer, so the founder
   * is never stuck with it. Moving a default branch is, and so is starting a
   * run that pushes one.
   */
  consequential: boolean;
  /**
   * A person confirms before it fires.
   *
   * Deliberately narrower than `consequential`. Every confirmation added to a
   * control that does not need one teaches the founder to click through the
   * ones that do — which is the reason `outcome-actions.ts` gives for having
   * no `confirmed` argument of its own. Reserved here for the two controls
   * that write to a customer's repository.
   */
  requiresConfirmation: boolean;
  /** Set only on an `unbound` control: what is missing, and what lands it. */
  unboundReason?: string;
};

export const NOVA_ACTION_META: Record<NovaActionId, NovaActionMeta> = {
  "nova.validate_again": {
    control: "server_action",
    label: "Check it again",
    price: null,
    consequential: false,
    requiresConfirmation: false,
  },
  "nova.review_change": {
    control: "navigation",
    label: "Look at the change",
    price: null,
    consequential: false,
    requiresConfirmation: false,
  },
  "nova.merge_change": {
    /*
     * The most consequential control in the product. `mergeApprovedChangeAction`
     * takes `confirmed` as a required argument rather than opening a dialog of
     * its own, so the confirmation is the caller's to hold — which is why it is
     * recorded here as policy rather than left to whichever screen renders it.
     */
    control: "server_action",
    label: "Merge it",
    price: null,
    consequential: true,
    requiresConfirmation: true,
  },
  "nova.answer_plan_question": {
    control: "server_action",
    label: "Answer",
    price: null,
    consequential: false,
    requiresConfirmation: false,
  },
  "nova.answer_agent_question": {
    /*
     * Answering does not restart the run, and the label must not suggest it
     * does. `interrupt-actions.ts` separates the two on purpose: starting the
     * next attempt is priced, and a price belongs where it is disclosed, not
     * inside a question card.
     */
    control: "server_action",
    label: "Answer",
    price: null,
    consequential: false,
    requiresConfirmation: false,
  },
  "nova.choose_workspace": {
    control: "unbound",
    label: "Choose which app",
    price: null,
    consequential: false,
    requiresConfirmation: false,
    unboundReason: "chooseWorkspaceRootAction lands with Stage 4; no such export exists at HEAD.",
  },
  "nova.rescan_product": {
    control: "server_action",
    label: "Read my product again",
    price: "product_understanding",
    consequential: false,
    requiresConfirmation: false,
  },
  "nova.start_agent": {
    control: "server_action",
    label: "Build it",
    price: "agent_execution",
    consequential: true,
    requiresConfirmation: true,
  },
  "nova.verify_outcome": {
    /*
     * Consequential because it makes read-only requests to the founder's own
     * site through the safe-fetch boundary and opens a durable window — but not
     * confirmed, for the reason `outcome-actions.ts` states: ceremony copied
     * from the merge would devalue the merge's.
     */
    control: "server_action",
    label: "Check what changed",
    price: null,
    consequential: true,
    requiresConfirmation: false,
  },
  "nova.plan_move": {
    control: "server_action",
    label: "Plan this",
    price: "action_plan",
    consequential: true,
    requiresConfirmation: false,
  },
  "nova.view_move": {
    control: "navigation",
    label: "Look at this move",
    price: null,
    consequential: false,
    requiresConfirmation: false,
  },
  "nova.refresh_audit": {
    control: "server_action",
    label: "Run the audit again",
    price: "business_audit",
    consequential: true,
    requiresConfirmation: false,
  },
};

export function novaActionMeta(id: NovaActionId): NovaActionMeta {
  return NOVA_ACTION_META[id];
}

/** The ids a control may currently be offered for. */
export function isOfferable(id: NovaActionId): boolean {
  return NOVA_ACTION_META[id].control !== "unbound";
}

export const OFFERABLE_NOVA_ACTION_IDS: readonly NovaActionId[] =
  NOVA_ACTION_IDS.filter(isOfferable);
