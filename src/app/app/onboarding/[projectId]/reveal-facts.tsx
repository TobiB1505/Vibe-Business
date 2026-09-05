import { CitationCount } from "@/components/system/evidence-drawer";
import { describeEvidenceId } from "@/modules/business-audit/evidence-labels";
import type { UnderstandingFact } from "@/modules/product-understanding/view";

/**
 * The two facts the product reveal puts under "Did Vibe get this right?".
 *
 * ## Why they carry confidence
 *
 * The screen asks a founder to confirm what Vibe understood, and it used to
 * show a label and a value — so the question was being asked about a claim
 * with no indication whether Vibe was confident or had inferred it from one
 * meta description. That makes an honest answer harder than it needs to be:
 * "roughly right" and "wrong" are different corrections, and which one applies
 * depends on how much Vibe was claiming in the first place.
 *
 * The confidence sentence and the evidence ids are already on
 * `UnderstandingFact`. Nothing new is derived here; the reveal simply did not
 * read them.
 *
 * ## Why this is a component and not markup on the page
 *
 * So a browser can render it. It lived inline in the onboarding route, which
 * needs a session, a project and a profile to reach — and consequently the one
 * screen in the product that asks the founder to check Vibe's work had no
 * browser coverage at all.
 */
export function ProductRevealFacts({ facts }: { facts: readonly UnderstandingFact[] }) {
  return (
    <div
      className="grid w-full max-w-[54rem] gap-3 text-left sm:grid-cols-2"
      data-testid="product-reveal-facts"
    >
      {facts.map((fact) => (
        <div
          key={fact.label}
          className="border-line-2 bg-surface-2 flex flex-col gap-1 rounded-xl border p-4"
        >
          <p className="text-fg-meta text-xs">{fact.label}</p>
          <p className="text-fg-body text-sm">{fact.value}</p>
          <p className="text-fg-muted text-ui">{fact.note}</p>
          <CitationCount
            citations={fact.evidence.map((id) => {
              const described = describeEvidenceId(id);
              return {
                detail: described.detail,
                source: described.source,
                certainty: described.certainty,
              };
            })}
            title={fact.label}
            conclusion={fact.value}
          />
        </div>
      ))}
    </div>
  );
}
