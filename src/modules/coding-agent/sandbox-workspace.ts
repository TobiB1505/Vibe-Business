import "server-only";

import type { SandboxHandle } from "@/modules/validation/sandbox-port";
import type { WorkspaceReadResult, WorkspaceReader } from "./workspace";

/**
 * Reading one file back out of the isolated workspace.
 *
 * ## What this used to be, and why it is not any more
 *
 * A full `AgentWorkspace` over a Vercel Sandbox: list, search, read, write,
 * remove and run, each bounded, each reached through the tool gateway. That was
 * the complete set of effects an agent could have when the harness ran in
 * Vibe's process and every action was brokered.
 *
 * ADR 0029 moved the harness into the execution's own microVM, where it edits
 * files with its own tools. Nothing has called `list`, `search`, `write`,
 * `remove` or `run` here since — and rule 76 is why that matters: an effect
 * that must never happen is an absent capability, not a denied one. Five
 * methods nothing invoked were five denials that refused nothing.
 *
 * What survives is the one thing Vibe still does to a workspace: read a file
 * back, at a path Vibe itself observed changing, so `verifyCandidateChange` can
 * compare bytes against the pinned commit (Rule 77).
 *
 * Two known defects leave with the rest, unfixed because they were never
 * reachable: the listing parsed `find -printf "%y\t%P\n"` by splitting on
 * newlines — the exact defect VB-029 removed from `changes.ts`, where a
 * filename containing a newline became two entries — and the search passed its
 * query to `grep -e` without the NUL check its neighbour performed, which
 * `search()` would have read as "no matches" and reported as a clean result.
 */

export type SandboxWorkspaceDeps = {
  sandbox: SandboxHandle;
  /**
   * Where the repository is, relative to the sandbox home.
   *
   * Vercel materializes a git source at `/vercel/sandbox/<repo>/`, discovered
   * by listing the directory after four validation runs looked in the wrong
   * place. Taken from the repository name on the server, never guessed inside
   * the sandbox.
   */
  sourceRoot: string;
  /** The package/app root within the repository. Usually "". */
  workspaceRoot: string;
};

function join(...segments: string[]): string {
  const parts = segments
    .map((segment) => segment.replace(/^\/+|\/+$/g, ""))
    .filter((segment) => segment.length > 0 && segment !== ".");
  return parts.length === 0 ? "." : parts.join("/");
}

export function createSandboxWorkspaceReader(deps: SandboxWorkspaceDeps): WorkspaceReader {
  /** A path relative to the sandbox home, for `readFile`. */
  const fromHome = (path: string) => join(deps.sourceRoot, deps.workspaceRoot, path);

  return {
    async read(input: { path: string; maxBytes: number }): Promise<WorkspaceReadResult> {
      // Reads one byte past the budget so "too large" is observable. Hashing a
      // truncated prefix against a whole file is what produced a false
      // integrity failure in Sprint 10A; here it would silently hand the agent
      // a partial file it believed was complete.
      const content = await deps.sandbox.readFile({
        path: fromHome(input.path),
        maxBytes: input.maxBytes + 1,
      });

      if (content === null) return { kind: "absent" };
      // Compared in bytes, because the budget is in bytes. `content.length`
      // counts UTF-16 units, so a file of multi-byte characters passed a byte
      // budget it had already exceeded — and arrived here *truncated to the
      // read bound*, which run `b33635a1` recorded as two complete 262 145-byte
      // additions. Had that change been accepted, Vibe would have written a
      // half a file onto a branch and called it exact (§59).
      if (Buffer.byteLength(content, "utf8") > input.maxBytes) return { kind: "too_large" };
      return { kind: "content", content };
    },
  };
}
