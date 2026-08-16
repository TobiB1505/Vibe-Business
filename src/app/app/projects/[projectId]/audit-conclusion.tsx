import Link from "next/link";
import { describeEvidenceId } from "@/modules/business-audit/evidence-labels";
import {
  buildHumanAuditView,
  type AuditHighlightGroup,
  type AuditHighlightSection,
} from "@/modules/business-audit/human-view";
import type { BusinessConclusion } from "@/modules/business-audit/schema";
import type { BusinessReadinessAudit } from "@/modules/business-audit/schema";
import { formatTimestamp } from "@/lib/utils/format-datetime";
import { StatusPill } from "@/components/ui/status-pill";
import { Surface, Well } from "@/components/ui/surface";
import { MonoLabel } from "@/components/ui/typography";
import { BusinessAuditSummary } from "./business-audit-summary";

/**
 * The human-first audit result (CORE-2 §14, §15).
 *
 * Reading order is the whole design, and it is the opposite of what came
 * before: **answer first, evidence second, tech last.**
 *
 *   What Vibe thinks about the business
 *   → What's already working
 *   → What's holding you back
 *   → Why it matters
 *   → Where I'd start
 *
 * The score is still on the page and still true; it is just no longer the
 * first thing a founder meets. `BusinessAuditSummary` still renders the full
 * dimension breakdown, one disclosure down.
 *
 * Every string here originates from an AI response about untrusted customer
 * content. React escapes it; nothing is rendered as markup.
 */

function EvidenceDisclosure({ evidenceIds }: { evidenceIds: string[] }) {
  if (evidenceIds.length === 0) return null;

  return (
    <details className="mt-1.5">
      <summary className="text-fg-meta hover:text-fg-muted cursor-pointer rounded-sm text-xs transition-colors">
        Why?
      </summary>
      <ul className="mt-1.5 space-y-1 pl-3">
        {evidenceIds.map((id) => {
          const { source, detail } = describeEvidenceId(id);
          return (
            <li key={id} className="text-fg-muted text-xs" title={id}>
              <span className="text-fg-secondary font-mono">{source}:</span> {detail}
            </li>
          );
        })}
      </ul>
    </details>
  );
}

/**
 * One dimension's findings, under one heading.
 *
 * The heading is what the previous version got wrong: it captioned *every*
 * bullet with its dimension's question, so four consecutive findings each
 * repeated "Do people understand what you built?". Said once, it orients; said
 * four times, it is noise that buries the finding it was meant to frame.
 */
