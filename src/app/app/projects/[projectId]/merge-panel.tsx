"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { MergeCard } from "@/modules/merge/view";
import { mergeApprovedChangeAction, type MergeActionState } from "./merge-actions";
import { formatTimestamp } from "@/lib/utils/format-datetime";

/**
 * The merge section (Sprint 11C §15, §25, §26, §29, §30).
 *
 * ## The three sentences this panel exists to get right
 *
 * **What will happen.** Not "merge this change" but the mechanical truth: the
 * default branch moves from one commit to another, and only if GitHub still
 * matches the approved state. Both SHAs are on screen before the click, because
 * a person authorizing a write to `main` should be able to check it rather than
 * trust it.
 *
 * **What will not happen.** Vibe calls no deployment provider, before or after.
 * `merged` never renders as live, shipped, released or deployed (§25), and the
 * disclaimer is a field on the card rather than a string in this file so it
 * cannot be dropped in a redesign.
 *
 * **What might happen anyway.** This is the honest part, and the easy one to
 * omit: moving a default branch may trigger the customer's own CI/CD. Vibe did
 * not deploy anything — and saying "no production effect" would still be false.
 * So the confirmation says both, *before* the click (§26).
 *
 * ## What this component never decides
 *
 * Whether a merge is possible. That is a comparison between an approval, a
 * prepared commit and GitHub's current default branch, and a component holding
 * props has none of those. It renders the server's card (§17).
 */

function shortSha(sha: string | null): string | null {
  return sha ? sha.slice(0, 7) : null;
}

/**
 * Restated wherever a merge outcome is visible.
 *
 * The place a user is most likely to assume more happened than did: they just
 * watched their default branch move.
 */
function NotDeployed() {
  return (
    <p className="text-xs text-zinc-500">
      Not deployed by Vibe. Vibe does not call a deployment provider, and no deployment has been
      verified.
    </p>
  );
}

