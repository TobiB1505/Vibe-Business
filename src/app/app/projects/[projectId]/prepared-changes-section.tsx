import { preparedChangeAnchorId } from "@/components/layout/project-shell";
import type { ApprovalCard } from "@/modules/approvals/view";
import type { BusinessRationale } from "@/modules/execution/business-rationale";
import type { ChangeOrigin as ChangeOriginData } from "@/modules/execution/change-origin";
import type { ChangeProgress } from "@/modules/execution/change-progress";
import type { MergeCard } from "@/modules/merge/view";
import type { OutcomeCard } from "@/modules/outcome-verification/view";
import type { BusinessImpactCard } from "@/modules/business-measurement/view";
import type { PreviewCard } from "@/modules/change-preview/view";
import type { ReviewCard } from "@/modules/review/view";
import type { ReviewImages } from "@/modules/review/service";
import { ApprovalPanel } from "./approval-panel";
import { ChangeOrigin } from "./change-origin";
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
  /**
   * Where this change stands, decided once on the server (UI-5 §1).
   *
   * Every panel below speaks only for its own gate, which is why the card
   * needs someone to speak for the whole chain: what to lead with, which
   * settled gates can fold away, and which "this has not happened yet" lines
   * are still true.
   */
  progress: ChangeProgress;
  id: string;
  branchName: string;
  commitSha: string | null;
  baseBranch: string;
  filePaths: string[];
  createdAt: string;
  branchUrl: string | null;
  /** The base-to-branch difference on GitHub, for a change that stalled. */
  compareUrl: string | null;
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
  /**
   * The Move this change was prepared to address (UI-5 dogfood).
   *
   * A weaker claim than a rationale and rendered only in its absence: the
   * request, written by a model before the change existed. It exists because an
   * agent-produced change has no capability rationale and cannot have one, so
   * without it the card opens with a status line and then a branch name.
   */
  origin: ChangeOriginData | null;
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
             * The card is a level-2 panel (CORE-5). It used to be a
             * hand-rolled `rounded-lg border border-line-2`, which is what the
             * surface system exists to stop being written by hand — and, on a
             * page whose one primary object is the agent card above, a panel is
             * also the right level for it.
             */
            id={preparedChangeAnchorId(change.id)}
            className="rounded-panel bg-surface-3 border-line-3 scroll-mt-24 space-y-3 border p-5 target:border-mint/50"
            data-testid="prepared-change"
            data-prepared-change-id={change.id}
          >
            {/* Where this change stands, before anything about how it was
                built. The card used to open with a branch name, which answers
                a question almost nobody arrives with (UI-5 §2). */}
            {/* A live region, because this sentence is the one thing on the
                card that changes as the change advances — and a screen reader
                announces nothing when visible text is simply replaced. Polite:
                it is a status, not an interruption. */}
            <p role="status" className="text-fg text-sm font-medium">
              {change.progress.headline}
            </p>

            {/* What it is and why, immediately under that. This block used to
                sit ninth of eleven — below the Approve and Merge controls — so
                a person was asked to authorize a change before the screen had
                told them what it was for. */}
            <ChangeRationale rationale={change.rationale} />

            {/* Only when there is no written rationale — otherwise two answers
                to the same question would stack, and the written one is
                stronger. In practice: every agent-produced change. */}
            {!change.rationale && <ChangeOrigin origin={change.origin} />}

            {/*
              * How it was built (UI-5; folded by CORE-5).
              *
              * UI-5 moved this below the meaning, which was the important half.
              * What it left above the fold was still a branch name, a short
              * SHA, a base branch and every changed path in mono — a build log,
              * on the screen that is meant to read as a colleague's work.
              *
              * It is one click away now rather than gone. Every path is still
              * there, still exact, still copyable: checkability is the point of
              * this product, and a founder who wants to know precisely which
              * files moved must always be able to find out. What changed is
              * that they are asked for rather than presented first.
              *
              * The two links stay outside the fold. A stalled change's compare
              * link is the only way forward from that state, and "the work is
              * still on its branch" is reassurance that must not be hidden
              * behind a disclosure.
              */}
            <details className="group space-y-2 border-t border-line-2 pt-3">
              <summary className="cursor-pointer list-none text-xs text-fg-muted hover:text-fg-prose">
                <span className="group-open:hidden">
                  How this was built — {change.filePaths.length} file
                  {change.filePaths.length === 1 ? "" : "s"} changed
                </span>
                <span className="hidden group-open:inline">How this was built</span>
              </summary>

              <div className="rounded-well border-line-2 bg-well space-y-1 border p-3">
                <p className="font-mono text-xs text-fg-muted">
                  {change.branchName}
                  {" · "}
                  {change.commitSha ? `${change.commitSha.slice(0, 7)} on ${change.baseBranch}` : change.baseBranch}
                </p>

                {/* Paths only. File contents live on the branch, never in our rows. */}
                <ul className="space-y-0.5">
                  {change.filePaths.map((path) => (
                    <li key={path} className="font-mono text-xs text-fg-meta">
                      {path}
                    </li>
                  ))}
                </ul>
              </div>
            </details>

            <div className="space-y-1">
              {change.branchUrl && (
                <a
                  href={change.branchUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-block text-xs text-fg-prose underline underline-offset-2 hover:text-fg"
                >
                  Open branch on GitHub
                </a>
              )}

              {/*
                * A way forward for a change that cannot go in as it is
                * (UI-5 §7).
                *
                * A branch moving under a prepared change is the normal life of
                * a repository, not the user's mistake — but until now the card
                * said so and stopped, leaving the most common non-happy path
                * as a sentence with no door.
                *
                * What is offered is a look, not a fix. Re-preparing,
                * re-checking and re-reviewing all cost provider time, and
                * starting any of them on someone's behalf is exactly what the
                * product refuses to do. So the link goes where the difference
                * actually is, and the sentence says what survives: the work is
                * still on its branch and the approval is still on record for
                * the commit it named.
                */}
              {change.progress.stage === "stalled" && change.compareUrl && (
                <div className="space-y-1 pt-1">
                  <a
                    href={change.compareUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-block text-xs text-fg-prose underline underline-offset-2 hover:text-fg"
                  >
                    Compare this branch on GitHub
                  </a>
                  <p className="text-xs text-fg-meta max-w-[70ch]">
                    Nothing was written to your repository, and nothing was lost: this work is still
                    on its branch, and your approval still records the commit you approved. Starting
                    a fresh attempt is your call, from Next moves.
                  </p>
                </div>
              )}
            </div>

            {/*
              * The four gates a person has already been through (UI-5 §3).
              *
              * Open while they are the work, folded to a summary once an
              * approval stands — and an approval cannot exist without a
              * validation that passed and a review that is ready, so one
              * answer settles all four. Nothing is removed: `details` keeps
              * every panel one click away, which is what settled evidence
              * should be. It is checkable, not unavoidable.
              *
              * Merge, Outcome and Business impact never fold. Those are the
              * answers a person came for.
              */}
            <details open={!change.progress.earlySettled} className="group space-y-3">
              <summary className="cursor-pointer list-none text-xs text-fg-muted hover:text-fg-prose">
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
                approved={change.progress.approved}
                merged={change.progress.merged}
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
