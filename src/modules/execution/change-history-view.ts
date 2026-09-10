import type { StatusTone } from "@/components/ui/status-pill";
import type { ChangeHistoryOutcome } from "./change-history";

/**
 * What each outcome is called, and in what register.
 *
 * ## Why the wording is decided here and not in the table
 *
 * Because two of these sentences are the ones this product is most likely to
 * get wrong, and a table is the wrong place to keep them honest.
 *
 * `merged` says *Merged*, never shipped, live, deployed or released. It means
 * the default branch points at the approved commit and Vibe read it back
 * (rule 74) — and Vibe calls no deployment provider, so any stronger word
 * would be a claim about the customer's own pipeline.
 *
 * `merge_stopped` says the write stopped rather than that it failed. Rule 73's
 * ambiguous state is inside it: a `merging` row means a write may already have
 * taken effect and nobody has read the branch back yet. A list that called it
 * "Failed" would be resolving that from a status, which is the one thing the
 * merge rules forbid.
 *
 * ## The tones
 *
 * `success` only for the one outcome that is one. `approved` is `waiting`
 * because it is a change with nothing wrong and nothing done — a person said
 * yes and the branch has not moved. `discarded` is `neutral`, not `problem`: a
 * founder saying no is the product working, not a fault.
 */
export const CHANGE_HISTORY_LABELS: Record<ChangeHistoryOutcome, string> = {
  merged: "Merged",
  merge_stopped: "Merge stopped",
  merge_refused: "Merge refused",
  approved: "Approved, not merged",
  checks_failed: "Checks failed",
  waiting: "Waiting for you",
  discarded: "Discarded",
  failed: "Did not finish",
  preparing: "Being written",
};

export const CHANGE_HISTORY_TONES: Record<ChangeHistoryOutcome, StatusTone> = {
  merged: "success",
  merge_stopped: "problem",
  merge_refused: "problem",
  approved: "waiting",
  checks_failed: "problem",
  waiting: "waiting",
  discarded: "neutral",
  failed: "problem",
  preparing: "active",
};

/**
 * Which outcomes are still somebody's turn.
 *
 * The history's own summary line uses it: *"nine changes, two still waiting"*
 * is a different sentence from a count, and the difference is whether a
 * founder has anything to do. Total over the outcomes so a tenth has to
 * answer the question rather than defaulting to closed.
 */
export const CHANGE_HISTORY_OPEN: Record<ChangeHistoryOutcome, boolean> = {
  merged: false,
  /* Ambiguous, and an ambiguous write is the most open thing here: somebody
     has to read the branch before this change means anything. */
  merge_stopped: true,
  merge_refused: true,
  approved: true,
  checks_failed: true,
  waiting: true,
  discarded: false,
  failed: false,
  preparing: false,
};
