import { createHash } from "node:crypto";
import {
  acceptProposedChange,
  type ProposedChangeRejection,
} from "@/modules/execution-contract/proposed-change";
import type { WriteScopeViolation } from "@/modules/execution-contract/policy";
import { isAgenticWritablePath } from "@/modules/execution/paths";
import type { ExecutionSpec } from "@/modules/execution-contract/spec";
import type { AgentRuntimeLimits } from "./budget";
import type { GatewayChange } from "./gateway";
import type { AgentWorkspace } from "./workspace";

/**
 * The candidate change, computed by Vibe (EXECUTION CORE-4 §27, §28, §59).
 *
 * ## The rule
 *
 * > Do not trust an Agent-written summary as the actual change.
 *
 * Nothing here reads the agent's final message. The change is established from
 * two sources Vibe controls:
 *
 * ```
 * which paths     the gateway's own record of the writes it brokered
 * which bytes     read back out of the workspace, after the agent stopped
 * ```
 *
 * The first is why the gateway is the *only* door: an agent has no tool that
 * writes without going through it, so a path it does not know about cannot
 * exist. The second is why a read-back happens at all — the gateway knows what
 * it was asked to write, and only the filesystem knows what is actually there.
 * A later write, a failed write, or a check that rewrote a generated file all
 * show up in the read-back and nowhere else.
 *
 * ## Why the base content is fetched from GitHub rather than from the sandbox
 *
 * A change is a delta against a *specific commit*, and the sandbox's copy of
 * the original file is gone — the agent overwrote it. Comparing against the
 * pinned base SHA through the existing bounded reader is the only way to answer
 * "is this file actually different?", and it re-establishes the premise from a
 * source the agent never touched (Rule 55).
 *
 * A file written back byte-identical to its base is **not a change** and is
 * dropped. Without that, an agent that read a file and rewrote it unchanged
 * would produce a PreparedChange containing a no-op — a diff a reviewer would
 * be asked to approve for nothing.
 */

/** Reads a file at an exact commit. The same bounded reader the analyzer uses. */
export type BaseContentPort = {
  getTextFile(path: string, commitSha: string, maxBytes: number): Promise<string | null>;
};

export type CandidateFile = {
  path: string;
  /** `null` when the agent deleted a file that existed at the base commit. */
  content: string | null;
  /** What was there at the base commit. `null` when the file is new. */
  baseContent: string | null;
  status: "added" | "modified" | "deleted";
  bytes: number;
  /** sha256 of `content`. Null for a deletion. */
  contentHash: string | null;
};

export type CandidateChange = {
  files: readonly CandidateFile[];
  totalBytes: number;
  /** Paths the agent wrote that turned out to be identical to the base. */
  unchangedPaths: readonly string[];
};

export function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * Establishes what the agent actually left behind (§27).
 *
 * Deliberately tolerant of a workspace read failing: a path the gateway
 * recorded but cannot be read back is reported as absent, which — if the agent
 * had written it — surfaces as a deletion the verifier then has to justify
 * against the base. That is the honest reading, and it is better than assuming
 * the write landed.
 */
export async function extractCandidateChange(input: {
  spec: ExecutionSpec;
  changes: readonly GatewayChange[];
  workspace: AgentWorkspace;
  base: BaseContentPort;
  limits: AgentRuntimeLimits;
}): Promise<CandidateChange> {
  const files: CandidateFile[] = [];
  const unchangedPaths: string[] = [];

  // Sorted, so two runs that produced the same set produce byte-identical
  // records — the property `execution/identity.ts` relies on downstream.
  const paths = [...new Set(input.changes.map((change) => change.path))].sort();

  for (const path of paths) {
    const [onDisk, atBase] = await Promise.all([
      input.workspace.read({ path, maxBytes: input.limits.maxBytesPerFile }),
      input.base.getTextFile(path, input.spec.repository.baseSha, input.limits.maxBytesPerFile),
    ]);

    const content = onDisk.kind === "content" ? onDisk.content : null;

    if (content === null) {
      // Nothing on disk. A deletion only if there was something to delete;
      // otherwise the agent wrote a file that is not there, which is not a
      // change and must not become one.
      if (atBase !== null) {
        files.push({
          path,
          content: null,
          baseContent: atBase,
          status: "deleted",
          bytes: 0,
          contentHash: null,
        });
      }
      continue;
    }

    if (atBase !== null && atBase === content) {
      unchangedPaths.push(path);
      continue;
    }

    files.push({
      path,
      content,
      baseContent: atBase,
      status: atBase === null ? "added" : "modified",
      bytes: Buffer.byteLength(content, "utf8"),
      contentHash: sha256(content),
    });
  }

  return {
    files,
    totalBytes: files.reduce((total, file) => total + file.bytes, 0),
    unchangedPaths,
  };
}

