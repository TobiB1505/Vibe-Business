import { Surface } from "@/components/ui/surface";
import type { MoveSummaryCounts } from "@/modules/opportunities/view";

/**
 * The three numbers above the plan (ACTION PLAN UI-2).
 *
 * `counts` is null before a set exists, and each figure then reads `—` rather
 * than `0`. The distinction is the same one the project rail already draws for
 * its badges: zero is a measurement, an em dash is the absence of one, and a
 * screen that prints "0 moves" while Vibe is still working says something
 * untrue about the business rather than about the wait.
 *
 * `readyForVibe` counts the readiness the engine recorded — a claim about a
 * category of work, never a promise that a button exists for it (§54). Which
 * is why the line under it says Vibe *can start*, and the decision about
 * whether it actually can stays with each Move's own action row.
 */
export function PlanSummary({ counts }: { counts: MoveSummaryCounts | null }) {
  const figures = [
    { value: counts?.total, label: "Moves", detail: "in this plan" },
    { value: counts?.readyForVibe, label: "Ready for Vibe", detail: "Vibe can start now" },
    { value: counts?.needsInput, label: "Needs your input", detail: "Your input required" },
  ];

  return (
    <Surface level="panel" padding="md" data-testid="plan-summary">
      <dl className="grid grid-cols-3 gap-4">
        {figures.map((figure) => (
          <div key={figure.label} className="flex min-w-0 flex-col gap-1">
            <dd className="text-fg text-headline leading-none font-bold tabular-nums">
              {figure.value ?? "—"}
            </dd>
            <dt className="text-fg-body text-ui font-medium">{figure.label}</dt>
            <p className="text-fg-meta text-meta leading-snug">{figure.detail}</p>
          </div>
        ))}
      </dl>
    </Surface>
  );
}
