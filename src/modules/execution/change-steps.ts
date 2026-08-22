import type { ChangeStage } from "./change-progress";

/**
 * The four gates one prepared change passes through, and which it is on
 * (UI-8 §2).
 *
 * ## Why this is not a second derivation
 *
 * `deriveChangeProgress` already decided this. It read validation, preview,
 * review, approval, merge and outcome, applied the gate order, and produced one
 * `ChangeStage`. This takes that answer — and only that answer — and says which
 * of four boxes it falls in.
 *
 * Nothing here reads a card. That is the point: a rail that consulted
 * `ValidationSummary` directly could disagree with the headline printed
 * immediately above it, and two components disagreeing about one change is the
 * exact defect `change-progress.ts` was written to end.
 *
 * ## Why four steps and not five
 *
 * The section renders five panels — validation, preview, review, approval,
 * merge — and the obvious rail has five steps. The domain does not agree.
 * `reviewGate` folds a preview in flight into `reviewing`, because a preview is
 * the thing a comparison is built from rather than a gate of its own: it never
 * blocks a change, and a change can be approved without one ever having run.
 *
 * A fifth step would therefore have to show "pending" forever on changes that
 * legitimately skipped it, which reads as unfinished business that does not
 * exist. The preview panel keeps its own state, where it means something.
 */

export const CHANGE_STEPS = [
  { id: "validation", label: "Validation" },
  { id: "review", label: "Review" },
  { id: "approval", label: "Approval" },
  { id: "merge", label: "Merge" },
] as const;

export type ChangeStepId = (typeof CHANGE_STEPS)[number]["id"];

export type ChangeStepState = "done" | "active" | "blocked" | "pending";

export type ChangeStepView = {
  id: ChangeStepId;
  label: string;
  state: ChangeStepState;
};

/** Which of the four gates a stage sits on, or 4 once the change is in. */
function stepIndex(stage: ChangeStage): number {
  switch (stage) {
    case "not_validated":
    case "validating":
    case "validation_failed":
      return 0;
    case "reviewing":
    case "review_required":
    case "review_unavailable":
      return 1;
    case "awaiting_approval":
      return 2;
    case "ready_to_merge":
    case "merging":
    case "stalled":
      return 3;
    case "merged":
    case "observed":
      return CHANGE_STEPS.length;
  }
}

/**
 * The three stages that mean *this cannot advance as it is*, as opposed to
 * *it is your turn*.
 *
 * `review_required` and `awaiting_approval` are deliberately absent. Both are
 * the founder's move, and marking them as trouble would tell somebody their
 * change is broken when it is simply waiting for them to look at it.
 */
function isBlocked(stage: ChangeStage): boolean {
  return stage === "validation_failed" || stage === "review_unavailable" || stage === "stalled";
}

/**
 * One stage in, four steps out.
 *
 * Every step before the current one is `done`, the current one is `active` or
 * `blocked`, and every step after it is `pending` — never blocked, because a
 * gate nothing has reached cannot have refused anything.
 */
export function deriveChangeSteps(stage: ChangeStage): ChangeStepView[] {
  const current = stepIndex(stage);
  const blocked = isBlocked(stage);

  return CHANGE_STEPS.map((step, index) => ({
    id: step.id,
    label: step.label,
    state:
      index < current ? "done" : index > current ? "pending" : blocked ? "blocked" : "active",
  }));
}
