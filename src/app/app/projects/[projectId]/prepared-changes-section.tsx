import { preparedChangeAnchorId } from "@/components/layout/project-shell";
import type { ApprovalCard } from "@/modules/approvals/view";
import type { BusinessRationale } from "@/modules/execution/business-rationale";
import type { MergeCard } from "@/modules/merge/view";
import type { OutcomeCard } from "@/modules/outcome-verification/view";
import type { BusinessImpactCard } from "@/modules/business-measurement/view";
import type { PreviewCard } from "@/modules/change-preview/view";
import type { ReviewCard } from "@/modules/review/view";
import type { ReviewImages } from "@/modules/review/service";
import { ApprovalPanel } from "./approval-panel";
import { ChangeRationale } from "./change-rationale";
import { MergePanel } from "./merge-panel";
import { OutcomePanel } from "./outcome-panel";
import { BusinessImpactPanel } from "./business-impact-panel";
import { PreviewPanel } from "./preview-panel";
import { ReviewPanel } from "./review-panel";
import { ValidationPanel, type ValidationSummary } from "./validation-panel";

/**
 * Prepared changes as artifacts (Sprint 10A §44).
 *
 * ## Why this exists separately from the opportunity list
 *
 * A prepared change was originally only reachable through the opportunity that
 * motivated it, matched by an execution identity that includes the opportunity
 * *set* id. Regenerating opportunities therefore made every existing prepared
 * change vanish from the UI — while its branch and commit sat untouched in the
 * customer's repository.
 *
 * That is the wrong model. A prepared change is an artifact, not a view of
 * current advice, and validation asks a question about the artifact: *does this
 * commit build?* — which does not stop being answerable because the advice
 * moved on. The opportunity list still shows "Change prepared" where the two
 * line up; this section is what guarantees an artifact stays reachable when
 * they do not.
 */

export type PreparedChangeCard = {
  id: string;
  branchName: string;
  commitSha: string | null;
  baseBranch: string;
  filePaths: string[];
  createdAt: string;
  branchUrl: string | null;
  validation: ValidationSummary | null;
  /** Preview state, decided on the server. Never inferred from the fields above. */
  preview: PreviewCard;
  /**
   * The ValidatedArtifact a preview would restore, when one exists.
   *
   * Its id is the validation run that captured it. The client passes it back to
   * start a preview and can name nothing else — no snapshot, no sandbox, no
   * port, no command (§6).
   */
  validatedArtifactId: string | null;
  /** Review state, decided on the server like every other panel's. */
  review: ReviewCard;
  /** Signed, short-lived image URLs. Minted server-side, never persisted (§16). */
  reviewImages: ReviewImages | null;
  /** The running preview to photograph, when there is one. */
  previewSessionId: string | null;
  /** Provider-resolved preview origin, for "Open". Null once the preview ends. */
  previewOrigin: string | null;
  /**
   * Approval state, decided on the server (Sprint 11B §24).
   *
   * Whether something is approved is a comparison between what a human approved
   * and what is on screen now. A component holding props cannot make that
   * comparison, and the one thing it must never do is answer it optimistically.
   */
  approval: ApprovalCard;
  /**
   * Merge state, decided on the server (Sprint 11C §17).
   *
   * Whether a merge is possible is a comparison between an approval, a prepared
   * commit and GitHub's *current* default branch. A component holding props has
   * none of those three, and the one it must never do is guess optimistically —
   * the guess would be about a write to somebody's repository.
   */
  merge: MergeCard;
  /**
   * Production outcome state, decided on the server (Sprint 12A §29).
   *
   * The first card on this page that describes the customer's *product* rather
   * than Vibe's own pipeline — and the one most likely to be misread, because a
   * green tick after a merge invites the conclusion that the business improved.
   * The card carries the delivery/product/business separation as data so a
   * component cannot render one without the others.
   */
  outcome: OutcomeCard;
  /**
   * Business impact state, decided on the server (Sprint 12B §21).
   *
   * The last card in the chain and the only one about the customer's *business*
   * rather than about their product or Vibe's own work. It is also the one most
   * easily misread: four of its states are not results at all, and rendering
   * any of them as "no impact" would blame a change for a gap in Vibe's setup.
   */
  businessImpact: BusinessImpactCard;
  /**
   * Why this change should matter (Cleanup §6, §7).
   *
   * Deterministic, capability-owned, and knowable before anything ran — the
   * weakest claim on this page, and deliberately the first one a user reads
   * after the change itself. Null for a capability with no written rationale.
   */
  rationale: BusinessRationale | null;
};

