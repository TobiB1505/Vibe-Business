import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";
import { CheckIcon } from "@/components/ui/dashboard-icons";
import { OPERATION_FAILURE_MESSAGES } from "@/modules/operations/messages";
import {
  OPERATION_STAGE_LABELS,
  operationProgressSteps,
  type OperationProgressStep,
  type OperationView,
  type ProgressSequenceId,
} from "@/modules/operations/view";

/**
 * What a run is doing, as named rows (ACTION PLAN UI-2; audit R36).
 *
 * The rows come from `operationProgressSteps`, which reads the operation's own
 * durable stage — so a tick is a fact, not an animation that advances on a
 * timer. There is no percentage, no "3 of 4" and no elapsed estimate here for
 * the reason the stage labels themselves carry: a row that is fifty seconds of
 * inference has no honest fraction.
 *
 * Every state is named in the row's own text through `aria-label`, so the
 * tick, the spinner and the empty circle are decoration over information that
 * is already there without them.
 */
const STATE_DESCRIPTION: Record<OperationProgressStep["state"], string> = {
  done: "Done",
  current: "Working on it",
  pending: "Not started",
};

const STAGE_DESCRIPTIONS: Partial<Record<string, string>> = {
  "Preparing evidence": "Reading your latest product and business context",
  "Finding your highest-impact opportunities": "Identifying the few moves that matter most",
  "Working out how to do this": "Turning the selected move into concrete work",
  "Validating result": "Checking that the result is complete and grounded",
  "Saving result": "Making the plan available across your workspace",
};

export function ProgressSteps({
  steps,
  className,
  variant = "compact",
}: {
  steps: OperationProgressStep[];
  className?: string;
  variant?: "compact" | "timeline";
}) {
  if (variant === "timeline") {
    return (
      <ol className={cn("flex flex-col", className)} data-testid="plan-progress">
        {steps.map((step, index) => {
          const isLast = index === steps.length - 1;
          return (
            <li key={step.label} className="relative flex gap-4 pb-6 last:pb-0">
              {!isLast && (
                <span
                  aria-hidden
                  className={cn(
                    "absolute top-8 bottom-0 left-4 w-px",
                    step.state === "done" ? "bg-mint-dim" : "bg-line-3",
                  )}
                />
              )}
              <span
                aria-hidden
                className={cn(
                  "relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full border font-mono text-ui tabular-nums",
                  step.state === "done" && "border-mint-line bg-mint-tint text-mint",
                  step.state === "current" &&
                    "border-mint bg-mint-tint-soft text-mint shadow-dot-mint",
                  step.state === "pending" && "border-line-3 bg-surface-2 text-fg-meta",
                )}
              >
                {step.state === "done" ? <CheckIcon size={13} /> : index + 1}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-1 pt-1">
                <div className="flex items-center justify-between gap-3">
                  <span
                    className={cn(
                      "text-sm font-medium",
                      step.state === "pending" ? "text-fg-muted" : "text-fg-body",
                    )}
                  >
                    {step.label}
                    <span className="sr-only"> — {STATE_DESCRIPTION[step.state]}</span>
                  </span>
                  {step.state === "current" && (
                    <span
                      aria-hidden
                      className="border-line-strong size-4 shrink-0 rounded-full border border-t-mint motion-safe:animate-spin"
                    />
                  )}
                </div>
                {STAGE_DESCRIPTIONS[step.label] && (
                  <span className="text-fg-meta text-xs leading-relaxed">
                    {STAGE_DESCRIPTIONS[step.label]}
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    );
  }

  return (
    <ol className={cn("flex flex-col gap-3", className)} data-testid="plan-progress">
      {steps.map((step) => (
        <li key={step.label} className="flex items-center gap-3">
          <span
            aria-hidden
            className={cn(
              "flex size-5 shrink-0 items-center justify-center rounded-full border",
              step.state === "done" && "border-mint-line bg-mint-tint text-mint",
              step.state === "current" &&
                "border-mint-line text-mint border-t-transparent motion-safe:animate-spin",
              step.state === "pending" && "border-line-3 bg-surface-2",
            )}
          >
            {step.state === "done" && <CheckIcon size={12} />}
          </span>
          <span
            className={cn(
              "text-ui",
              step.state === "pending" ? "text-fg-muted" : "text-fg-body",
            )}
          >
            {step.label}
            <span className="sr-only"> — {STATE_DESCRIPTION[step.state]}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * A running operation, whole: its stages, or why it is not running.
 *
 * ## What this merges
 *
 * The rows were shared; everything around them was not. Each caller wrote its
 * own "this is taking much longer than expected", its own "you can leave this
 * page", and its own lookup into `OPERATION_FAILURE_MESSAGES` — three
 * vocabularies for three states of the same object, which is what the audit's
 * R36 is about. A founder met different sentences for the same situation
 * depending on which screen they were standing on.
 *
 * ## The three states, and the one rule between them
 *
 * **Running** shows the stages and says the page can be left. **Stalled** says
 * the run has gone past what the work can take and offers a fresh start —
 * never a percentage, and never a claim that it failed, because a stall is
 * inferred from a clock and the run may yet land. **Failed** says what
 * happened in the failure's own words, and offers `retry` *only* when
 * `retryAllowed` — a failure that may already have been billed does not get a
 * one-click repeat.
 *
 * What is deliberately not merged here: the Business Brain's `AuditPreparing`
 * and `AuditAnalyzing`. Those are not stage lists. They are a signature
 * surface's own lifecycle, and their own docblocks argue why they show no
 * per-lens progress — folding them into a generic row list would delete that
 * argument rather than consolidate it.
 */
export function OperationProgress({
  sequence,
  operation,
  variant = "compact",
  retry,
  runningNote,
  className,
}: {
  sequence: ProgressSequenceId;
  operation: OperationView;
  variant?: "compact" | "timeline";
  /** Offered only when the failure is one a retry can honestly address. */
  retry?: ReactNode;
  /**
   * What else is true while this runs, when the surface has something to add.
   *
   * The moves re-scan says the previous plan stays readable until the new one
   * lands — a fact about that screen, not about running operations, and one
   * the founder would otherwise have to guess. It replaces the default
   * sentence rather than joining it, so no surface says both.
   */
  runningNote?: ReactNode;
  className?: string;
}) {
  if (operation.status === "failed") {
    return (
      <div className={cn("flex flex-col gap-3", className)} data-testid="operation-progress">
        <p className="text-fg-prose max-w-[62ch] text-sm leading-relaxed">
          {operation.failureCode
            ? OPERATION_FAILURE_MESSAGES[operation.failureCode]
            : "This run stopped before it finished."}
        </p>
        {operation.retryAllowed && retry}
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-3", className)} data-testid="operation-progress">
      <p className="text-fg-prose text-sm leading-relaxed">
        {operation.stalled
          ? "This is taking much longer than expected."
          : `${OPERATION_STAGE_LABELS[operation.stage]}…`}
      </p>

      <ProgressSteps steps={operationProgressSteps(sequence, operation)} variant={variant} />

      <p className="text-fg-muted text-xs leading-relaxed">
        {operation.stalled
          ? "You can start again if this attempt never finishes."
          : (runningNote ?? "You can leave this page. Vibe will continue.")}
      </p>
    </div>
  );
}
