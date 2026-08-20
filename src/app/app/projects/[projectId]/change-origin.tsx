import type { ChangeOrigin as ChangeOriginData } from "@/modules/execution/change-origin";

/**
 * What a change was asked to do, when nothing can say what it did (UI-5 dogfood).
 *
 * ## Why this is a separate component from `ChangeRationale`
 *
 * Because it is a weaker claim, and the difference has to be structural rather
 * than remembered. A rationale is hand-written, per capability, and holds for
 * every change that capability ever produces. This is the request one specific
 * change came from: written by a model, before the change existed, describing
 * a problem rather than a result.
 *
 * Putting it under "What Vibe changed" would be the exact collapse the
 * rationale module exists to prevent — a statement about intent, dressed as a
 * statement about outcome. So the heading names the claim: what this change was
 * *for*.
 *
 * ## When it renders
 *
 * Only when there is no capability rationale. Both would be two answers to the
 * same question stacked on top of each other, and the written one is stronger.
 *
 * In practice that means agent-produced changes, which is where the gap was
 * found: `agentic_execution_v1` is the capability of every change an agent
 * writes, so `businessRationaleFor` returns null for all of them and the card
 * used to open with a status line and then a branch name.
 *
 * ## The last line
 *
 * Unconditional, for the same reason `rationale.limitations` is: without it
 * this paragraph reads as a finding. It is a request that was made, and it is
 * not evidence that the request was met — the panels below are what say
 * whether anything was checked, approved or merged.
 */
export function ChangeOrigin({ origin }: { origin: ChangeOriginData | null }) {
  if (!origin) return null;

  return (
    <section className="space-y-3 border-t border-line-2 pt-4">
      <div className="space-y-1">
        <h4 className="text-sm font-medium text-fg-body">What this change was for</h4>
        <p className="text-sm text-fg-prose">{origin.title}</p>
      </div>

      <div className="space-y-1">
        <p className="text-sm text-fg-prose">{origin.problem}</p>
        <p className="text-sm text-fg-secondary">{origin.whyNow}</p>
      </div>

      {/* Never conditional: the sentence that keeps the paragraphs above from
          reading as a description of what the change achieved. */}
      <p className="text-xs text-fg-muted">
        This is the next move Vibe was asked to work on, written before the change existed. It does
        not describe what the change did.
      </p>
    </section>
  );
}
