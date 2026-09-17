import Link from "next/link";
import { ArrowRightIcon } from "@/components/ui/icons.generated";
import { NovaAside } from "@/components/nova/nova-thread";
import { NOVA_ACTION_META } from "@/modules/nova/actions";
import { isNovaActionId } from "@/modules/nova/threads/schema";
import type { ArtifactRef } from "@/modules/nova/artifacts";
import { artifactOpen } from "@/features/workspace/host/artifact-open";
import { threadArtifactHref } from "@/features/workspace/registry/artifacts";
import { projectPath } from "@/lib/routing/project-urls";
import { cn } from "@/lib/utils/cn";

/**
 * The two turns that are not words.
 *
 * Nova explains and the workspace shows, so a turn that *points* at something
 * draws the pointer and never the thing — a business map inline in a transcript
 * is the second copy of a screen the pane is there to be.
 *
 * Before this, both drew nothing at all: `ThreadScreen` returned null for any
 * turn with no text, which is right for an event whose run has gone and wrong
 * for a pointer that is the whole content of its row.
 */

/**
 * *"Here is the thing I meant."*
 *
 * The chip opens the artifact **in the pane beside this conversation** rather
 * than at its own address, because the founder is reading a sentence about it
 * and the sentence is the context. `Open in full` is one press further, in the
 * pane's own header — two destinations, in the order a reader wants them.
 */
export function ArtifactChip({
  projectId,
  threadId,
  artifact,
}: {
  projectId: string;
  threadId: string;
  artifact: ArtifactRef;
}) {
  const { label } = artifactOpen(projectId, artifact);

  return (
    <Link
      href={threadArtifactHref(projectId, threadId, artifact)}
      data-testid="thread-artifact-chip"
      className={cn(
        "border-line-2 bg-surface-2 text-fg-body rounded-control inline-flex w-fit items-center",
        "gap-2 border px-3 py-2 text-body font-medium transition-interactive",
        "hover:border-mint-line hover:text-fg",
        "focus-visible:ring-mint focus-visible:ring-2 focus-visible:outline-none",
      )}
    >
      {label}
      <ArrowRightIcon size={14} aria-hidden className="text-fg-meta shrink-0" />
    </Link>
  );
}

/**
 * *"I offered you this."*
 *
 * A record of an offer, in the quiet register, and deliberately **not** the
 * control itself. [ADR 0109](../../../../docs/decisions/0109-nova-first-application-shell.md)
 * §5: generated text is never the last thing before a consequential effect, a
 * press is — and the press belongs on the surface that holds the action's
 * arguments, its price and its confirmation. A button rendered from a stored
 * proposal would be a second copy of a priced control, built from a row rather
 * than from the thing it acts on, and it would still be there a week after the
 * change it was about had merged.
 *
 * So the line names the offer, and the link goes to the ranking — which offers
 * whatever is genuinely waiting *now*, or does not.
 */
export function ProposalLine({ projectId, actionId }: { projectId: string; actionId: string }) {
  // An id from a row, checked against the catalogue that is the only thing that
  // knows. One that no longer exists draws nothing rather than a blank offer.
  if (!isNovaActionId(actionId)) return null;

  const meta = NOVA_ACTION_META[actionId];

  return (
    <NovaAside>
      I offered you <strong className="font-semibold">{meta.label}</strong>.{" "}
      <Link
        href={projectPath(projectId)}
        className="text-mint rounded-inline font-medium underline-offset-2 hover:underline focus-visible:ring-mint focus-visible:ring-2 focus-visible:outline-none"
      >
        It is on your product&rsquo;s home
      </Link>{" "}
      when it is still the thing to do.
    </NovaAside>
  );
}
