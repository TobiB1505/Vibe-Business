import { OperationProgress } from "@/components/system/operation-progress";
import type { OperationView, ProgressSequenceId } from "@/modules/operations/view";

/**
 * The work itself, while it is being done.
 *
 * ## The gap this closes
 *
 * Press "Plan this move" and twenty Credits are spent on a run that takes
 * about a minute. Until now the thread had nothing to say about that minute:
 * the Move block stayed on screen, the control went quiet, and the next thing
 * a founder saw was the finished plan — on a different screen, if they thought
 * to go and look. The press and its consequence were not visibly the same
 * event.
 *
 * So the press produces a block. It is the ordinary rhythm, not a special
 * case: Nova says what is happening, the block shows it happening, and when it
 * lands the next moment is derived from the row the run wrote.
 *
 * ## Why this composes rather than draws
 *
 * `OperationProgress` is the checklist the Action Plan already renders, and it
 * is the reason this file is nine lines. Its rows come from the operation's
 * own durable stage, so a tick is a fact rather than an animation on a timer,
 * and it already refuses the three dishonest things a progress display wants
 * to do — no percentage, no "3 of 4", no estimate of how long a row of
 * inference takes. It also already knows the other two states: a run past the
 * stall threshold says so without claiming it failed, and a failure speaks in
 * the failure's own words.
 *
 * None of that is worth rebuilding in a thread, and rebuilding it is how the
 * two would drift apart. The component carries no frame of its own, so there
 * is not even a variant to add — the render block supplies the frame, which is
 * what composition looks like when a component was already the right shape.
 *
 * ## What the caller must not choose
 *
 * The sequence. `progressSequenceFor` in `block-registry.ts` derives it from
 * the operation type, because a caller free to pass either one is a caller
 * free to draw a founder the planning rows while an opportunity run is going.
 */
export function ProgressBlock({
  sequence,
  operation,
  retry,
}: {
  sequence: ProgressSequenceId;
  operation: OperationView;
  /** Offered by the thread only where `OperationProgress` judges it honest. */
  retry?: React.ReactNode;
}) {
  return (
    <OperationProgress sequence={sequence} operation={operation} variant="timeline" retry={retry} />
  );
}
