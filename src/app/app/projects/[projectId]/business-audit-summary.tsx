import { describeEvidenceId } from "@/modules/business-audit/evidence-labels";
import {
  DIMENSION_LABELS,
  DIMENSION_QUESTIONS,
  type BusinessReadinessAudit,
  type DimensionAssessment,
} from "@/modules/business-audit/schema";
import { formatTimestamp } from "@/lib/utils/format-datetime";
import { ScoreMeter } from "@/components/ui/score-meter";
import { StatusPill } from "@/components/ui/status-pill";
import { Surface, Well } from "@/components/ui/surface";
import { MonoLabel } from "@/components/ui/typography";
import { TechnicalDetails } from "@/components/ui/disclosure";

/**
 * Business Readiness Audit display (Sprint 4 §30, migrated to the design
 * system in UI-1).
 *
 * The two things it must never do are unchanged, and are the reason the
 * markup here is careful rather than decorative:
 *
 *  - **Imply certainty it does not have.** An unscored dimension shows
 *    "Not enough evidence", never a zero, and the headline shows coverage
 *    beside the score so a 3-of-5 audit cannot read as complete. The meter
 *    enforces the same rule in pixels: `ScoreMeter` renders `null` as an empty
 *    track and `n/a`, never a bar of length zero.
 *  - **Show what it should not.** No prompt text, no token counts, no
 *    model reasoning. Evidence ids sit behind a "Why?" disclosure so a
 *    finding can be traced without cluttering the page.
 *
 * Every string here originates from an AI response about untrusted
 * customer content. React escapes it; nothing is rendered as markup.
 */

