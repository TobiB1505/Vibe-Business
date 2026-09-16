import type { NovaActionId } from "@/modules/nova/focus";

/**
 * Which of Nova's controls Home can press itself.
 *
 * ## Why this is not in `nova-home-actions.ts`
 *
 * That file carries `"use server"`, and such a module may export nothing but
 * async functions — a type guard beside the actions fails the build. So the
 * policy lives here, where both the server actions and the server component
 * rendering the card can read it, and the actions file holds only actions.
 *
 * ## Read it as a list of what is missing
 *
 * `NOVA_ACTIONS` binds every catalogued id to a real export, and its own
 * comment is explicit that this proves existence rather than a calling
 * convention: the actions do not share a signature, and several need arguments
 * Home does not hold.
 *
 * - a merge needs the `changeApprovalId`, which the focus facts never carry
 * - a build needs the plan step key
 * - answering needs the bounded-options card that owns the alternatives
 *
 * Those are routed to the surface that owns the decision by `home-view.ts`.
 * The five below need only the project, a Move or a prepared change — all of
 * which the ranking already carried.
 */
export const DISPATCHABLE_NOVA_ACTIONS = {
  "nova.refresh_audit": "project",
  "nova.rescan_product": "project",
  "nova.plan_move": "move",
  "nova.verify_outcome": "prepared_change",
  "nova.validate_again": "prepared_change",
} as const satisfies Partial<Record<NovaActionId, "project" | "move" | "prepared_change">>;

export type DispatchableNovaActionId = keyof typeof DISPATCHABLE_NOVA_ACTIONS;

export function isDispatchableNovaAction(id: string): id is DispatchableNovaActionId {
  return id in DISPATCHABLE_NOVA_ACTIONS;
}

/** What a dispatchable action must be about, checked before it is called. */
export function novaActionSubjectKind(
  id: DispatchableNovaActionId,
): (typeof DISPATCHABLE_NOVA_ACTIONS)[DispatchableNovaActionId] {
  return DISPATCHABLE_NOVA_ACTIONS[id];
}
