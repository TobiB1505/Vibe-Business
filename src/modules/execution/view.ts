import type { BusinessOpportunity } from "@/modules/opportunities/schema";
import type { OperationView } from "@/modules/operations/view";
import type { ExecutionBlockReason, ExecutionCapability } from "./schema";

/**
 * What the Opportunities UI may offer for one opportunity (Sprint 9C §2, §16, §17).
 *
 * ## Readiness is not a button
 *
 * `executionReadiness === "ready"` is the model's opinion that a human could
 * act on this. Whether *Vibe* can act on it is a different question with a
 * different answer, and the whole point of this file is that the UI derives
 * the second rather than reading the first.
 *
 * Offering "Let Vibe prepare this" on an opportunity with no executor would be
 * the worst kind of product lie: a button that looks like capability and
 * produces a failure.
 *
 * Pure and synchronous, so every state a user can land in is a unit test.
 */

export type OpportunityActionState =
  /** Vibe has an executor and nothing currently blocks it. */
  | { kind: "preparable"; capability: ExecutionCapability }
  /** Already prepared for this exact state — review it, do not write again. */
  | { kind: "already_prepared"; preparedChangeId: string }
  /** A preparation is running right now. */
  | { kind: "preparing"; operation: OperationView }
  /** The last attempt failed; retry only where a retry is meaningful. */
  | { kind: "failed"; operation: OperationView; retryAllowed: boolean }
  /** There is an executor, but something must change first. */
  | { kind: "blocked"; reason: ExecutionBlockReason }
  /** The model itself said a human decision comes first. */
  | { kind: "needs_user_input" }
  /** No executor exists for this kind of work. */
  | { kind: "not_automated" };

export type OpportunityActionInput = {
  opportunity: BusinessOpportunity;
  /** Resolved server-side. Null when Vibe has no executor for it (§2). */
  capability: ExecutionCapability | null;
  /** A successful prepared change for this exact execution identity. */
  preparedChangeId: string | null;
  /** A live `change_preparation` operation for this opportunity. */
  activeOperation: OperationView | null;
  /** The most recent terminal operation, when it failed. */
  failedOperation: OperationView | null;
  /** Why preparation cannot start, when it cannot. */
  blockedReason: ExecutionBlockReason | null;
};

export function buildOpportunityActionState(
  input: OpportunityActionInput,
): OpportunityActionState {
  // Live work first: whatever else is true, something is happening now and the
  // UI must not offer a second start (§17).
  if (input.activeOperation !== null) {
    return { kind: "preparing", operation: input.activeOperation };
  }

  // Already done for this exact state. Reusing the 9B semantics rather than
  // offering a write that would return `reused` anyway (§16).
  if (input.preparedChangeId !== null) {
    return { kind: "already_prepared", preparedChangeId: input.preparedChangeId };
  }

  // No executor. Checked before readiness, because "ready" on something Vibe
  // cannot do must never render an active button.
  if (input.capability === null) {
    return input.opportunity.executionReadiness === "needs_user_input"
      ? { kind: "needs_user_input" }
      : { kind: "not_automated" };
  }

  if (input.failedOperation !== null) {
    return {
      kind: "failed",
      operation: input.failedOperation,
      retryAllowed: input.failedOperation.retryAllowed,
    };
  }

  if (input.blockedReason !== null) return { kind: "blocked", reason: input.blockedReason };

  return { kind: "preparable", capability: input.capability };
}

/**
 * What a blocked state offers the user (§6, §7).
 *
 * Every reason carries an action or an explanation — never a bare sentence
 * with a disabled button. Deep Scan shipped that dead end twice and it was
 * reported as the feature being broken both times.
 *
 * The `refresh_repository_intelligence` action is deliberately the only one
 * that runs inline: it is deterministic and costs nothing. Everything paid —
 * the audit, the opportunities — is named as a separate user decision, because
 * chaining them would spend money the user never agreed to (§6).
 */
export type BlockedAction =
  | { kind: "refresh_repository_intelligence" }
  | { kind: "update_audit" }
  | { kind: "refresh_opportunities" }
  | { kind: "enable_github_write" }
  /** Nothing to do here — the explanation is the whole answer. */
  | { kind: "none" };

const BLOCKED_ACTIONS: Record<ExecutionBlockReason, BlockedAction> = {
  repository_changed: { kind: "refresh_repository_intelligence" },
  stale_repository_intelligence: { kind: "refresh_repository_intelligence" },
  stale_audit: { kind: "update_audit" },
  stale_opportunity: { kind: "refresh_opportunities" },
  github_write_permission_required: { kind: "enable_github_write" },
  // The rest are statements of fact the user cannot act on from here. Saying
  // so plainly beats offering a button that would not help.
  premise_no_longer_true: { kind: "none" },
  conflicting_files_exist: { kind: "none" },
  unsupported_framework: { kind: "none" },
  unsupported_repository_layout: { kind: "none" },
  missing_required_context: { kind: "none" },
  unsupported_opportunity: { kind: "none" },
  execution_not_available: { kind: "none" },
};

