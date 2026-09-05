import type { ReactNode } from "react";
import { StatusPill } from "@/components/ui/status-pill";
import { Surface } from "@/components/ui/surface";
import { cn } from "@/lib/utils/cn";
import { CitationCount, type EvidenceCitation } from "./evidence-drawer";
import { ConfidenceIndicator, type ConfidenceViewModel } from "./confidence";

/**
 * One thing Vibe found (UI Sourcing Spec §14, S15; audit E5/E7).
 *
 * ## What it normalises
 *
 * Four shapes carried one concept: a `BusinessBrainProblem`, an
 * `IntelligenceCrossCheck`, a repository capability and a live-site finding.
 * Each had its own card, and only one of them showed its evidence.
 *
 * ## The slot order is fixed, and it is the trust ladder
 *
 * L1 headline and severity → L2 explanation, why it matters, confidence and
 * the citation count → L3 the evidence drawer behind that count. A card that
 * put its evidence above its conclusion would be asking the founder to audit
 * Vibe's reasoning before hearing what Vibe thinks.
 *
 * ## What it must not do
 *
 * Carry two actions. The audit found a catalogue pattern offering confirm and
 * dismiss, and dismissal is exactly what this product does not have: a finding
 * is true until the evidence changes, and a founder cannot make it untrue by
 * closing it. One action, or none.
 */

export type FindingSeverity = "positive" | "attention" | "critical";
export type FindingVariant = "finding" | "contradiction" | "priority" | "strength";

const SEVERITY_TONE = {
  positive: "success",
  attention: "waiting",
  critical: "problem",
} as const;

const SEVERITY_WORD: Record<FindingSeverity, string> = {
  positive: "Working",
  attention: "Needs attention",
  critical: "In the way",
};

export function FindingCard({
  variant = "finding",
  rank,
  title,
  explanation,
  whyItMatters,
  /**
   * Which of the two paragraphs reads first.
   *
   * A finding leads with what it is. A *priority* leads with what it costs —
   * the audit's R11 asks the blocker stack for why-first, because a ranked
   * list is read for consequence and the diagnosis is the follow-up. Ordering
   * it here keeps both paragraphs in the slot they are named for, rather than
   * making call sites swap two props and mean the opposite of what they say.
   */
  lead = "explanation",
  severity = "attention",
  confidence,
  citations = [],
  withheldCount = 0,
  /** At most one. A finding is not a menu. */
  action,
  /** Where the finding came from, for a contradiction: "Your code · Your site". */
  sourceLabel,
  className,
}: {
  variant?: FindingVariant;
  /** The domain's own ordinal, when it has one. Never invented here. */
  rank?: number;
  title: string;
  explanation?: string | null;
  whyItMatters?: string | null;
  lead?: "explanation" | "why";
  severity?: FindingSeverity;
  confidence?: ConfidenceViewModel | null;
  citations?: EvidenceCitation[];
  withheldCount?: number;
  action?: ReactNode;
  sourceLabel?: string | null;
  className?: string;
}) {
  const showMeta =
    confidence != null || citations.length > 0 || withheldCount > 0 || sourceLabel != null;

  return (
    <Surface
      as="article"
      level="panel"
      padding="md"
      className={cn("flex flex-col gap-3", className)}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <h3 className="text-fg flex min-w-0 items-baseline gap-2.5 text-[0.9375rem] leading-snug font-semibold">
          {rank !== undefined && (
            <span className="text-fg-meta shrink-0 font-mono text-meta tabular-nums">
              {String(rank).padStart(2, "0")}
            </span>
          )}
          <span className="min-w-0">{title}</span>
        </h3>
        {/*
          `strength` carries no severity pill: a strength is not a state to
          triage, and giving it one would put every finding on the same
          "something to deal with" footing.
        */}
        {variant !== "strength" && (
          <StatusPill tone={SEVERITY_TONE[severity]}>{SEVERITY_WORD[severity]}</StatusPill>
        )}
      </div>

      {(() => {
        /* The prominent paragraph, then the quieter one. */
        const [first, second] =
          lead === "why" && whyItMatters ? [whyItMatters, explanation] : [explanation, whyItMatters];
        return (
          <>
            {first && (
              <p className="text-fg-prose max-w-[68ch] text-sm leading-relaxed">{first}</p>
            )}
            {second && (
              <p className="text-fg-secondary max-w-[68ch] text-sm leading-relaxed">{second}</p>
            )}
          </>
        );
      })()}

      {showMeta && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {confidence && <ConfidenceIndicator model={confidence} />}
          {sourceLabel && <span className="text-fg-meta text-ui">{sourceLabel}</span>}
          <CitationCount
            citations={citations}
            withheldCount={withheldCount}
            title={title}
            conclusion={whyItMatters ?? explanation}
            confidence={confidence}
          />
        </div>
      )}

      {action && <div className="flex flex-wrap items-center gap-3">{action}</div>}
    </Surface>
  );
}
