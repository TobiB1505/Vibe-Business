import Link from "next/link";
import { CostDisclosure } from "@/components/system/cost-disclosure";
import { Surface } from "@/components/ui/surface";
import { StatusPill } from "@/components/ui/status-pill";
import { MonoLabel } from "@/components/ui/typography";
import type { SettledStepOutcome } from "@/modules/action-plans/view";

/**
 * The end of a plan, which until now was a sentence and a dead end.
 *
 * ## What was wrong
 *
 * When the last step closed, the plan screen rendered exactly one line —
 * *"Every step is done."* — and nothing else. No account of what the plan
 * produced, and no way onward. The founder had finished the thing the product
 * had spent an audit, a Move and five steps building up to, and the product had
 * nothing to say about it.
 *
 * That is worse than it sounds, because a plan does not only move: it *learns*.
 * A `vibe` step with no executor is closed with a written finding; a decision
 * step leaves a durable statement. Both are recorded against the immutable step,
 * both are read by the next planning run, and neither was ever shown back to
 * the person who wrote them. The footnote under every one of those fields
 * promises they are "given to the next planning run" — this is the first
 * surface where that promise is visible rather than asserted.
 *
 * ## Why it hands over instead of starting
 *
 * The obvious control here is "plan the next Move", and it is deliberately a
 * link rather than a button that spends. Planning is a paid operation, and it
 * already has a disclosed, tested offer on the Move it belongs to. A second
 * place that starts the same paid run would be a second place to get a price,
 * a balance check or a refusal wrong, for no gain — so this names the next Move
 * and its price, and hands the founder to the offer that already exists.
 *
 * Vibe never starts it (rule 60). The link changes which Move is selected; the
 * founder decides whether to spend.
 */
export function PlanCompleteCard({
  outcomes,
  nextMove,
}: {
  /** Closed steps that produced something a person would read, in plan order. */
  outcomes: readonly SettledStepOutcome[];
  /** The Move after this one, or null when this was the last one Vibe ranked. */
  nextMove: { title: string; href: string } | null;
}) {
  return (
    <Surface
      level="section"
      tone="neutral"
      padding="md"
      role="status"
      className="flex flex-col gap-4"
      data-testid="plan-complete"
    >
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill tone="success">Plan complete</StatusPill>
      </div>

      <p className="text-fg-body text-sm leading-relaxed">Every step of this Move is done.</p>

      {/* Absent rather than empty when the plan produced no written outcome —
          a heading over nothing reads as something lost. */}
      {outcomes.length > 0 && (
        <div className="flex flex-col gap-2">
          <MonoLabel className="tracking-[0.14em]">What this plan established</MonoLabel>
          <ul className="flex flex-col gap-2.5" data-testid="plan-complete-outcomes">
            {outcomes.map((entry) => (
              <li
                key={entry.stepKey}
                className="border-line-3 bg-surface-2 rounded-well border px-3 py-2.5"
              >
                <p className="text-fg-muted text-xs">
                  Step {entry.order} · {entry.title}
                </p>
                <p className="text-fg-body mt-1 text-sm leading-relaxed">{entry.outcome}</p>
              </li>
            ))}
          </ul>
          <p className="text-fg-muted text-xs">
            The next plan is written with these in front of it.
          </p>
        </div>
      )}

      {nextMove !== null && (
        <div className="flex flex-col items-start gap-2">
          <MonoLabel className="tracking-[0.14em]">Next move</MonoLabel>
          <Link
            href={nextMove.href}
            className="text-fg-secondary hover:text-fg-body text-sm leading-relaxed underline underline-offset-4"
            data-testid="plan-complete-next-move"
          >
            {nextMove.title}
          </Link>
          {/* The price of the run the founder would start over there, said
              here, before they go. Nothing on this card spends anything. */}
          <CostDisclosure operation="action_plan" />
        </div>
      )}
    </Surface>
  );
}