function MergeDialog({
  defaultBranch,
  fromSha,
  toSha,
  onCancel,
  onConfirm,
  pending,
}: {
  defaultBranch: string | null;
  fromSha: string | null;
  toSha: string | null;
  onCancel: () => void;
  onConfirm: () => void;
  pending: boolean;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="merge-confirm-title"
      className="space-y-3 rounded-md border border-sky-800/60 bg-sky-950/20 p-4"
    >
      <h5 id="merge-confirm-title" className="text-sm font-medium text-zinc-100">
        Merge approved change?
      </h5>

      <div className="space-y-2 text-sm text-zinc-300">
        <p>You approved this exact change earlier.</p>
        <p>
          Vibe will now update the repository&apos;s default branch
          {defaultBranch ? (
            <>
              {" "}
              <code className="text-zinc-200">{defaultBranch}</code>
            </>
          ) : null}{" "}
          from <code className="text-zinc-200">{shortSha(fromSha) ?? "its current commit"}</code> to{" "}
          <code className="text-zinc-200">{shortSha(toSha) ?? "the approved commit"}</code>, only if
          GitHub still matches the approved state.
        </p>
        <p>If the repository changed, Vibe will stop without modifying the default branch.</p>
        {/* §26. The honest version: Vibe deploys nothing, and moving the
            default branch can still cause a deployment. Both sentences, before
            the click, because only one of them is reassuring. */}
        <p>This does not deploy your application. Vibe will not call a deployment provider.</p>
        <p className="text-zinc-400">
          Updating the default branch may trigger your repository&apos;s existing CI/CD or hosting
          automation.
        </p>
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
          className="rounded-md border border-sky-800 bg-sky-950/40 px-3 py-1.5 text-sm text-sky-200 hover:bg-sky-900/40 disabled:opacity-60"
        >
          {pending ? "Merging…" : "Merge approved change"}
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

export function MergePanel({
  projectId,
  preparedChangeId,
  card,
}: {
  projectId: string;
  preparedChangeId: string;
  card: MergeCard;
}) {
  const router = useRouter();
  const [state, setState] = useState<MergeActionState>(null);
  const [, startTransition] = useTransition();
  const [pending, setPending] = useState(false);
  const [confirming, setConfirming] = useState(false);

  function merge() {
    if (!card.changeApprovalId) return;

    setPending(true);
    startTransition(async () => {
      setConfirming(false);
      // The confirmation travels as an explicit argument. The dialog closing is
      // not what authorizes this; the boolean is, and the server refuses
      // without it before it reads any state (§16).
      setState(
        await mergeApprovedChangeAction(projectId, preparedChangeId, card.changeApprovalId!, true),
      );
      router.refresh();
      setPending(false);
    });
  }

  return (
    <section className="space-y-3 border-t border-zinc-800 pt-4">
      <h4 className="text-sm font-medium text-zinc-200">Merge</h4>

      {confirming ? (
        <MergeDialog
          defaultBranch={card.defaultBranch}
          fromSha={card.currentDefaultHeadSha}
          toSha={card.targetCommitSha}
          onCancel={() => setConfirming(false)}
          onConfirm={merge}
          pending={pending}
        />
      ) : card.state === "merged" ? (
        <div className="space-y-2">
          <p className="text-sm text-emerald-400">Merged</p>
          <p className="text-sm text-zinc-400">
            Repository default branch updated successfully
            {card.mergedAt ? ` · ${localTime(card.mergedAt)}` : ""}
          </p>
          {card.resultingDefaultHeadSha && (
            <p className="text-xs text-zinc-500">
              {card.defaultBranch ? (
                <>
                  <code className="text-zinc-300">{card.defaultBranch}</code> now points at{" "}
                </>
              ) : (
                "The default branch now points at "
              )}
              <code className="text-zinc-300">{shortSha(card.resultingDefaultHeadSha)}</code>, read
              back from GitHub after the update.
            </p>
          )}
          <NotDeployed />
        </div>
      ) : card.state === "merging" ? (
        <div className="space-y-2">
          <p className="text-sm text-zinc-300">Merging…</p>
          <p className="text-xs text-zinc-500">
            Vibe is revalidating the repository state and updating the default branch.
          </p>
        </div>
      ) : card.state === "ready" ? (
        <div className="space-y-2">
          <p className="text-sm text-zinc-300">Ready to merge</p>
          <p className="text-xs text-zinc-500">
            {card.defaultBranch ? (
              <>
                <code className="text-zinc-300">{card.defaultBranch}</code> is still at{" "}
                <code className="text-zinc-300">{shortSha(card.currentDefaultHeadSha)}</code>, the
                commit this change was prepared on.
              </>
            ) : (
              "The default branch is still at the commit this change was prepared on."
            )}
          </p>
          <NotDeployed />
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={pending || !card.canMerge}
            className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-900 disabled:opacity-60"
          >
            Merge approved change
          </button>
        </div>
      ) : card.state === "blocked" || card.state === "failed" ? (
        <div className="space-y-2">
          <p className="text-sm text-amber-300">
            {card.state === "blocked" ? "Merge blocked" : "Merge did not complete"}
          </p>
          {card.failureMessage && <p className="text-sm text-zinc-400">{card.failureMessage}</p>}
          {/* Said explicitly for the blocked case, because "we stopped" is the
              fact a user most needs after a refused write — and it is only true
              for `blocked`, which the database guarantees wrote nothing (§29). */}
          {card.state === "blocked" && (
            <p className="text-xs text-zinc-500">Vibe did not modify the repository.</p>
          )}
          {card.state === "failed" && card.resultingDefaultHeadSha && (
            <p className="text-xs text-zinc-500">
              The default branch was last observed at{" "}
              <code className="text-zinc-300">{shortSha(card.resultingDefaultHeadSha)}</code>.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-zinc-400">Not available</p>
          {/* Never offers to fix the cause itself: re-preparing, re-validating
              and re-reviewing all cost provider time, and starting them on the
              user's behalf is what CLAUDE.md rule 60 forbids (§29). */}
          {card.failureMessage && <p className="text-xs text-zinc-500">{card.failureMessage}</p>}
        </div>
      )}

      {state?.ok === false && <p className="text-sm text-red-400">{state.message}</p>}
    </section>
  );
}
