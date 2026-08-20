import type { BusinessConclusion } from "@/modules/business-audit/schema";
import { MonoLabel } from "@/components/ui/typography";
import { ReasoningTrail } from "./reasoning-trail";

/**
 * The problem behind the selected area (AUDIT UI-1 §25; AUDIT UI-1.2 §13, §16).
 *
 * ## Why this exists at all
 *
 * The right column was cut down to rank, area and headline, which is the right
 * density for scanning but would have thrown away the two things the audit is
 * actually judged on: the full explanation, and *how Vibe got there*. Those did
 * not disappear — they moved here, to the one place on the page with the width
 * to carry them.
 *
 *   right column   what matters      one line each
 *   → here         why it matters    the whole argument
 *
 * ## Scoped to a selection, never to the page
 *
 * Three reasoning trails open at once is the evidence wall this layer exists to
 * replace. One trail, for the area the founder chose, is an explanation.
 */
export function SelectedProblem({
  blocker,
  rank,
}: {
  blocker: BusinessConclusion;
  /** The audit's own ordering, not this component's. */
  rank: number;
}) {
  return (
    <section
      className="border-line-1 flex flex-col gap-4 border-t pt-6"
      data-testid="selected-problem"
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <MonoLabel as="h4" className="text-mint">
          Priority #{rank}
        </MonoLabel>
        <span className="text-fg-meta font-mono text-[0.625rem] tracking-[0.08em] uppercase">
          this area is part of it
        </span>
      </div>

      <div className="grid gap-6 md:grid-cols-[minmax(0,1.35fr)_minmax(15rem,1fr)]">
        <div className="flex flex-col gap-3">
          <h5 className="text-fg text-lg leading-snug font-semibold tracking-[-0.02em]">
            {blocker.headline}
          </h5>
          {/* The full text, unclamped — the right column only showed a taste. */}
          <p className="text-fg-prose max-w-[62ch] text-[0.9375rem] leading-relaxed">
            {blocker.explanation}
          </p>
        </div>

        {blocker.whyItMatters && (
          <div className="flex flex-col gap-2">
            <MonoLabel as="h5">Why it matters</MonoLabel>
            <p className="text-fg-secondary text-sm leading-relaxed">{blocker.whyItMatters}</p>
          </div>
        )}
      </div>

      {/*
        A disclosure, not a section (§26 of UI-1): the resting state stays calm.
        A founder who accepts the judgment never has to read the derivation; one
        who doubts it can see every signal that produced it.
      */}
      {blocker.evidenceIds.length > 0 && (
        <details className="group" data-testid="reasoning-trail">
          <summary className="text-fg-muted hover:text-fg-body marker:content-none flex cursor-pointer items-center gap-2 text-sm">
            <span className="text-fg-meta transition-transform group-open:rotate-90">›</span>
            How Vibe reached this
            <span className="text-fg-meta font-mono text-meta">
              {blocker.evidenceIds.length}{" "}
              {blocker.evidenceIds.length === 1 ? "signal" : "signals"}
            </span>
          </summary>
          <div className="mt-4">
            <ReasoningTrail conclusion={blocker} />
          </div>
        </details>
      )}
    </section>
  );
}
