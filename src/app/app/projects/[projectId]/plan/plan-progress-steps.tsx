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

export function PlanProgressSteps({
  steps,
  className,
}: {
  steps: OperationProgressStep[];
  className?: string;
}) {
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
