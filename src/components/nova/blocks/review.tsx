import { ChangeGates } from "@/app/app/projects/[projectId]/agent/change-gates";
import type { PreparedChangeWorkspaceItem } from "@/modules/execution/workspace";

/**
 * The change, reviewed in the thread.
 *
 * ## Why this one is not an ask, and not a link either
 *
 * "Look at the change" was a navigation — the honest kind, because there was
 * genuinely nothing here to look at. A block changes that: `ChangeGates` is
 * the component the Agent route mounts, and it renders the whole review gate
 * from one card. So the change can be read where it was announced.
 *
 * ## What travels, and why the whole gate has to
 *
 * I would not have put a merge control in a thread, and the reason it is
 * acceptable here is that a *button* is not what arrives. `ChangeGates` brings
 * the sequence: the status sentence, the rationale or the origin, the evidence,
 * then `ApprovalPanel`, then `MergePanel`, then the outcome — in that order,
 * each reachable only through the one above it. Its own comment says it plainly:
 * *a merge needs an approval, an approval needs a review, a review needs a
 * preview, a preview needs a validation.*
 *
 * That ordering is the rule (67–71) in component form. An approval binds to one
 * immutable identity — this change, this commit, this base, this validation
 * run — and the panels carry `preparedChangeId` and the change's own approval
 * and merge cards rather than a "latest" lookup. Lifting a merge button out of
 * that sequence would be the failure the rules describe: a yes to commit A
 * applied to commit B. Lifting the sequence itself is not.
 *
 * So the block adds nothing and removes nothing. It is the frame, and the gate
 * is what the route already trusts.
 *
 * ## What it still does not do
 *
 * Deploy, ship or publish. There is no control after the merge, here or
 * anywhere, and `merged` means one sentence: the default branch points at the
 * approved commit and Vibe read it back (rule 74).
 */
export function ReviewBlock({
  projectId,
  change,
  planHref,
  /**
   * Which gate this moment is about.
   *
   * `BLOCK_FOR_MOMENT` says a change gets a review block; `GATE_STAGE` in
   * `home-view.ts` says which gate, because a failed validation and a change
   * ready to merge are the same object at different points and showing the
   * approval panel for the first would be offering a decision nobody has
   * reached.
   */
  stage = "review",
}: {
  projectId: string;
  change: PreparedChangeWorkspaceItem;
  planHref: string;
  stage?: "validate" | "review";
}) {
  return (
    <ChangeGates
      projectId={projectId}
      change={change}
      planHref={planHref}
      stage={stage}
      /* The thread says the status sentence above the block. `chrome` would
         say it again, under it. */
      chrome={false}
    />
  );
}
