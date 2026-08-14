import type { ChangeMerge, MergeFailureCode } from "./schema";

/**
 * What a merge looks like to a user (Sprint 11C §15, §25, §29, §30).
 *
 * ## Why the server decides this
 *
 * Same reason as the approval card, one gate further along and with more at
 * stake. Whether a merge is possible is a comparison between an approval, a
 * prepared commit and *GitHub's current default branch* — three facts a
 * component holding props has none of. The one thing it must never do is
 * answer optimistically.
 *
 * ## The claim this card is built to not make
 *
 * `merged` means the default branch points at the approved commit and Vibe read
 * it back. It does not mean deployed, released, live or shipped. The card
 * carries the disclaimer as data rather than leaving it to whichever component
 * renders it, so a success state cannot be rendered without it (§25).
 */

export type MergeCardState =
  /** Something is missing before a merge could be offered at all. */
  | "not_eligible"
  /** A fresh read-only preflight says this could merge right now (§17). */
  | "ready"
  /** A durable merge operation is in flight. */
  | "merging"
  /** The default branch was moved and independently verified (§22). */
  | "merged"
  /** An attempt was refused before any write (§29, §30). */
  | "blocked"
  /** An attempt was made and did not end in a verified merge. */
  | "failed";

export type MergeCard = {
  state: MergeCardState;
  changeMergeId: string | null;
  /** The approval that would authorize the merge. Sent back on confirmation. */
  changeApprovalId: string | null;
  /** GitHub's current default branch name, resolved live. Null when unknown. */
  defaultBranch: string | null;
  /** Where the default branch is now — what it would move *from*. */
  currentDefaultHeadSha: string | null;
  /** The approved commit — what it would move *to*. */
  targetCommitSha: string | null;
  /** The head read back after a completed merge (§22). */
  resultingDefaultHeadSha: string | null;
  mergedAt: string | null;
  failureCode: MergeFailureCode | null;
  /** Safe copy for the refusal. Never an internal error string. */
  failureMessage: string | null;
  /** Whether the panel may offer the merge action at all. */
  canMerge: boolean;
  /**
   * Whether a deployment has been verified by Vibe.
   *
   * Always `false`, and present as a field rather than a hardcoded string in
   * the component so that "Vibe did not deploy this" survives a redesign of the
   * panel. When a deployment gate exists, this becomes a real value; until then
   * it is a constant the UI is required to render (§25).
   */
  deploymentVerified: false;
};

export type MergeCardInput = {
  /** The most recent attempt for this prepared change, in any state. */
  latestMerge: ChangeMerge | null;
  /**
   * The read-only eligibility answer for the artifact on screen (§17).
   *
   * Null when no fresh preflight was run — which is the normal case for a
   * prepared change that is not approved, because eligibility is not worth a
   * GitHub round trip until a human decision exists.
   */
  eligibility:
    | { outcome: "eligible"; defaultBranch: string; observedDefaultHead: string; targetSha: string }
    | { outcome: "already_applied"; defaultBranch: string; targetSha: string }
    | { outcome: "blocked"; reason: MergeFailureCode }
    | null;
  /** The active approval's id, when there is one. */
  changeApprovalId: string | null;
  resolveFailureMessage: (code: MergeFailureCode) => string;
};

const EMPTY = {
  changeMergeId: null,
  defaultBranch: null,
  currentDefaultHeadSha: null,
  targetCommitSha: null,
  resultingDefaultHeadSha: null,
  mergedAt: null,
  failureCode: null,
  failureMessage: null,
} as const;

