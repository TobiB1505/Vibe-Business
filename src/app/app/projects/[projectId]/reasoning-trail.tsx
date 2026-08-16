import { describeEvidenceId } from "@/modules/business-audit/evidence-labels";
import { LENS_LABELS, evidenceSource } from "@/modules/business-audit/map-view";
import type { BusinessConclusion } from "@/modules/business-audit/schema";
import { MonoLabel } from "@/components/ui/typography";
import { Well } from "@/components/ui/surface";

/**
 * How Vibe reached this (AUDIT UI-1 §25, §26, §63).
 *
 * ## What it is proving
 *
 * That the audit *synthesized* rather than listed. Eight scanner observations
 * arriving as eight findings is what the product used to do; the same eight
 * folding into one business problem is what it does now, and a founder has no
 * way to know that unless they can see it happen.
 *
 * So the shape is deliberately vertical and narrow: **many signals, one arrow,
 * one problem.** The compression is the content.
 *
 * ## Why it is not the default view
 *
 * §26: the resting state stays calm. This lives behind a disclosure on a
 * selected blocker, not as a permanent wall of evidence — which would be the
 * enumeration this whole layer exists to replace, only in a nicer typeface.
 *
 * ## One thing the mockup shows that the data does not carry
 *
 * 1b ends with "what Vibe did not say, and why" — the symptoms that were merged
 * into the root. Near-duplicate conclusions genuinely are dropped during
 * validation, but the dropped ones are not persisted, so there is nothing
 * truthful to render. The closing line states the property that *is* true:
 * nothing was discarded, and every signal is still cited.
 */

function SignalRow({ evidenceId }: { evidenceId: string }) {
  const described = describeEvidenceId(evidenceId);
  const source = evidenceSource(evidenceId);

  return (
    <li className="flex items-baseline gap-3">
      <span className="text-fg-meta w-[8.5rem] shrink-0 font-mono text-[0.625rem] tracking-[0.08em] uppercase">
        {source ?? described.source}
      </span>
      <span className="text-fg-secondary text-sm">{described.detail}</span>
    </li>
  );
}

export function ReasoningTrail({ conclusion }: { conclusion: BusinessConclusion }) {
  const signals = conclusion.evidenceIds;
  if (signals.length === 0) return null;

  const sources = new Set(signals.map((id) => evidenceSource(id) ?? "other"));

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-2">
        <MonoLabel>
          What Vibe saw · {signals.length} {signals.length === 1 ? "signal" : "signals"}
        </MonoLabel>
        <ul className="flex flex-col gap-1.5">
          {signals.map((id) => (
            <SignalRow key={id} evidenceId={id} />
          ))}
        </ul>
      </section>

      {/*
        The arrow is the argument. Everything above it is an observation;
        everything below it is a judgment, and the gap between them is what
        this section exists to make visible.
      */}
      <div aria-hidden="true" className="flex justify-center py-1">
        <span className="bg-line-4 h-6 w-px" />
      </div>

      <Well className="flex flex-col gap-3 p-5">
        <MonoLabel>
          One problem, not {signals.length} findings
        </MonoLabel>

        {/*
          The internal root problem, shown here and nowhere else. It is the
          audit's own sentence about what is actually wrong, written before any
          founder-facing prose existed — which is precisely why it belongs in
          the place that answers "how did you get here?".
        */}
        {conclusion.rootProblem !== "" && (
          <p className="text-fg max-w-[62ch] text-[0.9375rem] leading-relaxed">
            {conclusion.rootProblem}
          </p>
        )}

        {conclusion.whyItMatters && (
          <p className="text-fg-muted max-w-[62ch] text-sm">
            <span className="text-fg-secondary">Why it matters:</span> {conclusion.whyItMatters}
          </p>
        )}

        <div className="text-fg-meta flex flex-wrap items-center gap-2 font-mono text-[0.625rem] tracking-[0.08em] uppercase">
          {conclusion.lenses.map((lens) => (
            <span key={lens} className="border-line-2 rounded-sm border px-1.5 py-0.5">
              {LENS_LABELS[lens]}
            </span>
          ))}
          <span>
            {signals.length} signals · {sources.size} {sources.size === 1 ? "source" : "sources"}
          </span>
        </div>
      </Well>

      <p className="text-fg-meta max-w-[62ch] text-xs">
        Nothing was discarded. Every signal above is still stored, still cited, and still visible
        in the full breakdown.
      </p>
    </div>
  );
}
