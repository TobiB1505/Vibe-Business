import { Disclosure, FoundList, TechnicalDetails } from "@/components/ui/disclosure";
import { Notice } from "@/components/ui/states";
import { Surface } from "@/components/ui/surface";
import { MonoLabel } from "@/components/ui/typography";
import { formatTimestamp } from "@/lib/utils/format-datetime";
import {
  buildLiveProductHumanView,
  type FindingTone,
  type HumanFinding,
} from "@/modules/live-product-intelligence/human-view";
import type { LiveProductIntelligenceSnapshot } from "@/modules/live-product-intelligence/schema";

/**
 * The live product check (Sprint UI-3.5).
 *
 * This screen used to open with "Product surfaces", "Conversion" and "SEO
 * foundations" — three tables of raw scanner output. It was accurate and it
 * asked the customer to be their own analyst.
 *
 * It now reads: conclusion, why it matters, what Vibe found, and only then the
 * exact values. Nothing was deleted — `buildLiveProductHumanView` carries every
 * signal through to `TechnicalDetails`, including each raw signal id and its
 * boolean.
 */

const TONE_DOT: Record<FindingTone, string> = {
  good: "bg-mint",
  attention: "bg-amber",
  neutral: "bg-fg-meta",
};

/** The word beside the dot, so a state is never carried by colour alone. */
const TONE_WORD: Record<FindingTone, string> = {
  good: "Looks good",
  attention: "Needs attention",
  neutral: "Partly set up",
};

function Finding({ finding }: { finding: HumanFinding }) {
  return (
    <div className="border-line-1 flex flex-col gap-3 border-b py-5 first:pt-0 last:border-b-0 last:pb-0">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span aria-hidden className={`size-2 shrink-0 rounded-full ${TONE_DOT[finding.tone]}`} />
          <h4 className="text-fg text-[0.9375rem] font-semibold">{finding.title}</h4>
          <MonoLabel className="tracking-[0.14em]">{TONE_WORD[finding.tone]}</MonoLabel>
        </div>
        {finding.whyItMatters && (
          <p className="text-fg-prose max-w-[70ch] text-sm leading-relaxed">
            {finding.whyItMatters}
          </p>
        )}
      </div>

      {(finding.found.length > 0 || finding.missing.length > 0) && (
        <Disclosure label="What Vibe found">
          <FoundList found={finding.found} missing={finding.missing} label="Observed" />
        </Disclosure>
      )}
    </div>
  );
}

export function LiveIntelligenceSummary({
  snapshot,
  analyzedAt,
}: {
  snapshot: LiveProductIntelligenceSnapshot;
  analyzedAt: string;
}) {
  const view = buildLiveProductHumanView(snapshot);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        {/* Named as its own intelligence layer, so "what the code says" and
            "what a visitor can see" read as complementary rather than as two
            unrelated scanners (UI-3.6 §10). */}
        <MonoLabel>What Vibe sees when it visits your product</MonoLabel>
        <h3 className="text-fg text-title font-bold">{view.headline}</h3>
        <p className="text-fg-muted max-w-[70ch] text-sm">{view.subhead}</p>
      </div>

      {/* An unfinished check says so before its results are read, not after. */}
      {view.incompleteReason && (
        <Notice tone="waiting" label="This check did not finish">
          {view.incompleteReason}
        </Notice>
      )}

      <Surface level="panel" padding="lg" className="flex flex-col">
        {view.findings.map((finding) => (
          <Finding key={finding.id} finding={finding} />
        ))}
      </Surface>

      <div className="flex flex-col gap-3">
        <p className="text-fg-meta font-mono text-meta">
          Last checked {formatTimestamp(analyzedAt) ?? analyzedAt}
        </p>

        {view.pagesChecked.length > 0 && (
          <Disclosure label={`Pages Vibe checked (${view.pagesChecked.length})`}>
            <ul className="flex flex-wrap gap-x-4 gap-y-1">
              {view.pagesChecked.map((path) => (
                <li key={path} className="text-fg-muted [overflow-wrap:anywhere] font-mono text-xs">
                  {path}
                </li>
              ))}
            </ul>
          </Disclosure>
        )}

        {snapshot.warnings.length > 0 && (
          <Disclosure label={`Notes from this check (${snapshot.warnings.length})`}>
            <ul className="flex flex-col gap-1">
              {snapshot.warnings.map((warning) => (
                <li key={warning.code} className="text-fg-muted text-xs leading-relaxed">
                  {warning.message}
                </li>
              ))}
            </ul>
          </Disclosure>
        )}

        {/* Every raw signal the scanner produced, unchanged. */}
        <TechnicalDetails entries={view.technical} />
      </div>
    </div>
  );
}
