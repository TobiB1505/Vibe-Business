"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ConfirmPanel, useReturnFocus } from "@/components/ui/confirm-panel";
import { Button } from "@/components/ui/button";
import type { ApprovalCard } from "@/modules/approvals/view";
import {
  approveChangeAction,
  revokeApprovalAction,
  type ApproveActionState,
  type RevokeActionState,
} from "./approval-actions";
import { formatTimestamp } from "@/lib/utils/format-datetime";

/**
 * The approval section (Sprint 11B §7, §21, §22, §23).
 *
 * ## What this is careful about
 *
 * Every other panel in this product reports what happened. This one asks a
 * person to take responsibility, so its copy is held to a different standard:
 *
 *  - It never says **Ready**, **Shipped**, **Live**, **Published** or
 *    **Merged**. None of those are true, and each is a word a reader would act
 *    on (§22).
 *  - It never offers **Approve & merge**, **Ship** or **Deploy**. Not disabled
 *    versions of them either — a greyed-out Merge button is a promise that
 *    something exists (§7).
 *  - It states what approval *is not*, in the same breath as what it is:
 *    nothing has been merged or deployed.
 *
 * ## State comes from the server
 *
 * Whether a change is approved is a comparison between an approval's bound
 * artifact and the artifact on screen, and this component cannot make that
 * comparison honestly. It renders the card it is given (§24). The last dogfood
 * is the argument: correct domain state rendered as the wrong sentence is
 * indistinguishable, to the reader, from a broken product — and here the wrong
 * sentence would be about authority.
 */

function shortSha(sha: string | null): string | null {
  return sha ? sha.slice(0, 7) : null;
}

/**
 * Restates the boundary wherever an approval is visible.
 *
 * The same discipline as the validation and preview panels, and the place a
 * user is most likely to assume more happened than did: they just pressed a
 * button called Approve.
 */
function NotMerged({ merged }: { merged: boolean }) {
  /*
   * Only while it is true (UI-5 §4). It used to sit under "Change approved"
   * forever, so a change already in the default branch was still being told
   * nothing had been merged — on the one panel whose whole job is recording
   * what a person authorized.
   */
  if (merged) {
    return <p className="text-xs text-fg-muted">Merged. Vibe has not verified a deployment.</p>;
  }

  return <p className="text-xs text-fg-muted">Nothing has been merged or deployed.</p>;
}

function ApproveDialog({
  commitSha,
  onCancel,
  onConfirm,
  pending,
}: {
  commitSha: string | null;
  onCancel: () => void;
  onConfirm: () => void;
  pending: boolean;
}) {
  return (
    <ConfirmPanel
      title="Approve this change?"
      pending={pending}
      onCancel={onCancel}
      onConfirm={onConfirm}
      confirmLabel={pending ? "Approving…" : "Approve change"}
    >
      <>
        <p>You are approving this exact prepared change for a future merge.</p>
        <p>Vibe will not merge or deploy anything yet.</p>
        <p>Your approval is tied to this exact commit and review.</p>
        <p>If the change is modified, the approval will no longer be valid.</p>
        {commitSha && (
          <p className="text-fg-secondary">
            Prepared commit: <code className="text-fg-body">{shortSha(commitSha)}</code>
          </p>
        )}
      </>
    </ConfirmPanel>
  );
}

function RevokeDialog({
  onCancel,
  onConfirm,
  pending,
}: {
  onCancel: () => void;
  onConfirm: () => void;
  pending: boolean;
}) {
  return (
    <ConfirmPanel
      title="Revoke this approval?"
      tone="caution"
      pending={pending}
      onCancel={onCancel}
      onConfirm={onConfirm}
      confirmLabel={pending ? "Revoking…" : "Revoke approval"}
    >
      <>
        <p>This withdraws your approval of this change.</p>
        {/* Said plainly, because "revoke" can read as "undo" — and the record
            of who approved what is deliberately permanent (§16). */}
        <p className="text-fg-secondary">The approval record is kept for audit history.</p>
      </>
    </ConfirmPanel>
  );
}

function localTime(iso: string): string {
  // Deterministic across server and client — see format-datetime.ts. Falls
  // back to the raw value so an unparseable timestamp is visible rather than
  // silently blank.
  return formatTimestamp(iso) ?? iso;
}