function EvidenceDisclosure({ evidenceIds }: { evidenceIds: string[] }) {
  if (evidenceIds.length === 0) return null;

  return (
    <details className="mt-2">
      <summary className="text-fg-meta hover:text-fg-muted cursor-pointer rounded-sm text-xs transition-colors">
        Why?
      </summary>
      <ul className="mt-2 space-y-1 pl-3">
        {evidenceIds.map((id) => {
          // Resolved to the product's own language (Sprint 6 §12). The id stays
          // available on hover for support, but is not the thing on screen.
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
 * Strengths, gaps and unknowns. Each tone is a claim about evidence, so it maps
 * onto the status palette rather than onto "nice/not nice": a gap is amber
 * because it is something to attend to, and an unknown stays neutral because
 * missing evidence is not a bad result.
 */
function PointList({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone: "strength" | "gap" | "unknown";
}) {
  if (items.length === 0) return null;

  const markerClass =
    tone === "strength" ? "bg-mint" : tone === "gap" ? "bg-amber" : "bg-fg-meta";

  return (
    <div className="flex flex-col gap-1.5">
      <MonoLabel className="tracking-[0.14em]">{title}</MonoLabel>
      <ul className="flex flex-col gap-1.5">
        {items.map((item) => (
          <li key={item} className="text-fg-prose flex gap-2.5 text-xs leading-relaxed">
            {/* Decorative: the group already carries its meaning in the label
                above, so the colour is never the only signal. */}
            <span aria-hidden className={`mt-1.5 size-1 shrink-0 rounded-full ${markerClass}`} />
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function DimensionRow({ dimension }: { dimension: DimensionAssessment }) {
  const unscored = dimension.score === null;

  return (
    <li className="border-line-1 flex flex-col gap-3 border-b py-5 last:border-b-0 last:pb-0">
      {/* The question the dimension answers, not its category name. The
          technical label stays available in the details below. */}
      <ScoreMeter
        label={DIMENSION_QUESTIONS[dimension.id] ?? dimension.label}
        value={dimension.score}
        // The domain's own word for how much evidence stood behind the score.
        confidence={unscored ? "none" : dimension.confidence}
        unscoredText="n/a"
      />

      {/* Spelled out, not only implied by the empty track — the meter is a
          summary and this is the sentence a person can act on. */}
      {unscored && <p className="text-fg-muted text-xs">Not enough evidence</p>}

      <p className="text-fg-prose text-caption">{dimension.summary}</p>

      {(dimension.strengths.length > 0 ||
        dimension.gaps.length > 0 ||
        dimension.unknowns.length > 0) && (
        <div className="grid gap-4 sm:grid-cols-3">
          <PointList title="Strengths" items={dimension.strengths} tone="strength" />
          <PointList title="Gaps" items={dimension.gaps} tone="gap" />
          <PointList title="Unknowns" items={dimension.unknowns} tone="unknown" />
        </div>
      )}

      <EvidenceDisclosure evidenceIds={dimension.evidenceIds} />

      {/* The dimension's own name, for anyone who wants to line this up with
          the stored audit or with `PRODUCT.md`. */}
      <TechnicalDetails
        entries={[
          { key: "dimension", value: dimension.id },
          { key: "label", value: DIMENSION_LABELS[dimension.id] ?? dimension.label },
          { key: "score", value: dimension.score },
          { key: "confidence", value: dimension.confidence },
        ]}
      />
    </li>
  );
}

export function BusinessAuditSummary({
  audit,
  analyzedAt,
}: {
  audit: BusinessReadinessAudit;
  analyzedAt: string;
}) {
  const { overall } = audit;
  const fullCoverage = overall.assessedDimensions === overall.totalDimensions;

  return (
    <div className="flex flex-col gap-5">
      <Surface level="panel" padding="lg" className="flex flex-col gap-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-2">
            <MonoLabel>Business readiness</MonoLabel>
            {overall.score === null ? (
              <>
                {/* No overall score is a statement about coverage, not a bad
                    result. An em dash rather than a number, and the domain's
                    own reason underneath it. */}
                <p className="text-fg-secondary font-mono text-4xl font-bold">—</p>
                <p className="text-fg-muted max-w-[60ch] text-xs">
                  {overall.insufficientCoverageReason}
                </p>
              </>
            ) : (
              <p className="text-fg flex items-baseline gap-2 font-mono text-4xl font-bold tabular-nums">
                {overall.score}
                <span className="text-fg-muted text-base font-normal">/ 100</span>
              </p>
            )}
          </div>

          <div className="flex flex-col items-start gap-2 sm:items-end">
            {/* Coverage is a status, and a partial audit says so in words as
                well as colour — a 3-of-5 audit must not read as complete. */}
            <StatusPill tone={fullCoverage ? "success" : "waiting"}>
              {overall.assessedDimensions} of {overall.totalDimensions} dimensions
            </StatusPill>
            <span className="text-fg-meta font-mono text-[0.6875rem]">
              Analyzed {formatTimestamp(analyzedAt) ?? analyzedAt}
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <MonoLabel>Dimensions</MonoLabel>
          <ul className="flex flex-col">
            {audit.dimensions.map((dimension) => (
              <DimensionRow key={dimension.id} dimension={dimension} />
            ))}
          </ul>
        </div>
      </Surface>

      {audit.keyFindings.length > 0 && (
        <Surface level="section" padding="lg" className="flex flex-col gap-3">
          <MonoLabel>Key findings</MonoLabel>
          <ul className="flex flex-col gap-3">
            {audit.keyFindings.map((finding) => (
              <li key={finding.finding} className="text-fg-prose text-sm leading-relaxed">
                {finding.finding}
                <EvidenceDisclosure evidenceIds={finding.evidenceIds} />
              </li>
            ))}
          </ul>
        </Surface>
      )}

      {(audit.limitations.length > 0 || audit.validationNotes.length > 0) && (
        <div className="grid gap-4 lg:grid-cols-2">
          {audit.limitations.length > 0 && (
            <Well className="flex flex-col gap-2">
              <MonoLabel>What this audit could not assess</MonoLabel>
              <ul className="flex flex-col gap-1.5">
                {audit.limitations.map((limitation) => (
                  <li key={limitation} className="text-fg-muted text-xs leading-relaxed">
                    {limitation}
                  </li>
                ))}
              </ul>
            </Well>
          )}

          {audit.validationNotes.length > 0 && (
            <Well className="flex flex-col gap-2">
              <MonoLabel>Notes</MonoLabel>
              <ul className="flex flex-col gap-1.5">
                {audit.validationNotes.map((note) => (
                  <li key={note} className="text-fg-muted text-xs leading-relaxed">
                    {note}
                  </li>
                ))}
              </ul>
            </Well>
          )}
        </div>
      )}

      <p className="text-fg-meta text-xs">
        Diagnostic only — this describes the current state and does not propose changes.
      </p>
    </div>
  );
}
