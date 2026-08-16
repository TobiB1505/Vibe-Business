import Link from "next/link";
import {
  buildBusinessMap,
  type BusinessMap as BusinessMapModel,
} from "@/modules/business-audit/map-view";
import type { BusinessReadinessAudit } from "@/modules/business-audit/schema";
import { formatTimestamp } from "@/lib/utils/format-datetime";
import { buttonClasses } from "@/components/ui/button";
import { MonoLabel } from "@/components/ui/typography";
import { Surface } from "@/components/ui/surface";
import { AuditBlockers } from "./audit-blockers";
import { AuditIntelligence } from "./audit-intelligence";
import { BusinessAuditSummary } from "./business-audit-summary";

/**
 * The completed audit (AUDIT UI-1, direction 1b).
 *
 * ## The reading order is the design
 *
 *   What Vibe thinks          the answer, in one sentence
 *   → Business map + blockers what the business looks like, and what to fix
 *   → Where I'd start         the single next thing
 *   → How Vibe reached this   inside each blocker, one click down
 *   → Technical breakdown     the five scored dimensions, collapsed
 *
 * The map is deliberately **not** the hero. 1b works because the conclusion
 * lands first and the visualization explains it — reversed, a founder has to
 * derive the answer from a diagram, which is a puzzle rather than a judgment.
 *
 * ## What moved
 *
 * The five scored dimensions used to be the audit. They are now a disclosure at
 * the bottom labelled as the technical record. Nothing was deleted: the scores,
 * the per-dimension findings and the evidence are all still rendered by
 * `BusinessAuditSummary`, one click below the intelligence that replaced them.
 */

function Conclusion({ audit }: { audit: BusinessReadinessAudit }) {
  const overall = audit.synthesis?.overall ?? "";
  if (overall === "") return null;

  return (
    <section className="flex flex-col gap-4" data-testid="audit-hero">
      <MonoLabel as="h2">What Vibe thinks</MonoLabel>
      <p className="text-fg max-w-[38ch] text-[2rem] leading-[1.2] font-semibold tracking-[-0.035em] text-balance sm:text-[2.25rem] lg:text-[2.5rem]">
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
      <ul className="flex flex-col gap-3.5">
        {strengths.map((strength) => (
          <li key={strength.headline} className="flex gap-3">
            <span aria-hidden="true" className="bg-fg-body mt-2 size-1.5 shrink-0 rounded-full" />
            <span className="flex min-w-0 flex-col gap-1.5">
              <span className="text-fg text-[0.9375rem] leading-snug font-semibold">
                {strength.headline}
              </span>
              <span className="text-fg-muted text-[0.8125rem] leading-relaxed">
                {strength.explanation}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Where I'd start (§39, §40).
 *
 * The audit's job ends at "this is what matters"; recommending the work is
 * Next Moves' job, and merging the two would collapse a boundary the product
 * depends on. So this names the top blocker and hands off.
 */
function WhereIdStart({
  audit,
  movesHref,
  hasMoves,
}: {
  audit: BusinessReadinessAudit;
  movesHref: string;
  hasMoves: boolean;
}) {
  const first = audit.synthesis?.blockers[0];
  if (!first) return null;

  return (
    <Surface
      level="section"
      tone="mint"
      padding="md"
      className="flex flex-col gap-3.5"
      data-testid="audit-start"
    >
      <MonoLabel as="h3" className="text-mint">
        Where I&rsquo;d start
      </MonoLabel>
      <p className="text-fg text-lg leading-snug font-semibold tracking-[-0.02em]">
        {first.headline}
      </p>
      {first.whyItMatters && (
        <p className="text-fg-prose text-sm leading-relaxed">{first.whyItMatters}</p>
      )}

      {/*
        The link only appears when there is something behind it. A CTA that
        leads to an empty screen is a promise the audit did not keep, and the
        honest sentence is shorter than the excuse would be.
      */}
      {hasMoves ? (
        <div>
          <Link
            href={movesHref}
            className={buttonClasses({ variant: "primary", size: "sm" })}
          >
            See what Vibe would do first
          </Link>
        </div>
      ) : (
        <p className="text-fg-meta text-sm">
          Vibe hasn&rsquo;t worked out the next moves for this project yet.
        </p>
      )}
    </Surface>
  );
}

function AuditInterpretation({
  audit,
  map,
  movesHref,
  hasMoves,
}: {
  audit: BusinessReadinessAudit;
  map: BusinessMapModel;
  movesHref: string;
  hasMoves: boolean;
}) {
  const synthesis = audit.synthesis;
  if (!synthesis) return null;

  return (
    <div className="contents xl:flex xl:flex-col xl:gap-6">
      {synthesis.strengths.length > 0 && (
        <div className="order-3 xl:order-1">
          <Strengths audit={audit} />
        </div>
      )}
      <div className="order-1 xl:order-2">
        <AuditBlockers blockers={synthesis.blockers} map={map} />
      </div>
      {synthesis.blockers.length > 0 && (
        <div className="order-4">
          <WhereIdStart audit={audit} movesHref={movesHref} hasMoves={hasMoves} />
        </div>
      )}
    </div>
  );
}

export function AuditOverview({
  audit,
  generatedAt,
  movesHref,
  hasMoves,
}: {
  audit: BusinessReadinessAudit;
  generatedAt: string | null;
  movesHref: string;
  hasMoves: boolean;
}) {
  const synthesis = audit.synthesis ?? null;
  const map = synthesis ? buildBusinessMap(synthesis) : null;
  const score = audit.overall.score;

  return (
    <div className="flex flex-col gap-10 lg:gap-12">
      <header className="flex flex-col gap-6 pt-2">
        <Conclusion audit={audit} />

        {/*
          §9 — the score stays visible and stays small. The product's value is
          knowing what matters next, not receiving a number, and a large number
          at the top would answer a question nobody asked.
        */}
        <div className="text-fg-meta flex flex-wrap items-center gap-x-2.5 gap-y-1 font-mono text-[0.6875rem] tracking-[0.04em]">
          {score !== null && <span>{score} / 100 readiness</span>}
          {map && (
            <>
              {score !== null && <span aria-hidden="true">·</span>}
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
          {generatedAt && (
            <>
              <span aria-hidden="true">·</span>
              <span>{formatTimestamp(generatedAt) ?? generatedAt}</span>
            </>
          )}
        </div>
      </header>

      {map && synthesis ? (
        <AuditIntelligence map={map}>
          <AuditInterpretation
            audit={audit}
            map={map}
            movesHref={movesHref}
            hasMoves={hasMoves}
          />
        </AuditIntelligence>
      ) : (
        // An audit from before the lens framework. Its findings are real and
        // still shown; it simply has no map to draw (§47).
        <p className="text-fg-muted max-w-[62ch] text-sm">
          This audit was produced before Vibe reasoned in business areas, so there is no map for
          it. Its findings are in the breakdown below.
        </p>
      )}

      <details className="border-line-1 group border-t pt-5" data-testid="audit-technical-breakdown">
        <summary className="text-fg-muted hover:text-fg-body marker:content-none flex cursor-pointer items-center gap-2 text-sm">
          <span className="text-fg-meta transition-transform group-open:rotate-90">›</span>
          Technical breakdown
          <span className="text-fg-meta font-mono text-[0.6875rem]">
            {audit.dimensions.length} measured areas
          </span>
        </summary>
        <div className="mt-5">
          <BusinessAuditSummary audit={audit} analyzedAt={generatedAt ?? audit.generatedAt} />
        </div>
      </details>
    </div>
  );
}