export function ApprovalPanel({
  projectId,
  preparedChangeId,
  card,
  /**
   * The comparison the user is looking at, or null for a code-diff review.
   *
   * Sent so a stale tab is refused: the server resolves what this change may be
   * approved on and rejects anything else — including an artifact id for a
   * change it has since decided needs no comparison (ADR 0040).
   */
  reviewArtifactId,
  /**
   * Whether this change is approved on its diff rather than on a comparison.
   *
   * The panel needs it for one reason only: `reviewArtifactId` is null in that
   * case, and without this the null would read as "nothing to approve yet" and
   * disable the button — which is the exact block this sprint removed, moved
   * one layer up.
   */
  codeReview,
  merged,
}: {
  projectId: string;
  preparedChangeId: string;
  card: ApprovalCard;
  reviewArtifactId: string | null;
  codeReview: boolean;
  /** The default branch carries this change, verified by reading it back. */
  merged: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState<ApproveActionState | RevokeActionState>(null);
  const [, startTransition] = useTransition();
  /**
   * Which action is in flight.
   *
   * Not `useTransition`'s pending flag: one transition serves approve and
   * revoke, and keying labels off it is what made the preview panel render
   * "Starting…" while stopping. Sprint 11A's dogfood paid for that lesson.
   */
  const [intent, setIntent] = useState<"approve" | "revoke" | null>(null);
  const [confirming, setConfirming] = useState<"approve" | "revoke" | null>(null);
  // Only one of the four openers renders in any given state, so they share a
  // ref: whichever exists when the confirmation closes is the one that gets
  // focus back.
  const openerRef = useReturnFocus<HTMLButtonElement>(confirming !== null);

  function approve() {
    // Exactly one evidence form, and the server decides which. A visual review
    // with no artifact is a tab whose comparison has gone; a code review with
    // one is a tab that predates the classification.
    if (!codeReview && !reviewArtifactId) return;

    setIntent("approve");
    startTransition(async () => {
      setConfirming(null);
      // The confirmation travels as an explicit argument. The dialog closing is
      // not what authorizes this; the boolean is, and the server refuses
      // without it (§8).
      setState(await approveChangeAction(projectId, preparedChangeId, reviewArtifactId, true));
      router.refresh();
      setIntent(null);
    });
  }

  function revoke() {
    if (!card.approvalId) return;

    setIntent("revoke");
    startTransition(async () => {
      setConfirming(null);
      setState(await revokeApprovalAction(projectId, card.approvalId!, true));
      router.refresh();
      setIntent(null);
    });
  }

  const busy = intent !== null;

  return (
    <section className="space-y-3 border-t border-line-2 pt-4">
      <h4 className="text-sm font-medium text-fg-body">Approval</h4>

      {confirming === "approve" ? (
        <ApproveDialog
          commitSha={card.currentCommitSha}
          onCancel={() => setConfirming(null)}
          onConfirm={approve}
          pending={busy}
        />
      ) : confirming === "revoke" ? (
        <RevokeDialog
          onCancel={() => setConfirming(null)}
          onConfirm={revoke}
          pending={busy}
        />
      ) : card.state === "approved" ? (
        <div className="space-y-2">
          <p className="text-sm text-mint">Change approved</p>
          <p className="text-sm text-fg-secondary">
            Approved by you{card.approvedAt ? ` · ${localTime(card.approvedAt)}` : ""}
          </p>
          {/* The commit is the whole point of the record: an approval that
              cannot say what it applies to is not an approval (§3, §21). */}
          {card.approvedCommitSha && (
            <p className="text-xs text-fg-muted">
              This approval applies only to commit{" "}
              <code className="text-fg-prose">{shortSha(card.approvedCommitSha)}</code>.
            </p>
          )}
          <NotMerged merged={merged} />
          {/*
            * Withdrawable only while there is something to withdraw (UI-5 §6).
            *
            * After the merge this panel is a record, not a decision still in
            * play: the write it authorized has happened and been read back,
            * and no button here can unmake it. Offering one implied otherwise.
            * The record itself is permanent either way — that was always true
            * and is now the only thing this state says.
            */}
          {!merged && (
            <Button
              ref={openerRef}
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setConfirming("revoke")}
              disabled={busy}
            >
              Revoke approval
            </Button>
          )}
        </div>
      ) : card.state === "invalidated" ? (
        <div className="space-y-2">
          <p className="text-sm text-amber">Previous approval no longer applies</p>
          <p className="text-sm text-fg-secondary">
            The prepared change has changed since it was approved.
          </p>
          {card.approvedCommitSha && (
            <p className="text-xs text-fg-muted">
              That approval was for commit{" "}
              <code className="text-fg-prose">{shortSha(card.approvedCommitSha)}</code>
              {card.currentCommitSha ? (
                <>
                  ; this change is now at{" "}
                  <code className="text-fg-prose">{shortSha(card.currentCommitSha)}</code>
                </>
              ) : null}
              .
            </p>
          )}
          {card.canApprove ? (
            <Button
              ref={openerRef}
              type="button"
              variant="primary"
              size="sm"
              onClick={() => setConfirming("approve")}
              disabled={busy || (!codeReview && !reviewArtifactId)}
            >
              Approve change
            </Button>
          ) : (
            card.blockMessage && <p className="text-xs text-fg-muted">{card.blockMessage}</p>
          )}
        </div>
      ) : card.state === "revoked" ? (
        <div className="space-y-2">
          <p className="text-sm text-fg-secondary">Approval revoked</p>
          <p className="text-xs text-fg-muted">
            You withdrew your approval{card.revokedAt ? ` on ${localTime(card.revokedAt)}` : ""}.
          </p>
          {card.canApprove && (
            <Button
              ref={openerRef}
              type="button"
              variant="primary"
              size="sm"
              onClick={() => setConfirming("approve")}
              disabled={busy || (!codeReview && !reviewArtifactId)}
            >
              Approve change
            </Button>
          )}
        </div>
      ) : card.state === "not_approved" ? (
        <div className="space-y-2">
          <p className="text-sm text-fg-secondary">Not approved</p>
          <p className="text-xs text-fg-muted">
            Approving records that you reviewed this exact change. Nothing is merged or deployed.
          </p>
          <Button
            ref={openerRef}
            type="button"
            variant="primary"
            size="sm"
            onClick={() => setConfirming("approve")}
            disabled={busy || !reviewArtifactId}
          >
            Approve change
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-fg-secondary">Not approved</p>
          {/* Never offers to produce the missing evidence itself: a validation
              and a comparison both cost provider time, and the user starts
              those deliberately from their own sections (CLAUDE.md rule 60). */}
          {card.blockMessage && <p className="text-xs text-fg-muted">{card.blockMessage}</p>}
        </div>
      )}

      {state?.ok === false && <p className="text-sm text-coral">{state.message}</p>}
    </section>
  );
}
