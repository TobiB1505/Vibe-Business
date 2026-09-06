import Link from "next/link";
import { Notice } from "@/components/ui/states";
import { EXECUTION_REASON_LABELS } from "@/modules/execution-contract/view";
import { startRefusalRecovery } from "@/modules/coding-agent/view";

/**
 * "Vibe's read of your code is older than this check" — said where it blocks.
 *
 * ## Why this state needed a component of its own
 *
 * `repository_analysis_outdated` never reaches `AgentStartRefusalNotice`,
 * because that notice renders *inside* `AgentStartAction` — after a refused
 * click. This refusal happens earlier than any button: the step does not
 * resolve agentic, so `agenticStep` is null, so no start control renders, so
 * `AgentReadyStage` draws an empty call-to-action block under a hero still
 * saying Vibe understands the founder's code. A stale read is the one refusal
 * that could produce a screen which is both silent and wrong.
 *
 * ## Where the words come from
 *
 * The sentence is `EXECUTION_REASON_LABELS`, and the note is
 * `startRefusalRecovery` — the same two sources the post-click notice reads, so
 * the two paths cannot drift into saying different things about one state.
 *
 * ## Why a link and not a button
 *
 * Vibe never re-reads a founder's code on its own (Rule 60). The scan is free,
 * so what the link protects is authorship rather than a budget — and the
 * footnote says both, because "you have to do this" without "it costs nothing"
 * reads like a bill.
 */
export function AgentStaleReadNotice({ productHref }: { productHref: string }) {
  // Asked rather than hardcoded: if the recovery ever stops covering this
  // reason, this screen goes quiet with it instead of promising a way forward
  // the rest of the product has withdrawn.
  const recovery = startRefusalRecovery({
    reason: "not_agentic",
    resolutionReason: "repository_analysis_outdated",
  });

  return (
    <div data-testid="agent-stale-read" className="w-full">
      <Notice
        tone="waiting"
        label="code read out of date"
        action={
          recovery ? (
            <Link
              href={productHref}
              className="text-fg-prose hover:text-fg rounded-sm text-sm underline underline-offset-4 transition-interactive"
              data-testid="agent-stale-read-scan"
            >
              Scan my product
            </Link>
          ) : undefined
        }
        footnote={
          recovery ? `${recovery.note} It is free, and nothing else starts with it.` : undefined
        }
      >
        {EXECUTION_REASON_LABELS.repository_analysis_outdated}
      </Notice>
    </div>
  );
}
