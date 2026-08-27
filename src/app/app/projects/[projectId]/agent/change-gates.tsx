import { preparedChangeAnchorId } from "@/components/layout/project-shell";
import { planMoveHref } from "@/modules/action-plans/source";
import type { PreparedChangeWorkspaceItem } from "@/modules/execution/workspace";
import { ChangeOrigin, MoveBacklink } from "../change-origin";
import { ChangeRationale } from "../change-rationale";
import { ValidationPanel } from "../validation-panel";
import { PreviewPanel } from "../preview-panel";
import { ReviewPanel } from "../review-panel";
import { ApprovalPanel } from "../approval-panel";
import { MergePanel } from "../merge-panel";
import { OutcomePanel } from "../outcome-panel";
import { BusinessImpactPanel } from "../business-impact-panel";

/**
 * The gates a prepared change passes, in the order they run (UI-19).
 *
 * ## What this replaced
 *
 * `prepared-changes-section.tsx`, which wrapped the same panels in a card that
 * restated what the stage rail above now says: a headline for where the change
 * stands, its branch identity, its file list, a "how this got here" disclosure.
 * One screen said all of it twice, which is the duplication this sprint has
 * been removing everywhere else.
 *
 * What the card carried that nothing else did are the **actions** — validate
 * again, start a preview, capture a comparison, approve, merge — so those moved
 * here rather than disappearing. A screen that shows a change and cannot act on
 * it is worse than the duplication was.
 *
 * ## The order is the gates
 *
 * A merge needs an approval, an approval needs a review, a review needs a
 * preview, a preview needs a validation. The order on screen is that order, and
 * there is no Deploy, Ship or Publish control after any of them — none of those
 * exist in this product.
 */
export function ChangeGates({
  projectId,
  change,
  planHref,
}: {
  projectId: string;
  change: PreparedChangeWorkspaceItem;
  planHref: string;
}) {
  return (
    <div
        data-testid="prepared-change"
        data-prepared-change-id={change.id}
        id={preparedChangeAnchorId(change.id)}
        /* Cleared of the sticky header when the plan deep-links here. */
        className="flex scroll-mt-24 flex-col gap-4"
      >
        {/*
          A live region, because this sentence is the one thing here that
          changes as the change advances — and a screen reader announces nothing
          when visible text is simply replaced. Polite: it is a status, not an
          interruption.
        */}
        <p role="status" className="text-fg text-sm font-medium">
          {change.progress.headline}
        </p>

        {/*
          What it is and why, before anything asks for authorization.
          The written rationale wins when there is one — two answers to the
          same question would stack, and the written one is stronger.
        */}
        <ChangeRationale rationale={change.rationale} />

        {!change.rationale && (
          <ChangeOrigin
            origin={change.origin}
            moveHref={
              change.opportunityId
                ? planMoveHref(planHref, change.opportunityId)
                : null
            }
          />
        )}

        {/*
          The way back, for a change whose rationale suppressed the origin
          block. Navigation rather than a second account of why the change
          exists — without it a deterministic change names its Move nowhere.
        */}
        {change.rationale && change.origin && change.opportunityId && (
          <MoveBacklink
            title={change.origin.title}
            href={planMoveHref(planHref, change.opportunityId)}
          />
        )}

        <details open={!change.progress.earlySettled} className="group space-y-3">
          <summary className="text-fg-muted hover:text-fg-prose cursor-pointer list-none text-xs">
            <span className="group-open:hidden">Checked, previewed, reviewed and approved</span>
            <span className="hidden group-open:inline">How this change got here</span>
          </summary>

          <ValidationPanel
          projectId={projectId}
          preparedChangeId={change.id}
          summary={change.validation}
          runningOperation={null}
          approved={change.progress.approved}
          merged={change.progress.merged}
        />

        {/* Below validation: a preview restores what a validation
            produced, so the order on screen is the order of the gates. */}
        <PreviewPanel
          projectId={projectId}
          preparedChangeId={change.id}
          card={change.preview}
          validatedArtifactId={change.validatedArtifactId}
          serverOrigin={change.previewOrigin}
          approved={change.progress.approved}
          merged={change.progress.merged}
        />

        {/* Below preview, because a comparison photographs a running one. */}
        <ReviewPanel
          projectId={projectId}
          preparedChangeId={change.id}
          card={change.review}
          images={change.reviewImages}
          previewSessionId={change.previewSessionId}
          previewOrigin={change.previewOrigin}
          branchUrl={change.branchUrl}
          commitSha={change.commitSha}
          filesChanged={change.filePaths.length}
          approved={change.progress.approved}
          merged={change.progress.merged}
        />

        {/* Below the evidence, because approval is a human decision about
            it rather than another measurement of it. */}
        <ApprovalPanel
          projectId={projectId}
          preparedChangeId={change.id}
          card={change.approval}
          reviewArtifactId={change.review.reviewArtifactId}
          merged={change.progress.merged}
        />

        </details>

        {/*
          How it was built, one click away rather than presented first.
          Every path is still there, still exact, still copyable: checkability
          is the point of this product, and a founder who wants to know
          precisely which files moved must always be able to find out. The
          merge stage lists them too, but only once a change reaches it — this
          is the record available at every stage.
        */}
        <details className="group border-line-2 space-y-2 border-t pt-3">
          <summary className="text-fg-muted hover:text-fg-prose cursor-pointer list-none text-xs">
            <span className="group-open:hidden">
              How this was built — {change.filePaths.length} file
              {change.filePaths.length === 1 ? "" : "s"} changed
            </span>
            <span className="hidden group-open:inline">How this was built</span>
          </summary>

          <div className="rounded-well border-line-2 bg-well space-y-1 border p-3">
            <p className="text-fg-muted font-mono text-xs">
              {change.branchName}
              {" · "}
              {change.commitSha
                ? `${change.commitSha.slice(0, 7)} on ${change.baseBranch}`
                : change.baseBranch}
            </p>

            {/* Paths only. File contents live on the branch, never in our rows. */}
            <ul className="space-y-0.5">
              {change.filePaths.map((path) => (
                <li key={path} className="text-fg-meta font-mono text-xs">
                  {path}
                </li>
              ))}
            </ul>
          </div>
        </details>

        {/* Last, and only reachable through everything above it: a merge
            needs an approval, an approval needs a review, a review needs a
            preview, a preview needs a validation. */}
        <MergePanel
          projectId={projectId}
          preparedChangeId={change.id}
          card={change.merge}
        />

        {/* Only reachable through a merge: an outcome exists once a default
            branch actually moved, and the business question is weaker than
            the one above it. */}
        <OutcomePanel
          projectId={projectId}
          preparedChangeId={change.id}
          card={change.outcome}
          businessImpactLabel={change.businessImpact.ladderLabel}
        />
        <BusinessImpactPanel
          projectId={projectId}
          preparedChangeId={change.id}
          card={change.businessImpact}
        />
      </div>
  );
}
