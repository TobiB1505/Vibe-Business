/**
 * The narrow merge port (Sprint 11C §33, §40, §41).
 *
 * ## Why this is not `GitWritePort`
 *
 * Sprint 9 built `GitWritePort` with no `updateRef` and no `deleteRef`, so
 * "the change preparer cannot move the default branch" is a property of the
 * *type* rather than a claim about the code. That guarantee is worth keeping,
 * and adding a default-branch mutation to it would spend it.
 *
 * So the merge capability gets its own port, and the two stay disjoint: the
 * preparer can create refs and cannot move them; the merger can move exactly
 * one ref and cannot create blobs, trees, commits or branches.
 *
 * ## What is deliberately absent
 *
 * There is no `forceUpdateRef`, no `deleteRef`, no `updateRef(anyRef, sha)`, no
 * `createCommit` and no `writeFile`. Not "unused" — absent. The five operations
 * below are the entire reachable surface, which is what makes these claims
 * checkable rather than aspirational:
 *
 *  - **Nothing here can force-update anything.** `fastForwardDefaultBranch`
 *    takes a branch and a target sha. There is no force parameter to set, so
 *    "we never force" is not a code review outcome (§40).
 *  - **Nothing here can delete a branch.** The prepared `vibe/…` branch survives
 *    a merge because no call exists that could remove it (§24, §41).
 *  - **Nothing here can rewrite history.** No commit is created, so there is
 *    nothing to rewrite with.
 *  - **Nothing here can touch a ref other than the default branch.** The one
 *    write takes the branch name the *server* resolved from GitHub.
 *
 * No provider types appear here, so every merge path is testable with an
 * in-memory double and no network.
 */

/** Why GitHub refused a ref update. Provider prose never reaches this union. */
export type FastForwardRejection =
  /**
   * The update was not a fast-forward.
   *
   * GitHub enforces this itself when `force` is false, which is the safety net
   * under our own preflight: even if the branch moved in the milliseconds
   * between our read and our write, the worst outcome is a refusal (§21).
   */
  | "not_fast_forward"
  /** Branch protection or a repository ruleset rejected the write (§11). */
  | "protected_branch"
  /** The installation does not (or no longer does) carry the required permission. */
  | "permission_denied"
  /** GitHub answered, but not in a way this capability can act on. */
  | "provider_unavailable";

export type FastForwardOutcome =
  /** GitHub confirmed the ref now points here. Still not proof — see §22. */
  | { kind: "updated"; refSha: string }
  /** GitHub answered and refused. **No write happened.** */
  | { kind: "rejected"; reason: FastForwardRejection }
  /**
   * The request's outcome is unknown — a timeout, a dropped socket, a 5xx.
   *
   * The write may or may not have taken effect, and the caller must **read the
   * branch before doing anything else** (§19). Modelled as its own outcome
   * rather than an exception so it cannot be caught alongside ordinary errors
   * and quietly retried.
   */
  | { kind: "ambiguous" };

export type MergeApprovedChangePort = {
  /**
   * GitHub's current default branch name and head sha.
   *
   * Re-resolved rather than read from the stored repository connection: a
   * default branch can be renamed, and a stored name would silently address a
   * branch that no longer exists — or worse, one that now means something else.
   */
  getDefaultBranch(): Promise<{ name: string; commitSha: string } | null>;

  /** Resolves `heads/<branch>`, or null when the branch does not exist. */
  getBranchHead(branch: string): Promise<string | null>;

  /**
   * The parents of a commit, or null when the commit does not exist.
   *
   * The fast-forward invariant is checked against this: exactly one parent, and
   * that parent is the recorded base (§6).
   */
  getCommitParents(commitSha: string): Promise<string[] | null>;

  /** Whether the installation currently holds `Contents: write` (§10). */
  hasContentsWritePermission(): Promise<boolean>;

  /**
   * Moves the default branch to an existing commit, without force.
   *
   * The only write in this module, and the only consequential external call in
   * the sprint. It creates nothing: the commit already exists and was already
   * validated, previewed, reviewed and approved.
   */
  fastForwardDefaultBranch(input: { branch: string; toSha: string }): Promise<FastForwardOutcome>;
};
