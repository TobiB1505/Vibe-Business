import { buildBusinessMap } from "@/modules/business-audit/map-view";
import type { BusinessReadinessAudit } from "@/modules/business-audit/schema";
import { formatTimestamp } from "@/lib/utils/format-datetime";
import { MonoLabel } from "@/components/ui/typography";
import { AuditIntelligence } from "./business-brain/audit-intelligence";

/**
 * The completed audit (AUDIT UI-1, direction 1b; density pass AUDIT UI-1.2).
 *
 * ## The reading order is the design
 *
 *   What Vibe thinks          the answer, in one sentence
 *   → Map + current priorities what the business looks like, and what matters
 *   → The selected area        why, at full width
 *   → What's already working   the ground the founder is standing on
 *
 * The map is deliberately **not** the hero. 1b works because the conclusion
 * lands first and the visualization explains it — reversed, a founder has to
 * derive the answer from a diagram, which is a puzzle rather than a judgment.
 *
 * ## What UI-1.2 removed, and why removing was the fix
 *
 * Three things said the same thing on one screen: full blocker explanations in
 * the right column, a "Where I'd start" card repeating blocker #1 one screen
 * later, and a collapsed technical breakdown of the five legacy dimensions that
 * the nine lenses replaced. The dimensions are still measured and still stored;
 * they are simply no longer a second, competing verdict in the customer's face.
 * The lenses are the business-judgment layer, and a page that offers two
 * answers has not made one.
 */

function Conclusion({ audit }: { audit: BusinessReadinessAudit }) {
  const overall = audit.synthesis?.overall ?? "";
  if (overall === "") return null;

  return (
    <section className="flex flex-col gap-4" data-testid="audit-hero">
      <MonoLabel as="h2">What Vibe thinks</MonoLabel>
      {/*
        §3 — still the first and largest thing on the page, but a sentence
        rather than a billboard. At the old size a three-line conclusion pushed
        the map below the fold on a 1280 laptop, which cost the reader the very
        connection this layout exists to make.
      */}
      <p className="text-fg max-w-[46ch] text-[1.75rem] leading-[1.25] font-semibold tracking-[-0.03em] text-balance sm:text-[2rem] lg:text-[2.125rem]">
        {overall}
      </p>
    </section>
  );
}

function Strengths({ audit }: { audit: BusinessReadinessAudit }) {
  const strengths = audit.synthesis?.strengths ?? [];
  if (strengths.length === 0) return null;

  return (
    <section className="flex flex-col gap-3.5" data-testid="audit-working">
      <div className="flex items-center gap-3">
        <MonoLabel as="h3" className="text-fg-secondary whitespace-nowrap">
          What&rsquo;s already working
        </MonoLabel>
        <span aria-hidden="true" className="bg-line-2 h-px flex-1" />
      </div>

      {/*
        A row below the panel, not a column beside it (§9, §10).
        Strengths are the ground a founder is standing on, not the work — they
        should reassure at a glance and never compete with the priorities for
        the narrow measure. Two lines of supporting text each, and no more.
      */}
      <ul className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
        {strengths.map((strength) => (
          <li key={strength.headline} className="flex gap-2.5">
            <span aria-hidden="true" className="text-mint mt-px shrink-0 text-sm">
              ✓
            </span>
            <span className="flex min-w-0 flex-col gap-1">
              <span className="text-fg-body text-sm leading-snug font-medium">
                {strength.headline}
              </span>
              <span className="text-fg-muted line-clamp-2 text-ui leading-relaxed">
                {strength.explanation}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function AuditOverview({
  audit,
  generatedAt,
  movesHref,
  hasMoves,
  movesByConclusion,
  usedSignedInEvidence = false,
}: {
  audit: BusinessReadinessAudit;
  generatedAt: string | null;
  movesHref: string;
  hasMoves: boolean;
  /** Moves addressing each conclusion of this audit (UI-S2 §8). */
  movesByConclusion: Record<string, number>;
  /**
   * A Deep Scan informed this audit (UI-7 §4).
   *
   * Provenance, in the provenance line. It used to be a permanent status row
   * above the verdict saying "Ready" — which had no action, never changed, and
   * occupied the one place a paused question needs.
   */
  usedSignedInEvidence?: boolean;
}) {
  const synthesis = audit.synthesis ?? null;
  const map = synthesis ? buildBusinessMap(synthesis) : null;
  const score = audit.overall.score;

  return (
    <div className="flex flex-col gap-9 lg:gap-10">
      <header className="flex flex-col gap-5 pt-2">
        <Conclusion audit={audit} />

        {/*
          The score stays visible and stays small. The product's value is
          knowing what matters next, not receiving a number, and a large number
          at the top would answer a question nobody asked.
        */}
        <div className="text-fg-meta flex flex-wrap items-center gap-x-2.5 gap-y-1 font-mono text-meta tracking-[0.04em]">
          {/*
            The score moved into the map's centre, so repeating it here would
            be the same number twice. It stays in this line only when there is
            no map to hold it — a pre-lens audit.
          */}
          {score !== null && !map && <span>{score} / 100 readiness</span>}
          {map && (
            <>
              <span>{map.assessedCount} lenses</span>
              <span aria-hidden="true">·</span>
              <span>{map.signalCount} signals</span>
            </>
          )}
          {!map && (
            <>
              {score !== null && <span aria-hidden="true">·</span>}
              <span>
                {audit.overall.assessedDimensions} of {audit.overall.totalDimensions} areas scored
              </span>
            </>
          )}
          {usedSignedInEvidence && (
            <>
              <span aria-hidden="true">·</span>
              <span>saw your signed-in product</span>
            </>
          )}
          {generatedAt && (
            <>
              <span aria-hidden="true">·</span>
              <span>{formatTimestamp(generatedAt) ?? generatedAt}</span>
            </>
          )}
        </div>
      </header>

      {map && synthesis ? (
        <AuditIntelligence
          map={map}
          score={score}
          blockers={synthesis.blockers}
          movesHref={movesHref}
          hasMoves={hasMoves}
          movesByConclusion={movesByConclusion}
        />
      ) : (
        // An audit from before the lens framework. Its conclusion is real and
        // still shown above; it simply has no areas to map (§47).
        <p className="text-fg-muted max-w-[62ch] text-sm">
          This audit was produced before Vibe reasoned in business areas, so there is no map for
          it.
        </p>
      )}

      <Strengths audit={audit} />
    </div>
  );
}
