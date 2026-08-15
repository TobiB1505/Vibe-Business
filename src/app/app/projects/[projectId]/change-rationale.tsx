import type { BusinessRationale } from "@/modules/execution/business-rationale";

/**
 * What Vibe changed, and why it should matter (Sprint 12C Cleanup §8, §11).
 *
 * ## Why this exists at all
 *
 * Because the post-change experience used to end at a measurement panel that,
 * for every project in existence, said *Measurement source required*. That is
 * true and useless: it explains a gap in Vibe's setup at exactly the moment a
 * user wants to know what happened to their product.
 *
 * The honest thing to lead with is what is actually known — Vibe changed these
 * things, for this reason, and here is what was verified afterwards. Measured
 * business impact joins that later, if it ever can.
 *
 * ## The claim level, and how it is kept
 *
 * This is the **weakest** statement in the product. It is written before
 * anything runs, from what the capability deterministically emits, and it is
 * held to the same causal-language checker as measured results
 * (`business-rationale.test.ts`). It says what a change is *for*, never what it
 * achieved — and a section that said otherwise would be a measurement nobody
 * took.
 *
 * The limitation is rendered every time and is not conditional. A rationale
 * without its limitation is a promise.
 */
export function ChangeRationale({ rationale }: { rationale: BusinessRationale | null }) {
  // No written rationale for this capability. Rendering a generic sentence
  // would be true of any change and therefore informative about none.
  if (!rationale) return null;

  return (
    <section className="space-y-3 border-t border-zinc-800 pt-4">
      <div className="space-y-1">
        <h4 className="text-sm font-medium text-zinc-200">What Vibe changed</h4>
        <p className="text-sm text-zinc-300">{rationale.changeSummary}</p>
      </div>

      <div className="space-y-1">
        <h4 className="text-sm font-medium text-zinc-200">Why this matters</h4>
        <p className="text-sm text-zinc-300">{rationale.whyItMatters}</p>
      </div>

      {/* Never conditional, never collapsed behind a toggle: the sentence that
          stops the paragraph above from reading as a promise about traffic. */}
      <p className="text-xs text-zinc-500">{rationale.limitations}</p>
    </section>
  );
}
