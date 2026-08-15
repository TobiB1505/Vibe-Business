import { describeEvidenceId } from "@/modules/business-audit/evidence-labels";
import type {
  BusinessReadinessAudit,
  DimensionAssessment,
} from "@/modules/business-audit/schema";
import { formatTimestamp } from "@/lib/utils/format-datetime";

/**
 * Business Readiness Audit display (Sprint 4 §30).
 *
 * Functional, not a redesign. The two things it must never do:
 *
 *  - **Imply certainty it does not have.** An unscored dimension shows
 *    "Not enough evidence", never a zero, and the headline shows coverage
 *    beside the score so a 3-of-5 audit cannot read as complete.
 *  - **Show what it should not.** No prompt text, no token counts, no
 *    model reasoning. Evidence ids sit behind a "Why?" disclosure so a
 *    finding can be traced without cluttering the page.
 *
 * Every string here originates from an AI response about untrusted
 * customer content. React escapes it; nothing is rendered as markup.
 */

function scoreColour(score: number): string {
  if (score >= 70) return "text-emerald-400";
  if (score >= 40) return "text-amber-400";
  return "text-red-400";
}

function EvidenceDisclosure({ evidenceIds }: { evidenceIds: string[] }) {
  if (evidenceIds.length === 0) return null;

  return (
    <details className="mt-1">
      <summary className="cursor-pointer text-xs text-zinc-500 hover:text-zinc-400">Why?</summary>
      <ul className="mt-1 space-y-0.5 pl-3">
        {evidenceIds.map((id) => {
          // Resolved to the product's own language (Sprint 6 §12). The id stays
          // available on hover for support, but is not the thing on screen.
          const { source, detail } = describeEvidenceId(id);
          return (
            <li key={id} className="text-xs text-zinc-500" title={id}>
              <span className="text-zinc-400">{source}:</span> {detail}
            </li>
          );
        })}
      </ul>
    </details>
  );
}

function PointList({ title, items, tone }: { title: string; items: string[]; tone: string }) {
  if (items.length === 0) return null;

  return (
    <div className="space-y-0.5">
      <p className="text-xs text-zinc-500">{title}</p>
      <ul className="space-y-0.5 pl-3">
        {items.map((item) => (
          <li key={item} className={`text-xs ${tone}`}>
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
    <li className="space-y-1.5 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm text-zinc-200">{dimension.label}</span>
        <span className="flex items-baseline gap-2">
          {unscored ? (
            <span className="text-sm text-zinc-500">Not enough evidence</span>
          ) : (
            <>
              <span className={`text-sm font-medium ${scoreColour(dimension.score!)}`}>
                {dimension.score}
              </span>
              <span className="text-xs text-zinc-600">{dimension.confidence} confidence</span>
            </>
          )}
        </span>
      </div>

      <p className="text-xs text-zinc-400">{dimension.summary}</p>

      <PointList title="Strengths" items={dimension.strengths} tone="text-emerald-400/80" />
      <PointList title="Gaps" items={dimension.gaps} tone="text-amber-400/80" />
      <PointList title="Unknowns" items={dimension.unknowns} tone="text-zinc-500" />

      <EvidenceDisclosure evidenceIds={dimension.evidenceIds} />
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

  return (
    <div className="space-y-5 rounded-md border border-zinc-800 p-4">
      <div className="space-y-0.5">
        <h2 className="text-sm font-medium text-zinc-200">Business readiness</h2>
        <p className="text-xs text-zinc-500">Analyzed {formatTimestamp(analyzedAt) ?? analyzedAt}</p>
      </div>

      <div className="space-y-1">
        {overall.score === null ? (
          <>
            <p className="text-2xl font-semibold tracking-tight text-zinc-400">—</p>
            <p className="text-xs text-zinc-500">{overall.insufficientCoverageReason}</p>
          </>
        ) : (
          <p className="text-2xl font-semibold tracking-tight text-zinc-100">
            {overall.score} <span className="text-base font-normal text-zinc-500">/ 100</span>
          </p>
        )}
        <p className="text-xs text-zinc-500">
          Evidence coverage: {overall.assessedDimensions} of {overall.totalDimensions} dimensions
        </p>
      </div>

      <section className="space-y-1">
        <h3 className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Dimensions</h3>
        <ul className="divide-y divide-zinc-900">
          {audit.dimensions.map((dimension) => (
            <DimensionRow key={dimension.id} dimension={dimension} />
          ))}
        </ul>
      </section>

      {audit.keyFindings.length > 0 && (
        <section className="space-y-1">
          <h3 className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Key findings</h3>
          <ul className="space-y-2">
            {audit.keyFindings.map((finding) => (
              <li key={finding.finding} className="text-sm text-zinc-300">
                {finding.finding}
                <EvidenceDisclosure evidenceIds={finding.evidenceIds} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {audit.limitations.length > 0 && (
        <section className="space-y-1">
          <h3 className="text-xs font-medium tracking-wide text-zinc-500 uppercase">
            What this audit could not assess
          </h3>
          <ul className="space-y-0.5 pl-3">
            {audit.limitations.map((limitation) => (
              <li key={limitation} className="text-xs text-zinc-500">
                {limitation}
              </li>
            ))}
          </ul>
        </section>
      )}

      {audit.validationNotes.length > 0 && (
        <section className="space-y-1">
          <h3 className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Notes</h3>
          <ul className="space-y-0.5 pl-3">
            {audit.validationNotes.map((note) => (
              <li key={note} className="text-xs text-zinc-500">
                {note}
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="text-xs text-zinc-600">
        Diagnostic only — this describes the current state and does not propose changes.
      </p>
    </div>
  );
}
