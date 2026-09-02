import { MonoLabel } from "@/components/ui/typography";
import type { PreparedChangeWorkspaceItem } from "@/modules/execution/workspace";
import { ApprovalPanel } from "../approval-panel";
import { BusinessImpactPanel } from "../business-impact-panel";
import { DiscardPanel } from "../discard-panel";
import { MergePanel } from "../merge-panel";
import { OutcomePanel } from "../outcome-panel";
import { PreviewPanel } from "../preview-panel";
import { ReviewPanel } from "../review-panel";

/**
 * Real preview and comparison actions, inside the stage that explains them.
 *
 * The domain panels remain the canonical owners of confirmation, polling and
 * server actions. This wrapper only gives them the new workspace composition,
 * so the production flow cannot drift into a second set of lookalike buttons.
 */
export function AgentPreviewActions({
  projectId,
  change,
}: {
  projectId: string;
  change: PreparedChangeWorkspaceItem;
}) {
  return (
    <section
      className="rounded-panel border-line-3 bg-surface-3 flex min-w-0 flex-col gap-5 border p-5"
      aria-labelledby="agent-preview-actions-title"
      data-testid="agent-preview-actions"
    >
      <div className="flex flex-col gap-1.5">
        <MonoLabel as="h4" id="agent-preview-actions-title" className="text-mint">
          Preview controls
        </MonoLabel>
        <p className="text-fg-muted text-sm leading-relaxed">
          {/* No comparison to capture any more (ADR 0065): the preview itself is
              what a visual approval binds to. */}
          Start the isolated preview and look at the change running.
        </p>
      </div>

      <div className="border-line-2 flex flex-col gap-5 border-t pt-5">
        <PreviewPanel
          projectId={projectId}
          preparedChangeId={change.id}
          card={change.preview}
          serverOrigin={change.previewOrigin}
          productionUrl={change.productionUrl}
          approved={change.progress.approved}
          merged={change.progress.merged}
          presentation="workspace"
        />

        {/* History only (ADR 0065). Nothing captures a comparison any more; a
            change that has one from before still shows what an approval rested
            on. */}
        {change.review.state !== "not_generated" && (
        <div className="border-line-2 border-t pt-5">
          <ReviewPanel
            projectId={projectId}
            preparedChangeId={change.id}
            card={change.review}
            images={change.reviewImages}
            previewOrigin={change.previewOrigin}
            branchUrl={change.branchUrl}
            commitSha={change.commitSha}
            filesChanged={change.filePaths.length}
            approved={change.progress.approved}
            merged={change.progress.merged}
            presentation="workspace"
          />
        </div>
        )}
      </div>
    </section>
  );
}

/**
 * Human approval and safe merge, presented as the final Agent decision.
 *
 * Approval and merge deliberately stay separate: the first records immutable
 * human intent; the second re-reads GitHub and may still refuse. Both actions
 * are the existing canonical controls, now seated in the stage-five surface.
 */
export function AgentReviewDecision({
  projectId,
  change,
}: {
  projectId: string;
  change: PreparedChangeWorkspaceItem;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="agent-review-decision">
      <section
        className="rounded-panel border-mint-line bg-mint-tint/25 grid min-w-0 gap-6 border p-5 sm:p-6 lg:grid-cols-2"
        aria-labelledby="agent-review-decision-title"
      >
        <div className="flex min-w-0 flex-col gap-3">
          <MonoLabel as="h4" id="agent-review-decision-title" className="text-mint">
            Your decision
          </MonoLabel>
          <ApprovalPanel
            projectId={projectId}
            preparedChangeId={change.id}
            card={change.approval}
            merged={change.progress.merged}
            presentation="workspace"
          />

          {/* The third answer. Approve and merge move the change forward; this
              is how a founder says no, and without it the only ways out of an
              unwanted change were to approve it or to abandon the Move. */}
          <div className="border-line-2 border-t pt-4">
            <DiscardPanel
              projectId={projectId}
              preparedChangeId={change.id}
              approved={change.progress.approved}
              merged={change.progress.merged}
            />
          </div>
        </div>

        <div className="border-line-2 min-w-0 border-t pt-5 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6">
          <MergePanel
            projectId={projectId}
            preparedChangeId={change.id}
            card={change.merge}
            classification={change.reviewClassification}
            filesChanged={change.filePaths.length}
            presentation="workspace"
          />
        </div>
      </section>

      {(change.progress.merged || change.outcome.state !== "unavailable") && (
        <details className="rounded-well border-line-2 bg-well group border px-4 py-3">
          <summary className="text-fg-secondary hover:text-fg-body cursor-pointer list-none text-sm font-medium">
            <span className="group-open:hidden">After the merge</span>
            <span className="hidden group-open:inline">Hide post-merge record</span>
          </summary>
          <div className="border-line-2 mt-4 flex flex-col gap-5 border-t pt-4">
            <OutcomePanel
              projectId={projectId}
              preparedChangeId={change.id}
              card={change.outcome}
              businessImpactLabel={change.businessImpact.ladderLabel}
              presentation="workspace"
            />
            <BusinessImpactPanel
              projectId={projectId}
              preparedChangeId={change.id}
              card={change.businessImpact}
              presentation="workspace"
            />
          </div>
        </details>
      )}
    </div>
  );
}