/* ---------------------------------------------------------------------------
 * Post-agent verification (§28)
 * ------------------------------------------------------------------------ */

/**
 * Everything §28 asks to be checked before a reviewable change exists.
 *
 * `acceptProposedChange` — written in Core-3, tested in Core-3, called here for
 * the first time — already covers forbidden paths, file count, diff size and
 * credential-shaped content. This adds the checks that only make sense once
 * there is a *run* to ask about: did the source stay pinned, did any policy
 * refusal actually stop something, and is there a change at all.
 */
export const CANDIDATE_REJECTIONS = [
  "no_files_produced",
  "forbidden_path",
  "too_many_files",
  "diff_too_large",
  "secret_material_introduced",
  /** The workspace was not, or is no longer, the pinned base commit (§8, §54). */
  "source_revision_unverified",
  /** A deletion outside what the policy permits. */
  "deletion_not_permitted",
] as const;
export type CandidateRejection = (typeof CANDIDATE_REJECTIONS)[number];

export type CandidateVerification =
  | {
      accepted: true;
      /** Exactly what will be written, in a stable order (§59). */
      files: readonly { path: string; content: string; contentHash: string; bytes: number }[];
      deletions: readonly string[];
    }
  | {
      accepted: false;
      rejections: readonly CandidateRejection[];
      violations: readonly WriteScopeViolation[];
    };

/**
 * Whether a candidate may enter the existing pipeline (§28, §29).
 *
 * Every rejection is collected rather than short-circuited, for the reason
 * `acceptProposedChange` documents: a run that failed three ways should be
 * reported as three problems, because fixing one and rediscovering the next is
 * how a repair loop burns a budget.
 *
 * ## Why deletions are refused in V1
 *
 * `workspace_delete_file` is a granted capability — the agent can delete inside
 * its own workspace, which is sometimes the right implementation. But the
 * *write path* to GitHub cannot express one: `github-writer.ts` builds a tree
 * additively from the base tree and its port has no operation that removes an
 * entry. So a candidate containing a deletion cannot be written faithfully, and
 * the honest answer is to refuse it rather than to silently write a change that
 * is missing part of what the agent did (§59's exactness requirement).
 *
 * That is a real limitation, recorded as one. Widening it means teaching the
 * git writer to remove tree entries, which is a change to the most consequential
 * write path in the product and belongs in its own sprint.
 */
export function verifyCandidateChange(input: {
  spec: ExecutionSpec;
  candidate: CandidateChange;
  /** Vibe's own observation that the workspace is the pinned commit (§8). */
  sourceRevisionVerified: boolean;
}): CandidateVerification {
  const rejections: CandidateRejection[] = [];
  let violations: readonly WriteScopeViolation[] = [];

  if (!input.sourceRevisionVerified) rejections.push("source_revision_unverified");

  const deletions = input.candidate.files.filter((file) => file.status === "deleted");
  if (deletions.length > 0) rejections.push("deletion_not_permitted");

  const writes = input.candidate.files.filter(
    (file): file is CandidateFile & { content: string; contentHash: string } =>
      file.content !== null && file.contentHash !== null,
  );

  // Re-checked here even though the gateway already refused these paths at
  // write time. Two independent refusals, for the same reason `isToolAllowed`
  // states its rule twice: this one holds even if the gateway is replaced.
  for (const file of writes) {
    if (!isAgenticWritablePath(file.path) && !rejections.includes("forbidden_path")) {
      rejections.push("forbidden_path");
    }
  }

  const accepted = acceptProposedChange(
    input.spec,
    writes.map((file) => ({ path: file.path, content: file.content })),
  );

  if (!accepted.accepted) {
    violations = accepted.violations;
    for (const rejection of accepted.rejections) {
      const mapped = rejection as ProposedChangeRejection & CandidateRejection;
      if (!rejections.includes(mapped)) rejections.push(mapped);
    }
  }

  if (rejections.length > 0) return { accepted: false, rejections, violations };

  return {
    accepted: true,
    files: writes
      .map((file) => ({
        path: file.path,
        content: file.content,
        contentHash: file.contentHash,
        bytes: file.bytes,
      }))
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
    deletions: [],
  };
}
