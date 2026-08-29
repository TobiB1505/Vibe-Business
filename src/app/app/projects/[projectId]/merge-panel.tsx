"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ConfirmPanel, useReturnFocus } from "@/components/ui/confirm-panel";
import { Button } from "@/components/ui/button";
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
    <p className="text-xs text-fg-muted">
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
    <ConfirmPanel
      title="Merge approved change?"
      pending={pending}
      onCancel={onCancel}
      onConfirm={onConfirm}
      confirmLabel={pending ? "Merging…" : "Merge approved change"}
    >
      <>
        <p>You approved this exact change earlier.</p>
        <p>
          Vibe will now update the repository&apos;s default branch
          {defaultBranch ? (
            <>
              {" "}
              <code className="text-fg-body">{defaultBranch}</code>
            </>
          ) : null}{" "}
          from <code className="text-fg-body">{shortSha(fromSha) ?? "its current commit"}</code> to{" "}
          <code className="text-fg-body">{shortSha(toSha) ?? "the approved commit"}</code>, only if
          GitHub still matches the approved state.
        </p>
        <p>If the repository changed, Vibe will stop without modifying the default branch.</p>
        {/* §26. The honest version: Vibe deploys nothing, and moving the
            default branch can still cause a deployment. Both sentences, before
            the click, because only one of them is reassuring. */}
        <p>This does not deploy your application. Vibe will not call a deployment provider.</p>
        <p className="text-fg-secondary">
          Updating the default branch may trigger your repository&apos;s existing CI/CD or hosting
          automation.
        </p>
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

export function MergePanel({
  projectId,
  preparedChangeId,
  card,
  presentation = "section",
}: {
  projectId: string;
  preparedChangeId: string;
  card: MergeCard;
  /** Removes legacy divider chrome when the decision lives in the Agent stage. */
  presentation?: "section" | "workspace";
}) {
  const router = useRouter();
  const [state, setState] = useState<MergeActionState>(null);
  const [, startTransition] = useTransition();
  const [pending, setPending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  // Focus goes back to this button when the confirmation closes — it is
  // unmounted while the confirmation is open, so the panel cannot do it.
  const openerRef = useReturnFocus<HTMLButtonElement>(confirming);

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
    <section
      className={
        presentation === "workspace"
          ? "space-y-3"
          : "space-y-3 border-t border-line-2 pt-4"
      }
    >
      <h4 className="text-sm font-medium text-fg-body">Merge</h4>

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
          <p className="text-sm text-mint">Merged</p>
          <p className="text-sm text-fg-secondary">
            Repository default branch updated successfully
            {card.mergedAt ? ` · ${localTime(card.mergedAt)}` : ""}
          </p>
          {card.resultingDefaultHeadSha && (
            <p className="text-xs text-fg-muted">
              {card.defaultBranch ? (
                <>
                  <code className="text-fg-prose">{card.defaultBranch}</code> now points at{" "}
                </>
              ) : (
                "The default branch now points at "
              )}
              <code className="text-fg-prose">{shortSha(card.resultingDefaultHeadSha)}</code>, read
              back from GitHub after the update.
            </p>
          )}
          <NotDeployed />
        </div>
      ) : card.state === "merging" ? (
        <div className="space-y-2">
          <p className="text-sm text-fg-prose">Merging…</p>
          <p className="text-xs text-fg-muted">
            Vibe is revalidating the repository state and updating the default branch.
          </p>
        </div>
      ) : card.state === "ready" ? (
        <div className="space-y-2">
          <p className="text-sm text-fg-prose">Ready to merge</p>
          <p className="text-xs text-fg-muted">
            {card.defaultBranch ? (
              <>
                <code className="text-fg-prose">{card.defaultBranch}</code> is still at{" "}
                <code className="text-fg-prose">{shortSha(card.currentDefaultHeadSha)}</code>, the
                commit this change was prepared on.
              </>
            ) : (
              "The default branch is still at the commit this change was prepared on."
            )}
          </p>
          <NotDeployed />
          {/* Primary because it is the section's one action, and the dialog it
              opens replaces it — so the screen never carries two mint
              controls at once. */}
          <Button
            ref={openerRef}
            type="button"
            variant="primary"
            size="sm"
            onClick={() => setConfirming(true)}
            disabled={pending || !card.canMerge}
          >
            Merge approved change
          </Button>
        </div>
      ) : card.state === "blocked" || card.state === "failed" ? (
        <div className="space-y-2">
          <p className="text-sm text-amber">
            {card.state === "blocked" ? "Merge blocked" : "Merge did not complete"}
          </p>
          {card.failureMessage && <p className="text-sm text-fg-secondary">{card.failureMessage}</p>}
          {/* Said explicitly for the blocked case, because "we stopped" is the
              fact a user most needs after a refused write — and it is only true
              for `blocked`, which the database guarantees wrote nothing (§29). */}
          {card.state === "blocked" && (
            <p className="text-xs text-fg-muted">Vibe did not modify the repository.</p>
          )}
          {card.state === "failed" && card.resultingDefaultHeadSha && (
            <p className="text-xs text-fg-muted">
              The default branch was last observed at{" "}
              <code className="text-fg-prose">{shortSha(card.resultingDefaultHeadSha)}</code>.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-fg-secondary">Not available</p>
          {/* Never offers to fix the cause itself: re-preparing, re-validating
              and re-reviewing all cost provider time, and starting them on the
              user's behalf is what CLAUDE.md rule 60 forbids (§29). */}
          {card.failureMessage && <p className="text-xs text-fg-muted">{card.failureMessage}</p>}
        </div>
      )}

      {state?.ok === false && <p className="text-sm text-coral">{state.message}</p>}
    </section>
  );
}