export function buildMergeCard(input: MergeCardInput): MergeCard {
  const base = {
    changeApprovalId: input.changeApprovalId,
    deploymentVerified: false as const,
  };

  const latest = input.latestMerge;

  // A completed merge is terminal and outranks everything: once the default
  // branch has been moved to this commit, no eligibility answer can change what
  // happened. Read from the row rather than re-derived, because the row is the
  // record of the write.
  if (latest?.status === "merged") {
    return {
      ...base,
      state: "merged",
      changeMergeId: latest.id,
      defaultBranch: latest.defaultBranch,
      currentDefaultHeadSha: latest.observedDefaultHeadBefore,
      targetCommitSha: latest.preparedCommitSha,
      resultingDefaultHeadSha: latest.resultingDefaultHeadSha,
      mergedAt: latest.mergedAt,
      failureCode: null,
      failureMessage: null,
      canMerge: false,
    };
  }

  // An attempt is live. Never offer the button while one is in flight — the
  // database would refuse a second write anyway, but a button that looks
  // available during a default-branch update is its own kind of wrong.
  if (latest?.status === "preflight" || latest?.status === "merging") {
    return {
      ...base,
      ...EMPTY,
      state: "merging",
      changeMergeId: latest.id,
      defaultBranch: latest.defaultBranch,
      currentDefaultHeadSha: latest.observedDefaultHeadBefore,
      targetCommitSha: latest.preparedCommitSha,
      canMerge: false,
    };
  }

  // The eligibility answer for what is on screen *now* takes precedence over an
  // older refusal: a merge blocked yesterday because `main` had moved is not a
  // reason to keep refusing today if the artifact was since re-approved against
  // the current base.
  if (input.eligibility?.outcome === "eligible") {
    return {
      ...base,
      ...EMPTY,
      state: "ready",
      defaultBranch: input.eligibility.defaultBranch,
      currentDefaultHeadSha: input.eligibility.observedDefaultHead,
      targetCommitSha: input.eligibility.targetSha,
      canMerge: true,
    };
  }

  // GitHub already has the approved commit on its default branch, and no merge
  // row says Vibe put it there. Somebody merged it by hand, which is a perfectly
  // ordinary thing to do — and it is not something to offer to do again (§20).
  if (input.eligibility?.outcome === "already_applied") {
    return {
      ...base,
      ...EMPTY,
      state: "merged",
      defaultBranch: input.eligibility.defaultBranch,
      targetCommitSha: input.eligibility.targetSha,
      resultingDefaultHeadSha: input.eligibility.targetSha,
      canMerge: false,
    };
  }

  // A previous attempt that touched GitHub and did not end verified. Shown
  // ahead of a plain eligibility refusal because "we tried and it did not
  // finish" is the more important sentence, and the user needs to see it even
  // if the artifact happens to look mergeable again.
  if (latest?.status === "failed") {
    return {
      ...base,
      state: "failed",
      changeMergeId: latest.id,
      defaultBranch: latest.defaultBranch,
      currentDefaultHeadSha: latest.observedDefaultHeadBefore,
      targetCommitSha: latest.preparedCommitSha,
      resultingDefaultHeadSha: latest.resultingDefaultHeadSha,
      mergedAt: null,
      failureCode: latest.failureCode,
      failureMessage: latest.failureCode ? input.resolveFailureMessage(latest.failureCode) : null,
      canMerge: false,
    };
  }

  if (input.eligibility?.outcome === "blocked") {
    return {
      ...base,
      ...EMPTY,
      state: "not_eligible",
      failureCode: input.eligibility.reason,
      failureMessage: input.resolveFailureMessage(input.eligibility.reason),
      canMerge: false,
    };
  }

  if (latest?.status === "blocked") {
    return {
      ...base,
      ...EMPTY,
      state: "blocked",
      changeMergeId: latest.id,
      defaultBranch: latest.defaultBranch,
      targetCommitSha: latest.preparedCommitSha,
      failureCode: latest.failureCode,
      failureMessage: latest.failureCode ? input.resolveFailureMessage(latest.failureCode) : null,
      canMerge: false,
    };
  }

  // No approval, so no preflight was run and there is nothing to say beyond
  // that merging is not available yet. The approval panel above already
  // explains what is missing; repeating it here would be two components
  // narrating the same gate.
  return { ...base, ...EMPTY, state: "not_eligible", canMerge: false };
}
