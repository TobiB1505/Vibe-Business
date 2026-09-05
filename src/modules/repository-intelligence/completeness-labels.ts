import type { CompletenessReason } from "./budgets";

/**
 * Why an analysis stopped short, in a founder's words (audit D12).
 *
 * `CompletenessReason` is a budget tracker's vocabulary: `tree_truncated`,
 * `byte_budget_reached`. Those names are exactly right where they are written
 * and wrong on a screen — the human view joined them into its sentence, so a
 * founder read "(tree_truncated, file_budget_reached)" and was left to guess
 * whether their repository was broken.
 *
 * Each phrase completes "this analysis did not finish because …", and each one
 * says the same thing: Vibe reached a limit it sets for itself. None of them
 * is a fault in the customer's repository, and none of them should read like
 * one — a founder who concludes their project is malformed will go looking for
 * a problem that is not there.
 *
 * The reasons are also the bound this product accepts by design (CLAUDE.md
 * rule 27): a budget reached degrades a result to partial, and never becomes
 * an unbounded crawl.
 */
const COMPLETENESS_REASON_LABELS: Record<CompletenessReason, string> = {
  tree_truncated: "your repository lists more files than Vibe reads in one pass",
  tree_entry_budget_reached: "Vibe reached the number of entries it lists in one pass",
  file_budget_reached: "Vibe reached the number of files it opens in one analysis",
  byte_budget_reached: "Vibe reached the amount of code it reads in one analysis",
  duration_budget_reached: "the analysis reached its time limit",
  unsupported_structure: "part of the project is laid out in a way Vibe does not read yet",
};

export function completenessReasonLabel(reason: CompletenessReason): string {
  return COMPLETENESS_REASON_LABELS[reason];
}

/**
 * The reasons as one clause, ordered as recorded and joined for reading.
 *
 * Empty when there are none, which the caller reads as "no sentence to write"
 * rather than rendering an explanation with nothing in it.
 */
export function completenessReasonsClause(reasons: readonly CompletenessReason[]): string {
  const labels = reasons.map(completenessReasonLabel);
  if (labels.length === 0) return "";
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}
