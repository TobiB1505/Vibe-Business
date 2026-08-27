import { cn } from "@/lib/utils/cn";
import { CheckIcon } from "@/components/ui/dashboard-icons";
import type { OperationProgressStep } from "@/modules/operations/view";

/**
 * What a run is doing, as named rows (ACTION PLAN UI-2).
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

export function PlanProgressSteps({
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