export function PreparedChangesSection({
  projectId,
  changes,
}: {
  projectId: string;
  changes: PreparedChangeCard[];
}) {
  if (changes.length === 0) return null;

  return (
    <section className="space-y-4">
      {/* No heading of its own: the workspace section that wraps this owns it
          (UI-1), and a second "Prepared changes" `h2` inside "Prepared" put the
          same level twice in the outline. The sentence stays — it is the one
          that says merging is not deploying, and that is load-bearing. */}
      <p className="text-fg-muted text-sm">
        Changes Vibe wrote to isolated branches. Merging updates the repository&apos;s default
        branch; nothing here is deployed by Vibe.
      </p>

      <ul className="space-y-4">
        {changes.map((change) => (
          <li
            key={change.id}
            /*
             * Addressable, so "I prepared this" can lead to *this* (UI-S2 §27,
             * §28). `scroll-mt` keeps the card clear of the sticky workspace
             * header when the browser jumps to it — without it the fragment
             * lands with the heading hidden behind the chrome.
             *
             * The card itself is unchanged: no new state, no new layout, no
             * redesign (§53).
             */
            id={preparedChangeAnchorId(change.id)}
            className="scroll-mt-24 space-y-3 rounded-lg border border-line-2 p-4 target:border-mint/50"
            data-testid="prepared-change"
            data-prepared-change-id={change.id}
          >
            <div className="space-y-1">
              <p className="font-mono text-sm text-fg-body">{change.branchName}</p>
              <p className="text-xs text-fg-muted">
                {change.commitSha ? `${change.commitSha.slice(0, 7)} on ${change.baseBranch}` : change.baseBranch}
                {" · "}
                {change.filePaths.length} file{change.filePaths.length === 1 ? "" : "s"}
              </p>
            </div>

            {/* Paths only. File contents live on the branch, never in our rows. */}
            <ul className="space-y-0.5">
              {change.filePaths.map((path) => (
                <li key={path} className="font-mono text-xs text-fg-muted">
                  {path}
                </li>
              ))}
            </ul>

            {change.branchUrl && (
              <a
                href={change.branchUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-block text-sm text-fg-prose underline underline-offset-2 hover:text-fg"
              >
                Open branch on GitHub
              </a>
            )}

            <ValidationPanel
              projectId={projectId}
              preparedChangeId={change.id}
              summary={change.validation}
              runningOperation={null}
            />

            {/* Below validation, deliberately: a preview restores what a
                validation produced, so the order on screen is the order of the
                gates. There is no Merge, Deploy or Approve button here or
                anywhere — none of those exist. */}
            <PreviewPanel
              projectId={projectId}
              preparedChangeId={change.id}
              card={change.preview}
              validatedArtifactId={change.validatedArtifactId}
              // Already resolved for this render. Without it the panel renders
              // "Resolving preview address…" until its first poll, for an
              // origin the server handed the page milliseconds earlier.
              serverOrigin={change.previewOrigin}
            />

            {/* Below Preview, because a comparison photographs a running
                preview. The order on screen is the order of the gates — and
                there is no Approve, Merge or Deploy control after it. */}
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
            />

            {/* Below the evidence, because approval is a human decision about
                it rather than another measurement of it. */}
            <ApprovalPanel
              projectId={projectId}
              preparedChangeId={change.id}
              card={change.approval}
              reviewArtifactId={change.review.reviewArtifactId}
            />

            {/* Last, and only reachable through everything above it: a merge
                needs an approval, an approval needs a review, a review needs a
                preview, a preview needs a validation. The order on screen is
                the order of the gates.

                There is no Deploy, Ship or Publish control after it — none of
                those exist anywhere in the product, and a merge is not one. */}
            <MergePanel projectId={projectId} preparedChangeId={change.id} card={change.merge} />

            {/* After Merge, and only reachable through it: an outcome exists
                only once a default branch actually moved. It is the first
                panel here that asks about the customer's product rather than
                about Vibe's own work — and the only one whose success state
                has to explicitly say what it does *not* mean. */}
            {/* Before the verified checks, because the order a user needs is
                what changed → why it matters → what was confirmed (§11). */}
            <ChangeRationale rationale={change.rationale} />

            <OutcomePanel
              projectId={projectId}
              preparedChangeId={change.id}
              card={change.outcome}
              businessImpactLabel={change.businessImpact.ladderLabel}
            />

            {/* Last, and only reachable through a merge: delivery, then product
                outcome, then — and only then — the business question. The order
                on screen is the order of the claims, and each is weaker than
                the one above it. There is no Revert, Roll back or Redeploy
                control after it; none of those exist (§28). */}
            <BusinessImpactPanel
              projectId={projectId}
              preparedChangeId={change.id}
              card={change.businessImpact}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
