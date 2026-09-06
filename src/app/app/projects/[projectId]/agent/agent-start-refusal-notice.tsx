import Link from "next/link";
import { Notice } from "@/components/ui/states";
import type { AgentStartRefusalDetail } from "@/modules/coding-agent/start-refusal";
import {
  startRefusalLabel,
  startRefusalRecovery,
} from "@/modules/coding-agent/view";

/**
 * Why a run the founder asked for did not start.
 *
 * ## Why this is its own component
 *
 * `AgentStartAction` binds a server action to a real project, so it cannot be
 * mounted in the fixture harness — which is exactly where the refusal states
 * have to be provable, because a refusal nobody can render is how this defect
 * survived in the first place. The notice is presentational and takes a plain
 * value, so the browser suite can put every refusal on screen.
 *
 * ## What it may say
 *
 * Only what `startRefusalLabel` returns, and that reads from closed enums
 * alone. No provider prose, no model output, no internal identifier — §5 of the
 * execution contract, and the reason `execution-contract/view.ts` exists.
 *
 * The recovery link is a `Link`, never a form: Vibe never re-reads a founder's
 * code on their behalf (Rule 60). The scan itself is free — what the link
 * protects is authorship, not a budget. Where it leads is the route's business,
 * handed in as `repositoryReadHref`.
 */
export function AgentStartRefusalNotice({
  detail,
  repositoryReadHref,
}: {
  detail: AgentStartRefusalDetail;
  /** Where a fresh read of the founder's code is started, by them. */
  repositoryReadHref: string;
}) {
  const recovery = startRefusalRecovery(detail);

  // The testid sits on a wrapper rather than on `Notice`: `Notice` renders a
  // `Surface` with an explicit prop list and forwards nothing else, so an
  // attribute handed to it type-checks and then never reaches the DOM.
  return (
    <div data-testid="agent-start-refusal">
      <Notice
        tone="problem"
        label="couldn't start"
        action={
          recovery ? (
            <Link
              href={repositoryReadHref}
              className="text-fg-prose hover:text-fg rounded-sm text-sm underline underline-offset-4 transition-interactive"
            >
              {recovery.label}
            </Link>
          ) : undefined
        }
        footnote={recovery?.note}
      >
        {startRefusalLabel(detail)}
      </Notice>
    </div>
  );
}
