import type { OperationType } from "./schema";

/**
 * A way to stop paid work without shipping a deploy (VB-032).
 *
 * Every operation that spends money runs on a provider Vibe does not control —
 * Anthropic, the sandbox, the remote browser. When one of those starts
 * misbehaving in a way that costs money rather than failing cleanly (a
 * retry storm, a pricing change, a runaway agent), the only lever this
 * application had was a code change and a deployment. That is minutes at best,
 * and it is minutes during the incident.
 *
 * `PAID_OPERATIONS_DISABLED=1` refuses new paid starts immediately. Reads are
 * untouched: a founder can still open every screen, read every audit, see every
 * Move. Nothing already running is cancelled — killing in-flight work would
 * abandon operations mid-flight, and an operation that is already paid for is
 * money better spent than wasted.
 *
 * ## Two exemptions, and both are the point
 *
 * **`preview_teardown`** costs infrastructure and exists to *stop* a larger
 * cost. Refusing it during a spend incident would leave previews running and
 * burning exactly the money the switch was thrown to save. Blocking it is the
 * switch working backwards.
 *
 * **`account_erasure`** is a person exercising a right. It is not paid work and
 * must never be blocked by an operational lever.
 *
 * ## Why the classification is a table and not a predicate
 *
 * `Record<OperationType, …>` is exhaustive at compile time, so a new operation
 * type cannot be added without someone deciding whether it spends money. A
 * predicate over names, or a set of "the paid ones", is silently wrong for
 * every type added after it was written — and silently wrong in the direction
 * of *not* being stopped.
 */
export type OperationCostClass =
  /** Spends a paid model call. */
  | "paid_inference"
  /** Spends sandbox minutes, remote browser time, or a real branch write. */
  | "paid_infrastructure"
  /** Costs something, and exists to end a larger cost. Never blocked. */
  | "cleanup"
  /** Work Vibe performs at no marginal provider cost. */
  | "free"
  /** A person exercising a right over their own account. Never blocked. */
  | "lifecycle";

export const OPERATION_COST_CLASS: Record<OperationType, OperationCostClass> = {
  business_audit: "paid_inference",
  opportunity_generation: "paid_inference",
  action_planning: "paid_inference",
  product_understanding: "paid_inference",
  agent_execution: "paid_inference",

  change_validation: "paid_infrastructure",
  change_preview: "paid_infrastructure",
  change_review: "paid_infrastructure",
  change_preparation: "paid_infrastructure",
  change_merge: "paid_infrastructure",

  preview_teardown: "cleanup",

  product_scan: "free",
  change_outcome_verification: "free",
  business_measurement: "free",

  account_erasure: "lifecycle",
};

/** True for the operations the kill switch refuses. */
export function isPaidOperation(operationType: OperationType): boolean {
  const costClass = OPERATION_COST_CLASS[operationType];
  return costClass === "paid_inference" || costClass === "paid_infrastructure";
}

/**
 * Whether new paid starts are currently refused.
 *
 * Only the exact string `"1"` enables it. An operational lever read from a
 * loose truthiness check is one a stray `PAID_OPERATIONS_DISABLED=false` turns
 * *on* — and discovering that during an incident, in the direction of "nothing
 * can be started", is the worst possible time.
 */
export function arePaidOperationsDisabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.PAID_OPERATIONS_DISABLED === "1";
}
