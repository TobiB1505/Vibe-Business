import "server-only";

import { getInstallationOctokit } from "@/modules/github/app-client";
import type { FastForwardOutcome, FastForwardRejection, MergeApprovedChangePort } from "../git-port";

/**
 * The GitHub adapter for the merge capability (Sprint 11C §10, §21, §33, §34).
 *
 * The only file in this module that names Octokit. Everything above it sees
 * `MergeApprovedChangePort`, which is what lets the preflight, the ambiguity
 * recovery and the read-back verification be tested exhaustively with no
 * network and no repository.
 *
 * ## The write, exactly
 *
 * `PATCH /repos/{owner}/{repo}/git/refs/heads/{branch}` with `{ sha, force:
 * false }`. Verified against the current published OpenAPI description of the
 * endpoint rather than from memory; the `force` parameter is documented as:
 *
 * > Indicates whether to force the update or to make sure the update is a
 * > fast-forward update. Leaving this out or setting it to `false` will make
 * > sure you're not overwriting work.
 *
 * That is the second half of this sprint's safety, and it is GitHub's half: our
 * preflight checks that the branch is where we think it is, and `force: false`
 * makes GitHub refuse if it stopped being true in the meantime. The parameter
 * is passed explicitly rather than left to the default, so the guarantee is
 * visible at the call site instead of inherited from a spec nobody rereads.
 *
 * ## The race this does not close
 *
 * The endpoint has **no compare-and-swap parameter** — there is no way to say
 * "update only if the ref is currently X". So between reading the head and
 * issuing the write, the branch can move. Stated honestly rather than papered
 * over, because the residual window has a bounded worst case:
 *
 *  - the branch moved *forward* → our commit is no longer a descendant of the
 *    tip, GitHub rejects the update as non-fast-forward, nothing is lost;
 *  - the branch moved to our commit → the read-back finds exactly what was
 *    approved, which is the outcome we wanted;
 *  - the branch moved anywhere else → non-fast-forward, refused.
 *
 * There is no sequence in which a lost race overwrites someone's work, because
 * the only write available cannot overwrite anything.
 *
 * ## Token handling (§34)
 *
 * The installation token lives inside the Octokit instance for the lifetime of
 * a step. It is never returned, never logged, never persisted on the operation
 * or the merge row, and never crosses a durable boundary. The merge is a
 * server-to-GitHub call; no sandbox and no browser is involved anywhere in this
 * sprint.
 */

export type MergeRepositoryTarget = {
  installationId: number;
  owner: string;
  repo: string;
};

type HttpLike = { status?: unknown; message?: unknown };

function statusOf(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const status = (error as HttpLike).status;
  return typeof status === "number" ? status : null;
}

function messageOf(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const message = (error as HttpLike).message;
  return typeof message === "string" ? message : "";
}

/**
 * Classifies a failed ref update (§11, §19, §28).
 *
 * The distinction that matters most is not which refusal it was — it is
 * **refused versus unknown**. A 4xx means GitHub read the request, decided, and
 * did not move the branch: safe, terminal, explainable. A 5xx or a transport
 * failure means we do not know, and the only correct next move is to read the
 * branch rather than to write again.
 *
 * Provider prose is inspected here and nowhere else. It never leaves this
 * function: what escapes is one of four closed values, or `ambiguous`.
 */
export function classifyFastForwardError(error: unknown): FastForwardOutcome {
  const status = statusOf(error);
  const message = messageOf(error);

  // No status at all — a socket error, a DNS failure, an aborted request. The
  // request may have reached GitHub and been applied (§19).
  if (status === null) return { kind: "ambiguous" };

  // GitHub itself failed. Same reasoning: a 502 can follow a mutation that
  // succeeded on the far side of a proxy.
  if (status >= 500) return { kind: "ambiguous" };

  const rejection = ((): FastForwardRejection => {
    // Branch protection and rulesets are checked before the fast-forward shape,
    // because a protected branch can reject an update that *would* have been a
    // valid fast-forward, and telling the user "not a fast-forward" would send
    // them to fix the wrong thing (§30).
    //
    // The `pull request` and `push` alternatives are not decoration: GitHub
    // rulesets phrase their refusal as "Changes must be made through a pull
    // request" and "... is not authorized to push to this branch", neither of
    // which contains the word "protected". Classified as permission failures
    // they would send the user to reconnect their installation, when what
    // actually happened is that their own repository rule worked.
    if (
      /protected|protection|rule|ruleset|required status check|required review|signed commit|pull request|not authorized to push/i.test(
        message,
      )
    ) {
      return "protected_branch";
    }
    if (/fast.?forward/i.test(message)) return "not_fast_forward";
    if (status === 401 || status === 403) return "permission_denied";
    // 422 without a recognised message, and 409, are both definitive refusals
    // of a ref update. Reported as non-fast-forward because that is what the
    // endpoint refuses a non-forced update for, and because the recovery is the
    // same: re-check the branch, do not force.
    if (status === 409 || status === 422) return "not_fast_forward";
    return "provider_unavailable";
  })();

  return { kind: "rejected", reason: rejection };
}

export function createGithubMergePort(target: MergeRepositoryTarget): MergeApprovedChangePort {
  const octokit = getInstallationOctokit(target.installationId);
  const scope = { owner: target.owner, repo: target.repo };

  return {
    async getDefaultBranch() {
      try {
        // The branch name is re-resolved, never taken from the stored
        // connection: a rename since connection time would otherwise address a
        // branch that no longer exists, or one that now means something else.
        const { data: repository } = await octokit.rest.repos.get(scope);
        const { data: ref } = await octokit.rest.git.getRef({
          ...scope,
          ref: `heads/${repository.default_branch}`,
        });
        return { name: repository.default_branch, commitSha: ref.object.sha };
      } catch {
        // Unreachable is an answer the preflight can act on. It must never
        // become an exception that ends up looking like "eligible".
        return null;
      }
    },

    async getBranchHead(branch) {
      try {
        const { data } = await octokit.rest.git.getRef({ ...scope, ref: `heads/${branch}` });
        return data.object.sha;
      } catch {
        return null;
      }
    },

    async getCommitParents(commitSha) {
      try {
        const { data } = await octokit.rest.git.getCommit({ ...scope, commit_sha: commitSha });
        return data.parents.map((parent) => parent.sha);
      } catch {
        return null;
      }
    },

    async hasContentsWritePermission() {
      try {
        // What the installation *actually* carries. What the App requested at
        // install time says nothing about what the owner approved.
        const auth = (await octokit.auth({ type: "installation" })) as {
          permissions?: Record<string, string>;
        };
        return auth.permissions?.contents === "write";
      } catch {
        return false;
      }
    },

    async fastForwardDefaultBranch({ branch, toSha }) {
      try {
        const { data } = await octokit.rest.git.updateRef({
          ...scope,
          ref: `heads/${branch}`,
          sha: toSha,
          // Never true, and never derived from anything. A forced update is
          // what would let this call destroy history on a customer's default
          // branch, and the port above has no parameter that could ask for one.
          force: false,
        });
        return { kind: "updated", refSha: data.object.sha };
      } catch (error) {
        return classifyFastForwardError(error);
      }
    },
  };
}