function HighlightGroup({
  group,
  tone,
}: {
  group: AuditHighlightGroup;
  tone: "strength" | "gap";
}) {
  const markerClass = tone === "strength" ? "bg-mint" : "bg-amber";

  return (
    <div className="flex flex-col gap-2">
      <h4 className="text-fg-secondary text-sm font-medium">{group.question}</h4>
      <ul className="flex flex-col gap-2.5">
        {group.items.map((item, index) => (
          <li
            key={`${group.dimension}-${index}`}
            data-testid="audit-finding"
            className="flex gap-2.5"
          >
            {/* Decorative only: the heading above carries the meaning, so
                colour is never the sole signal. */}
            <span aria-hidden className={`mt-2 size-1.5 shrink-0 rounded-full ${markerClass}`} />
            <div className="min-w-0">
              <p className="text-fg-prose text-sm leading-relaxed">{item.text}</p>
              <EvidenceDisclosure evidenceIds={item.evidenceIds} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * A whole section: the few groups worth reading, then the rest one click away.
 *
 * Nothing is dropped. `secondary` holds every remaining group, and the
 * per-dimension breakdown further down the page holds every finding regardless
 * — so the cap is about what a founder meets first, never about what Vibe will
 * show them.
 */
function HighlightSection({
  section,
  tone,
  moreLabel,
}: {
  section: AuditHighlightSection;
  tone: "strength" | "gap";
  moreLabel: string;
}) {
  const shown = section.primary.reduce((sum, group) => sum + group.items.length, 0);
  const remaining = section.totalItems - shown;

  return (
    <div className="flex flex-col gap-5">
      {/* Marked so a test can assert on what is actually met first: a collapsed
          <details> still renders its children into the DOM, so an unscoped
          query counts the hidden groups too. */}
      <div data-testid="audit-primary" className="flex flex-col gap-5">
        {section.primary.map((group) => (
          <HighlightGroup key={group.dimension} group={group} tone={tone} />
        ))}
      </div>

      {remaining > 0 && (
        <details>
          <summary className="text-fg-muted hover:text-fg-prose cursor-pointer rounded-sm text-sm transition-colors">
            {moreLabel} ({remaining})
          </summary>
          <div className="mt-4 flex flex-col gap-5">
            {section.secondary.map((group) => (
              <HighlightGroup key={`${group.dimension}-more`} group={group} tone={tone} />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

/**
 * One synthesized business conclusion (CORE-2a.1 §41).
 *
 * Rendered directly, with no further compression: these are already few because
 * the model chose few, and re-truncating a synthesis would put the product back
 * where CORE-2a.1 started — deciding in React what should have been decided in
 * the judgment.
 *
 * The headline carries the weight, so it is the largest text in the section.
 * Everything under it is support.
 */
function ConclusionCard({
  conclusion,
  tone,
}: {
  conclusion: BusinessConclusion;
  tone: "strength" | "gap";
}) {
  const markerClass = tone === "strength" ? "bg-mint" : "bg-amber";

  return (
    <li data-testid="audit-conclusion" className="flex gap-3">
      {/* Decorative: the section heading carries the meaning, so colour is
          never the sole signal. */}
      <span aria-hidden className={`mt-2 size-1.5 shrink-0 rounded-full ${markerClass}`} />
      <div className="flex min-w-0 flex-col gap-1.5">
        <p className="text-fg text-[0.9375rem] leading-snug font-medium text-balance">
          {conclusion.headline}
        </p>
        <p className="text-fg-prose max-w-[62ch] text-sm leading-relaxed">
          {conclusion.explanation}
        </p>
        {conclusion.whyItMatters && (
          <p className="text-fg-muted max-w-[62ch] text-sm leading-relaxed">
            {conclusion.whyItMatters}
          </p>
        )}
        <EvidenceDisclosure evidenceIds={conclusion.evidenceIds} />
      </div>
    </li>
  );
}

export function AuditConclusion({
  audit,
  analyzedAt,
  movesHref,
  hasMoves,
}: {
  audit: BusinessReadinessAudit;
  analyzedAt: string;
  movesHref: string;
  /** Whether the Opportunity Engine has produced moves yet (CORE-2 §18). */
  hasMoves: boolean;
}) {
  const view = buildHumanAuditView(audit);
  const fullCoverage = view.assessedDimensions === view.totalDimensions;

  return (
    <div className="flex flex-col gap-5">
      <Surface level="panel" padding="lg" className="flex flex-col gap-4">
        <h2 className="text-fg text-xl font-semibold">What Vibe thinks about the business</h2>
        <p className="text-fg-prose max-w-[65ch] text-base leading-relaxed">{view.conclusion}</p>

        {/* Secondary by placement and by size — present, never the headline. */}
        <div className="flex flex-wrap items-center gap-3">
          <StatusPill tone={fullCoverage ? "success" : "waiting"}>
            {view.assessedDimensions} of {view.totalDimensions} areas assessed
          </StatusPill>
          {view.score !== null && (
            <span className="text-fg-muted font-mono text-xs tabular-nums">
              Readiness score {view.score}/100
            </span>
          )}
          <span className="text-fg-meta font-mono text-[0.6875rem]">
            {formatTimestamp(analyzedAt) ?? analyzedAt}
          </span>
        </div>

        {view.score === null && view.insufficientCoverageReason && (
          <p className="text-fg-muted max-w-[60ch] text-xs">{view.insufficientCoverageReason}</p>
        )}
      </Surface>

      {view.mode === "synthesis" && view.synthesis !== null ? (
        <>
          {view.synthesis.strengths.length > 0 && (
            <Surface
              level="section"
              padding="lg"
              className="flex flex-col gap-4"
              data-testid="audit-working"
            >
              <h3 className="text-fg text-base font-semibold">What&rsquo;s already working</h3>
              <ul className="flex flex-col gap-5">
                {view.synthesis.strengths.map((conclusion) => (
                  <ConclusionCard key={conclusion.headline} conclusion={conclusion} tone="strength" />
                ))}
              </ul>
            </Surface>
          )}

          {view.synthesis.blockers.length > 0 && (
            <Surface
              level="section"
              padding="lg"
              className="flex flex-col gap-4"
              data-testid="audit-blockers"
            >
              <h3 className="text-fg text-base font-semibold">What&rsquo;s holding you back</h3>
              <ul className="flex flex-col gap-5">
                {view.synthesis.blockers.map((conclusion) => (
                  <ConclusionCard key={conclusion.headline} conclusion={conclusion} tone="gap" />
                ))}
              </ul>
            </Surface>
          )}
        </>
      ) : (
        <>
          {view.working.totalItems > 0 && (
            <Surface
              level="section"
              padding="lg"
              className="flex flex-col gap-3"
              data-testid="audit-working"
            >
              <h3 className="text-fg text-base font-semibold">What&rsquo;s already working</h3>
              <HighlightSection
                section={view.working}
                tone="strength"
                moreLabel="Show everything else that's working"
              />
            </Surface>
          )}

          {view.blockers.totalItems > 0 && (
            <Surface
              level="section"
              padding="lg"
              className="flex flex-col gap-3"
              data-testid="audit-blockers"
            >
              <h3 className="text-fg text-base font-semibold">What&rsquo;s holding you back</h3>
              <HighlightSection section={view.blockers} tone="gap" moreLabel="Show the rest" />
            </Surface>
          )}
        </>
      )}

      {view.whyItMatters.length > 0 && (
        <Surface level="section" padding="lg" className="flex flex-col gap-3">
          <h3 className="text-fg text-base font-semibold">Why it matters</h3>
          <ul className="flex flex-col gap-3">
            {view.whyItMatters.map((finding) => (
              <li key={finding.finding} className="text-fg-prose text-sm leading-relaxed">
                {finding.finding}
                <EvidenceDisclosure evidenceIds={finding.evidenceIds} />
              </li>
            ))}
          </ul>
        </Surface>
      )}

      {/*
        CORE-2 §18: the actual moves come from the Opportunity Engine, so this
        section links to them rather than inventing its own. When none exist
        yet it says so plainly instead of showing an empty promise.
      */}
      <Surface level="section" padding="lg" className="flex flex-col gap-3">
        <h3 className="text-fg text-base font-semibold">Where I&rsquo;d start</h3>
        {hasMoves ? (
          <>
            <p className="text-fg-prose max-w-[65ch] text-sm leading-relaxed">
              Vibe has picked the things worth doing first, in order.
            </p>
            <Link
              href={movesHref}
              className="text-mint w-fit text-sm underline underline-offset-4 hover:no-underline"
            >
              See what Vibe would do first
            </Link>
          </>
        ) : (
          <p className="text-fg-muted max-w-[65ch] text-sm leading-relaxed">
            Vibe hasn&rsquo;t worked out the next moves for this project yet.
          </p>
        )}
      </Surface>

      {/*
        Tech last, and owned by this component rather than by the route.
        "Answer first, evidence second, tech last" is a property of the audit
        screen, so the screen holds all three — a route that assembled the
        order itself could reorder it without any test noticing.
      */}
      <details>
        <summary className="text-fg-muted hover:text-fg-prose cursor-pointer rounded-sm text-sm transition-colors">
          See the full breakdown by dimension
        </summary>
        <div className="mt-4">
          <BusinessAuditSummary audit={audit} analyzedAt={analyzedAt} />
        </div>
      </details>

      {(view.blindSpots.unansweredQuestions.length > 0 ||
        view.blindSpots.limitations.length > 0) && (
        /* `Well` takes only children and a className, so the test hook lives
           on a wrapper rather than widening a shared primitive for one caller. */
        <div data-testid="audit-blind-spots">
          <Well className="flex flex-col gap-2">
          {/*
            Its own section with its own heading, deliberately kept away from
            "what's holding you back". Missing evidence is a limit on the
            analysis, never a finding about the product (CLAUDE.md rule 44).
          */}
          <MonoLabel>What Vibe couldn&rsquo;t see</MonoLabel>
          <ul className="flex flex-col gap-1.5">
            {view.blindSpots.unansweredQuestions.map((question) => (
              <li key={question} className="text-fg-muted text-xs leading-relaxed">
                {question}
              </li>
            ))}
            {view.blindSpots.limitations.map((limitation) => (
              <li key={limitation} className="text-fg-muted text-xs leading-relaxed">
                {limitation}
              </li>
            ))}
            </ul>
          </Well>
        </div>
      )}
    </div>
  );
}
