import { RatingChip } from "@/components/ui/status-pill";
import { cn } from "@/lib/utils/cn";

/**
 * One vocabulary for how sure Vibe is (UI Sourcing Spec §10.6, C3).
 *
 * ## Three kinds, and why they stay apart
 *
 * A **fact** is something Vibe observed — a profile field, a detected surface.
 * It reads `Confirmed / Likely / Unclear / Not found`.
 *
 * A **judgment** is something Vibe concluded — a lens reading, a Move's
 * confidence. It reads `High / Medium / Low confidence`.
 *
 * **Coverage** is how much of a thing could be assessed at all: "Scored 6 of 9
 * areas". It is not a confidence in the other two senses and must never be
 * rendered as a percentage — the score behind it is a score, not a fraction of
 * work done.
 *
 * Collapsing the three into one scale is what produced four vocabularies in
 * the first place, and it loses the distinction a founder actually needs:
 * "Vibe is not sure this is true" and "Vibe could not look" are different
 * sentences with different remedies.
 *
 * ## Why it is never coloured
 *
 * `not_found` is neutral, not a problem. An unassessable dimension is neutral,
 * not a failure. Colouring confidence would turn "Vibe could not tell" into
 * bad news about the customer's product, which is the inversion rule 44 exists
 * to prevent — so this renders as a `RatingChip`, which is deliberately the
 * one chip in the system that carries no status colour.
 */

export type FactConfidence = "confirmed" | "likely" | "unclear" | "not_found";
export type JudgmentConfidence = "high" | "medium" | "low";

export type ConfidenceViewModel =
  | { kind: "fact"; level: FactConfidence }
  | { kind: "judgment"; level: JudgmentConfidence }
  | { kind: "coverage"; scored: number; eligible: number };

const FACT_WORDS: Record<FactConfidence, string> = {
  confirmed: "Confirmed",
  likely: "Likely",
  unclear: "Unclear",
  not_found: "Not found",
};

const JUDGMENT_WORDS: Record<JudgmentConfidence, string> = {
  high: "High confidence",
  medium: "Medium confidence",
  low: "Low confidence",
};

export function confidenceWord(model: ConfidenceViewModel): string {
  switch (model.kind) {
    case "fact":
      return FACT_WORDS[model.level];
    case "judgment":
      return JUDGMENT_WORDS[model.level];
    case "coverage":
      return `Scored ${model.scored} of ${model.eligible} areas`;
  }
}

export function ConfidenceIndicator({
  model,
  className,
}: {
  model: ConfidenceViewModel;
  className?: string;
}) {
  return <RatingChip className={className}>{confidenceWord(model)}</RatingChip>;
}

/**
 * The sentence beside a score, including the one behind a missing one.
 *
 * A `null` score renders as an em dash everywhere in this product, and until
 * now the sentence explaining *why* — `insufficientCoverageReason`, which the
 * audit found computed and shown nowhere — had no renderer. A dash with no
 * reason is the product declining to answer a question it can answer.
 */
export function CoverageLine({
  scored,
  eligible,
  reason,
  className,
}: {
  scored: number;
  eligible: number;
  /** Why nothing could be scored. Rendered instead of the count when set. */
  reason?: string | null;
  className?: string;
}) {
  return (
    <p className={cn("text-fg-muted text-ui", className)}>
      {reason ?? confidenceWord({ kind: "coverage", scored, eligible })}
    </p>
  );
}