export function blockedAction(reason: ExecutionBlockReason): BlockedAction {
  return BLOCKED_ACTIONS[reason];
}

/**
 * Copy for a blocked state.
 *
 * Centred on *prepare*, never *ship*, *fix* or *deploy* (§30). Vibe prepares a
 * change; the founder reviews it. Nothing here implies otherwise.
 */
export const BLOCKED_MESSAGES: Record<ExecutionBlockReason, string> = {
  repository_changed:
    "Your repository changed since Vibe analyzed it. Vibe won't prepare a change against code it has not analyzed.",
  stale_repository_intelligence:
    "Vibe's view of your code is out of date. Refresh it before preparing this change.",
  stale_audit: "Your business audit is based on older product evidence.",
  stale_opportunity: "Your opportunities need refreshing before Vibe can prepare this change.",
  github_write_permission_required:
    "Vibe currently has read access to this repository. To prepare an isolated branch and commit, Vibe needs permission to write repository contents.",
  premise_no_longer_true: "This opportunity is no longer current.",
  conflicting_files_exist: "Your repository already contains an implementation for this change.",
  unsupported_framework: "Vibe can't prepare this kind of change for your framework yet.",
  unsupported_repository_layout: "Vibe can't safely determine where this change belongs yet.",
  missing_required_context: "Vibe is missing information required to prepare this change safely.",
  unsupported_opportunity: "Vibe can't prepare this opportunity automatically yet.",
  execution_not_available: "Preparing changes isn't available for this project yet.",
};

export const BLOCKED_ACTION_LABELS: Record<Exclude<BlockedAction["kind"], "none">, string> = {
  refresh_repository_intelligence: "Refresh product intelligence",
  update_audit: "Update business audit",
  refresh_opportunities: "Refresh opportunities",
  enable_github_write: "Enable GitHub write access",
};

/**
 * Where each blocked action actually sends someone (UI dead-end fix).
 *
 * ## Why this is here rather than in the panel
 *
 * Because it was in the panel, and the panel got it wrong in a way nothing
 * could catch. `prepare-change-panel.tsx` resolved all four actions to two
 * bare fragments — `#github-access` and `#business-audit` — written when the
 * workspace was a single page. The UI-2 route split gave each section its own
 * URL and left both fragments behind: neither id exists on the page the panel
 * renders on, so every one of these links has scrolled nowhere since.
 *
 * That is the exact dead end this module's own docblock says it exists to
 * prevent, and it survived because a fragment that resolves to nothing throws
 * nothing, logs nothing and renders identically to one that works.
 *
 * So the mapping moves into data, beside the actions it maps, where a test can
 * assert that every actionable kind resolves to a destination. The caller
 * supplies the destinations, because a route is a UI fact and this module has
 * no business knowing what the workspace's segments are called.
 */
export type BlockedActionDestinations = {
  /** Where Vibe re-reads the code and the live product. */
  product: string;
  /** Where the business audit is run. */
  audit: string;
  /** Where next moves are produced. */
  moves: string;
  /** Where the repository connection — and its permissions — are managed. */
  repository: string;
};

export function blockedActionHref(
  action: BlockedAction,
  destinations: BlockedActionDestinations,
): string | null {
  switch (action.kind) {
    case "refresh_repository_intelligence":
      return destinations.product;
    case "update_audit":
      return destinations.audit;
    case "refresh_opportunities":
      return destinations.moves;
    case "enable_github_write":
      return destinations.repository;
    case "none":
      // Deliberately null rather than a fallback destination. "Nothing to do
      // here" is a real answer, and sending someone somewhere plausible would
      // be worse than the sentence they already have.
      return null;
  }
}

/** The capability's user-facing name. Never the internal identifier. */
export const CAPABILITY_LABELS: Record<ExecutionCapability, string> = {
  nextjs_seo_foundations_v1: "SEO foundations",
  nextjs_seo_foundations_v2: "SEO foundations",
  // Names what the change *is* from the customer's side, not the machinery that
  // produced it. "Agentic execution v1" is our vocabulary; "a change to your
  // app" is theirs, and the plan step beside it says which change.
  agentic_execution_v1: "Change to your app",
  agentic_execution_v2: "Change to your app",
};
