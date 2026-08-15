"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
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
function NotMerged() {
  return (
    <p className="text-xs text-zinc-500">Nothing has been merged or deployed.</p>
  );
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
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="approve-confirm-title"
      className="space-y-3 rounded-md border border-emerald-800/60 bg-emerald-950/20 p-4"
    >
      <h5 id="approve-confirm-title" className="text-sm font-medium text-zinc-100">
        Approve this change?
      </h5>

      <div className="space-y-2 text-sm text-zinc-300">
        <p>You are approving this exact prepared change for a future merge.</p>
        <p>Vibe will not merge or deploy anything yet.</p>
        <p>Your approval is tied to this exact commit and review.</p>
        <p>If the change is modified, the approval will no longer be valid.</p>
        {commitSha && (
          <p className="text-zinc-400">
            Prepared commit: <code className="text-zinc-200">{shortSha(commitSha)}</code>
          </p>
        )}
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-900 disabled:opacity-60"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={pending}
          className="rounded-md border border-emerald-800 bg-emerald-950/40 px-3 py-1.5 text-sm text-emerald-200 hover:bg-emerald-900/40 disabled:opacity-60"
        >
          {pending ? "Approving…" : "Approve change"}
        </button>
      </div>
    </div>
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
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="revoke-confirm-title"
      className="space-y-3 rounded-md border border-amber-800/60 bg-amber-950/20 p-4"
    >
      <h5 id="revoke-confirm-title" className="text-sm font-medium text-zinc-100">
        Revoke this approval?
      </h5>

      <div className="space-y-2 text-sm text-zinc-300">
        <p>This withdraws your approval of this change.</p>
        {/* Said plainly, because "revoke" can read as "undo" — and the record
            of who approved what is deliberately permanent (§16). */}
        <p className="text-zinc-400">The approval record is kept for audit history.</p>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-900 disabled:opacity-60"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={pending}
          className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-900 disabled:opacity-60"
        >
          {pending ? "Revoking…" : "Revoke approval"}
        </button>
      </div>
    </div>
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
  /** The comparison the user is looking at. Sent so a stale tab is refused. */
  reviewArtifactId,
}: {
  projectId: string;
  preparedChangeId: string;
  card: ApprovalCard;
  reviewArtifactId: string | null;
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

  function approve() {
    if (!reviewArtifactId) return;

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
    <section className="space-y-3 border-t border-zinc-800 pt-4">
      <h4 className="text-sm font-medium text-zinc-200">Approval</h4>

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
          <p className="text-sm text-emerald-400">Change approved</p>
          <p className="text-sm text-zinc-400">
            Approved by you{card.approvedAt ? ` · ${localTime(card.approvedAt)}` : ""}
          </p>
          {/* The commit is the whole point of the record: an approval that
              cannot say what it applies to is not an approval (§3, §21). */}
          {card.approvedCommitSha && (
            <p className="text-xs text-zinc-500">
              This approval applies only to commit{" "}
              <code className="text-zinc-300">{shortSha(card.approvedCommitSha)}</code>.
            </p>
          )}
          <NotMerged />
          <button
            type="button"
            onClick={() => setConfirming("revoke")}
            disabled={busy}
            className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-900 disabled:opacity-60"
          >
            Revoke approval
          </button>
        </div>
      ) : card.state === "invalidated" ? (
        <div className="space-y-2">
          <p className="text-sm text-amber-300">Previous approval no longer applies</p>
          <p className="text-sm text-zinc-400">
            The prepared change has changed since it was approved.
          </p>
          {card.approvedCommitSha && (
            <p className="text-xs text-zinc-500">
              That approval was for commit{" "}
              <code className="text-zinc-300">{shortSha(card.approvedCommitSha)}</code>
              {card.currentCommitSha ? (
                <>
                  ; this change is now at{" "}
                  <code className="text-zinc-300">{shortSha(card.currentCommitSha)}</code>
                </>
              ) : null}
              .
            </p>
          )}
          {card.canApprove ? (
            <button
              type="button"
              onClick={() => setConfirming("approve")}
              disabled={busy || !reviewArtifactId}
              className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-900 disabled:opacity-60"
            >
              Approve change
            </button>
          ) : (
            card.blockMessage && <p className="text-xs text-zinc-500">{card.blockMessage}</p>
          )}
        </div>
      ) : card.state === "revoked" ? (
        <div className="space-y-2">
          <p className="text-sm text-zinc-400">Approval revoked</p>
          <p className="text-xs text-zinc-500">
            You withdrew your approval{card.revokedAt ? ` on ${localTime(card.revokedAt)}` : ""}.
          </p>
          {card.canApprove && (
            <button
              type="button"
              onClick={() => setConfirming("approve")}
              disabled={busy || !reviewArtifactId}
              className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-900 disabled:opacity-60"
            >
              Approve change
            </button>
          )}
        </div>
      ) : card.state === "not_approved" ? (
        <div className="space-y-2">
          <p className="text-sm text-zinc-400">Not approved</p>
          <p className="text-xs text-zinc-500">
            Approving records that you reviewed this exact change. Nothing is merged or deployed.
          </p>
          <button
            type="button"
            onClick={() => setConfirming("approve")}
            disabled={busy || !reviewArtifactId}
            className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-900 disabled:opacity-60"
          >
            Approve change
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-zinc-400">Not approved</p>
          {/* Never offers to produce the missing evidence itself: a validation
              and a comparison both cost provider time, and the user starts
              those deliberately from their own sections (CLAUDE.md rule 60). */}
          {card.blockMessage && <p className="text-xs text-zinc-500">{card.blockMessage}</p>}
        </div>
      )}

      {state?.ok === false && <p className="text-sm text-red-400">{state.message}</p>}
    </section>
  );
}
