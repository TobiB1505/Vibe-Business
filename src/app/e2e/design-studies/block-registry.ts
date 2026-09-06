import type { FocusCandidateKind } from "@/modules/nova/focus";
import { OPERATION_TYPES, type OperationType } from "@/modules/operations/schema";

/**
 * Which block shows which state, decided in one place.
 *
 * ## The question this answers
 *
 * *Is there a logic that always picks the right one?* There was not. Every
 * block built so far was wired by hand into the sheet that wanted it, which
 * works for four and stops working at the seventh — a new operation type or a
 * new moment renders nothing at all, and nothing anywhere says so.
 *
 * So this is the same shape `CANDIDATE_STATUS` has: a **total** record over a
 * union the domain owns. Adding an operation type to `operations/schema.ts`
 * fails the build here until somebody decides what a founder sees while it
 * runs, and `block-registry.test.ts` checks the two records against the unions
 * rather than against a list written beside them.
 *
 * ## Why `none` is a real answer and not a gap
 *
 * Most operations are not things to watch. A preview teardown, a measurement,
 * an account erasure — a founder has no reason to see any of those arrive in a
 * conversation, and inventing a block for each would be fifteen surfaces for
 * six situations. Saying so explicitly is the difference between *decided* and
 * *forgotten*, and it is the whole value of the record being total.
 *
 * `WATCHED_OPERATIONS` in `nova/read.ts` already makes almost the same
 * judgement for a different reason — which of these Nova reports progress for
 * at all. The two agree today and are checked against each other, because two
 * lists that must match and are never compared is how they stop matching.
 */

/**
 * A block kind, not a component.
 *
 * The registry is data and stays importable from anywhere — a test, a server
 * component, a sheet. Mapping a kind to a React component is the caller's job,
 * and keeping that out of here is what lets the registry be checked without
 * rendering anything.
 */
export type BlockKind =
  /** The audit reading: the compact map and the leading blocker. */
  | "audit"
  /** The Product Scan, shipped component and all. */
  | "scan"
  /** The agent at work: its stages, and the files it has touched. */
  | "agent"
  /** A prepared change and its whole review gate. */
  | "review"
  /** A Move, read before it is paid for. */
  | "move"
  /** A question, answered where it was asked. */
  | "ask"
  /** Nothing to show. Decided, not missing — see the header. */
  | "none";

/**
 * What a founder sees while an operation of this type is running.
 *
 * Total over `OperationType`. Six have a block; the rest are machinery a
 * conversation has no reason to narrate.
 */
export const BLOCK_FOR_OPERATION: Record<OperationType, BlockKind> = {
  business_audit: "audit",
  product_scan: "scan",
  product_understanding: "scan",
  agent_execution: "agent",
  action_planning: "move",
  opportunity_generation: "move",

  /* A prepared change's own lifecycle. The gate shows all of it, and it shows
     the same thing whichever step is currently running — so one block, not
     five that differ by a heading. */
  change_preparation: "review",
  change_validation: "review",
  change_preview: "review",
  change_review: "review",
  change_merge: "review",
  change_outcome_verification: "review",

  /* Machinery. A founder has no reason to watch a preview being torn down, a
     measurement window closing, or their own account being erased — the last
     of which has its own surface precisely because it is not a conversation. */
  preview_teardown: "none",
  business_measurement: "none",
  account_erasure: "none",
};

/**
 * What a founder sees when a moment is the one thing to do.
 *
 * Total over `FocusCandidateKind`. `none` here means the sentence is the whole
 * of it — a disconnected source needs a reconnect, not a picture of one.
 */
export const BLOCK_FOR_MOMENT: Record<FocusCandidateKind, BlockKind> = {
  /* Something is wrong, and the sentence says what. A block would be a picture
     of an absence. */
  source_disconnected: "none",
  agent_failed: "none",
  scan_failed: "none",
  audit_failed: "none",
  agent_stalled: "none",
  scan_stalled: "none",
  audit_stalled: "none",
  repository_read_outdated: "none",

  /* A question, answered in the card that owns the options. */
  agent_question: "ask",
  founder_input_required: "ask",
  /* Not an ask: the candidate names no application, because the list comes
     from the repository analysis rather than from the ranking. */
  workspace_choice_required: "none",

  /* A change, read through its own gate. */
  validation_failed: "review",
  merge_blocked: "review",
  review_change: "review",
  merge_ready: "review",
  outcome_pending: "review",

  /* A Move, read before it is paid for. */
  plan_offered: "move",
  next_move_available: "move",
  execution_offered: "move",

  /* The audit is stale, so the reading it produced is what to show. */
  audit_outdated: "audit",

  /* Nothing is owed. A block here would be something to fill the slot. */
  nothing_to_do: "none",
};

/** Every operation type that shows something, for a caller that needs the set. */
export function watchableOperations(): OperationType[] {
  return OPERATION_TYPES.filter((type) => BLOCK_FOR_OPERATION[type] !== "none");
}
