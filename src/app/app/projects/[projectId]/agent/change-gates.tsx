import { preparedChangeAnchorId } from "@/components/layout/project-shell";
import { planMoveHref } from "@/modules/action-plans/source";
import type { AgentStage } from "@/modules/coding-agent/observability/agent-stages";
import type { PreparedChangeWorkspaceItem } from "@/modules/execution/workspace";
import { ChangeDiffSection } from "../change-diff-section";
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
 * `prepared-changes-section.tsx`, which wrapped these panels in a card that
 * restated what the stage rail above now says: where the change stands, its
 * branch identity, its file list. One screen said all of it twice.
 *
 * What that card uniquely carried are the **actions** — validate again, start a
 * preview, capture a comparison, approve, merge — so they moved here rather
 * than disappearing. A screen that shows a change and cannot act on it is worse
 * than the duplication was.
 *
 * ## One decision at a time
 *
 * `stage` narrows the controls to the one the run is actually on, so a founder
 * is offered the decision that is theirs to make rather than five panels of
 * which four are history. The settled ones stay reachable behind the
 * disclosure, because checkability is the point of this product.
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
  stage = null,
  chrome = true,
}: {
  projectId: string;
  change: PreparedChangeWorkspaceItem;
  planHref: string;
  /**
   * Which stage's controls to render.
   *
   * `null` renders every gate, which is what the scenario harness needs: each
   * fixture is one gate in one state, and gating them by stage there would test
   * the harness rather than the panels.
   */
  stage?: AgentStage | null;
  /**
   * Whether to draw the change's own header — its status sentence, its origin
   * and the built-from record.
   *
   * Off inside a stage that already says those things. The preview stage names
   * the change and shows what moved; the review stage names the branch, the
   * commit and every file. Repeating the status sentence under either of them
   * is the duplication this sprint keeps removing, and the founder ends up
   * scrolling past their own answer to reach the button.
   */
  chrome?: boolean;
}) {
  const show = (which: AgentStage) => stage === null || stage === which;

  /*
   * One question asked once for this change (ADR 0063).
   *
   * Read here rather than in each panel for the reason `ChangeProgress` exists
   * at all: a decision spelled out in three places is three places that can
   * come to disagree, and this one decides whether a founder is shown a
   * preview or told there is nothing to look at.
   */
  const codeOnly = change.reviewClassification?.classification === "code";

  return (
    <div
      data-testid="prepared-change"
      data-prepared-change-id={change.id}
      id={preparedChangeAnchorId(change.id)}
      /* Cleared of the sticky header when the plan deep-links here. */
      className="flex scroll-mt-24 flex-col gap-4"
    >
      {chrome && (
        <>
      {/*
        A live region, because this sentence is the one thing here that changes
        as the change advances — and a screen reader announces nothing when
        visible text is simply replaced. Polite: it is a status, not an
        interruption.
      */}
      <p role="status" className="text-fg text-sm font-medium">
        {change.progress.headline}
      </p>

      {/*
        What it is and why, before anything asks for authorization. The written
        rationale wins when there is one — two answers to the same question
        would stack, and the written one is stronger.
      */}
      <ChangeRationale rationale={change.rationale} />

      {!change.rationale && (
        <ChangeOrigin
          origin={change.origin}
          moveHref={change.opportunityId ? planMoveHref(planHref, change.opportunityId) : null}
        />
      )}

      {/*
        The way back, for a change whose rationale suppressed the origin block.
        Navigation rather than a second account of why the change exists —
        without it a deterministic change names its Move nowhere.
      */}
      {change.rationale && change.origin && change.opportunityId && (
        <MoveBacklink
          title={change.origin.title}
          href={planMoveHref(planHref, change.opportunityId)}
        />
      )}

        </>
      )}

      {/*
        What actually changed, and which review it deserves (ADR 0063).
        
        Above the gates and below the meaning, because it answers the question a
        person arrives with once they know why the change exists. For a
        code-only change it *is* the review — the panels below are absent, and
        this is what a person decides from.
      */}
      <ChangeDiffSection
        projectId={projectId}
        preparedChangeId={change.id}
        classification={change.reviewClassification}
        filesChanged={change.filePaths.length}
      />

      <details open={!change.progress.earlySettled} className="group space-y-3">
        <summary className="text-fg-muted hover:text-fg-prose cursor-pointer list-none text-xs">
          {/* A code-only change was never previewed or photographed, and saying
              it was is the class of false status line UI-5 exists to remove. */}
          <span className="group-open:hidden">
            {codeOnly ? "Checked and approved" : "Checked, previewed and approved"}
          </span>
          <span className="hidden group-open:inline">How this change got here</span>
        </summary>

        {show("validate") && (
          <ValidationPanel
            projectId={projectId}
            preparedChangeId={change.id}
            summary={change.validation}
            runningOperation={null}
            approved={change.progress.approved}
            merged={change.progress.merged}
          />
        )}

        {/*
          Preview, for a change that has something to look at (ADR 0063).

          Absent for a code-only change, and absent rather than disabled: an
          offer to serve a page that did not change is an offer to spend a
          founder's money on a sandbox nobody needs to open. The classification
          line in "What changed" above says so in Vibe's own words, so the
          absence is explained rather than noticed.
        */}
        {!codeOnly && show("preview") && (
          <PreviewPanel
            projectId={projectId}
            preparedChangeId={change.id}
            card={change.preview}
            // Already resolved for this render. Without it the panel renders
            // "Resolving preview address…" for an origin the server handed the
            // page milliseconds earlier.
            serverOrigin={change.previewOrigin}
            productionUrl={change.productionUrl}
            approved={change.progress.approved}
            merged={change.progress.merged}
          />
        )}

        {/*
          History only (ADR 0065). Nothing creates a comparison any more; a
          change that has one from before still shows it, so an approval made
          on it can still say what it rested on.
        */}
        {!codeOnly && show("preview") && change.review.state !== "not_generated" && (
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
          />
        )}

        {/* Below the evidence, because approval is a human decision about it
            rather than another measurement of it. */}
        {show("review") && (
          <ApprovalPanel
            projectId={projectId}
            preparedChangeId={change.id}
            card={change.approval}
            merged={change.progress.merged}
          />
        )}
      </details>

      {/*
        How it was built, one click away rather than presented first. Every path
        is still there, still exact, still copyable: checkability is the point of
        this product, and a founder who wants to know precisely which files moved
        must always be able to find out.
      */}
      {chrome && (
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
      )}

      {/* Last, and only reachable through everything above it: a merge needs an
          approval, an approval needs a review, a review needs a preview, a
          preview needs a validation. There is no Deploy, Ship or Publish
          control after it — none of those exist anywhere in the product. */}
      {show("review") && (
        <MergePanel
          projectId={projectId}
          preparedChangeId={change.id}
          card={change.merge}
          classification={change.reviewClassification}
          filesChanged={change.filePaths.length}
        />
      )}

      {/* Only reachable through a merge: an outcome exists once a default
          branch actually moved, and the business question is weaker than the
          delivery one above it. Both belong to the last stage — what a merged
          change did in production is not something to answer while deciding
          whether to preview it. */}
      {show("review") && (
        <>
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
        </>
      )}
    </div>
  );
}
