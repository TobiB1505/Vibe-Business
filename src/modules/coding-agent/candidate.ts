import { createHash } from "node:crypto";
import {
  acceptProposedChange,
  type ProposedChangeRejection,
} from "@/modules/execution-contract/proposed-change";
import type { WriteScopeViolation } from "@/modules/execution-contract/policy";
import { isAgenticWritablePath } from "@/modules/execution/paths";
import { countChangedLines } from "@/modules/execution/line-stats";
import type { ExecutionSpec } from "@/modules/execution-contract/spec";
import type { AgentRuntimeLimits } from "./budget";
import type { ObservedChange } from "./schema";
import type { CandidateIgnorePort } from "./ignored-paths";
import type { WorkspaceReader } from "./workspace";

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

/**
 * Which paths the repository actually contained at the pinned base commit.
 *
 * A separate question from "can this file be read", and the reason it needs its
 * own port: `getTextFile` returns `null` for a file that is absent, one that is
 * binary, one that exceeds the read bound and a directory alike. Deriving
 * "tracked" from it would let a large or binary file that the repository really
 * does contain be treated as untracked — and an untracked path is the only kind
 * a `.gitignore` is allowed to withhold.
 *
 * `truncated` is load-bearing. A tree Vibe could not enumerate completely does
 * not support the claim "this path is untracked", so a truncated tree suppresses
 * nothing at all.
 */
export type BaseTreePort = {
  getTree(commitSha: string): Promise<{
    entries: readonly { path: string; type: "blob" | "tree" }[];
    truncated: boolean;
  }>;
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

/** An observed path withheld from the change because it was never source. */
export type IgnoredCandidatePath = {
  path: string;
  reason: "base_gitignore" | "known_build_artifact";
  /** The rule that withheld it, so the decision can be explained. */
  rule: string;
};

export type CandidateChange = {
  files: readonly CandidateFile[];
  totalBytes: number;
  /** Paths the agent wrote that turned out to be identical to the base. */
  unchangedPaths: readonly string[];
  /**
   * Observed, present, and withheld — never silently dropped.
   *
   * These do not enter the PreparedChange and they do not count against any
   * budget, but they remain in the record. A mutation Vibe saw and chose not to
   * write is a thing a reader must be able to find; "we excluded it" and "we
   * never noticed it" are different statements about the same directory.
   */
  ignoredPaths: readonly IgnoredCandidatePath[];
  /**
   * Observed paths that exist but are larger than the read bound.
   *
   * Kept apart from absence deliberately. Collapsing the two made a file that is
   * merely too big to diff look like a *deletion*, because "nothing on disk plus
   * something at the base" is exactly how a deletion is recognised — so an
   * oversized build artifact could have been reported as the agent removing a
   * repository file.
   */
  unreadablePaths: readonly string[];
  /**
   * Observed paths the write policy forbids, refused **before** they were read
   * (VB-029).
   *
   * The policy used to be applied only in `verifyCandidateChange`, which runs
   * after this function has already pulled every observed path's bytes into
   * memory. So a path that could never legitimately be written — absolute,
   * traversing, `.env`, a lockfile, a workflow — was read first and refused
   * afterwards, and its contents had by then been in this process.
   *
   * Refusing first costs nothing and means the bytes are never fetched. The
   * paths are kept rather than dropped, because `verifyCandidateChange` still
   * has to turn them into a `forbidden_path` rejection: a run that tried to
   * write somewhere forbidden must not be recorded as one that changed nothing.
   */
  forbiddenPaths: readonly string[];
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
  changes: readonly ObservedChange[];
  workspace: WorkspaceReader;
  base: BaseContentPort;
  limits: AgentRuntimeLimits;
  /**
   * Which paths the repository contained at the base commit.
   *
   * Optional so the gateway-brokered topology, whose paths are Vibe's own
   * record of writes it authorized, needs no tree read. Absent means nothing is
   * withheld: without a tracked-path answer there is no safe way to tell a
   * generated artifact from a source file, and the safe default is to keep it.
   */
  tree?: BaseTreePort | null;
  /**
   * Consulted only for paths the base commit did not contain.
   *
   * That precondition is enforced below rather than assumed, because it is the
   * property that stops a `.gitignore` from ever hiding a real repository file.
   */
  ignore?: CandidateIgnorePort | null;
}): Promise<CandidateChange> {
  const files: CandidateFile[] = [];
  const unchangedPaths: string[] = [];
  const ignoredPaths: IgnoredCandidatePath[] = [];
  const unreadablePaths: string[] = [];
  const forbiddenPaths: string[] = [];

  // Sorted, so two runs that produced the same set produce byte-identical
  // records — the property `execution/identity.ts` relies on downstream.
  const observed = [...new Set(input.changes.map((change) => change.path))].sort();

  /*
   * The write policy, applied before a single byte is read (VB-029).
   *
   * `verifyCandidateChange` checks the same thing and keeps checking it — the
   * two-independent-refusals discipline this module already documents. What
   * changes here is only the *order*: that check used to run after the loop
   * below had read every observed path, so an absolute path, a `..`, an
   * `.env` or a workflow file was fetched into this process and refused
   * afterwards. The refusal was correct and the read had already happened.
   */
  const paths: string[] = [];
  for (const path of observed) {
    if (isAgenticWritablePath(path)) paths.push(path);
    else forbiddenPaths.push(path);
  }

  const tracked = await readTrackedPaths(input.tree ?? null, input.spec.repository.baseSha);

  for (const path of paths) {
    /*
     * Suppression, and the two conditions that gate it.
     *
     * `tracked === null` is a tree Vibe could not enumerate, which is not
     * evidence that anything is untracked — so nothing is withheld. And a path
     * the tree does contain is compared no matter what any ignore rule says: a
     * repository that both tracks and ignores a file has tracked it, and the
     * tracking is the fact about whether it is source.
     */
    if (input.ignore && tracked !== null && !tracked.has(path)) {
      const decision = await input.ignore.classify(path);
      if (decision.ignored) {
        ignoredPaths.push({ path, reason: decision.reason, rule: decision.rule });
        continue;
      }
    }

    const [onDisk, atBase] = await Promise.all([
      input.workspace.read({ path, maxBytes: input.limits.maxBytesPerFile }),
      input.base.getTextFile(path, input.spec.repository.baseSha, input.limits.maxBytesPerFile),
    ]);

    /*
     * Present but unreadable is its own answer.
     *
     * It cannot become a deletion — the file is right there — and it cannot
     * become a write, because there are no bytes to write. Recorded, and left
     * for `verifyCandidateChange` to refuse: a change Vibe cannot represent
     * exactly is one it must not represent approximately (§59).
     */
    if (onDisk.kind === "too_large") {
      unreadablePaths.push(path);
      continue;
    }

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
    ignoredPaths,
    unreadablePaths,
    forbiddenPaths,
  };
}

/**
 * The base commit's blob paths, or `null` when they cannot be established.
 *
 * `null` rather than an empty set, and the difference decides whether anything
 * is suppressed at all: an empty set would say "the repository contains no
 * files", which would make every path untracked and every ignore rule apply.
 */
async function readTrackedPaths(
  tree: BaseTreePort | null,
  baseSha: string,
): Promise<Set<string> | null> {
  if (!tree) return null;

  try {
    const result = await tree.getTree(baseSha);
    if (result.truncated) return null;

    return new Set(
      result.entries.filter((entry) => entry.type === "blob").map((entry) => entry.path),
    );
  } catch {
    // A tree read that failed is not a tree that is empty.
    return null;
  }
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
  /**
   * A file that exists but is too large to read back, so the change cannot be
   * stated exactly (§59).
   *
   * Refusing is the only honest option: writing the rest would present a
   * partial change as a complete one, and dropping it silently would hide a
   * mutation Vibe watched happen. Note that this is reached only for a path the
   * repository tracks or does not ignore — an oversized build artifact is
   * withheld earlier, with a rule recorded.
   */
  "change_not_representable",
] as const;
export type CandidateRejection = (typeof CANDIDATE_REJECTIONS)[number];

export type CandidateVerification =
  | {
      accepted: true;
      /**
       * Exactly what will be written, in a stable order (§59).
       *
       * `linesAdded`/`linesRemoved` are counted here rather than fetched later,
       * because this is the one place that holds both sides: the bytes read
       * back from the workspace and the baseline from the pinned commit (§77).
       * `null` for a file too large to compare inside the bound — absent, never
       * zero.
       */
      files: readonly {
        path: string;
        content: string;
        contentHash: string;
        bytes: number;
        linesAdded: number | null;
        linesRemoved: number | null;
      }[];
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

  if (input.candidate.unreadablePaths.length > 0) rejections.push("change_not_representable");

  const writes = input.candidate.files.filter(
    (file): file is CandidateFile & { content: string; contentHash: string } =>
      file.content !== null && file.contentHash !== null,
  );

  /*
   * A forbidden path is a rejection whether it was caught early or late.
   *
   * `extractCandidateChange` now refuses these before reading them (VB-029), so
   * in practice they arrive in `forbiddenPaths` and never as a file. The
   * per-file check stays anyway: it is the third of the independent refusals
   * this policy is checked by — the gateway at write time, extraction before
   * the read, and here immediately before the branch is written — and it is the
   * one that still holds if either of the other two is replaced.
   *
   * Either way the run is recorded as having tried to write somewhere
   * forbidden, which is the thing a reader must be able to find. Dropping the
   * paths silently would make it look like a run that changed nothing.
   */
  if (input.candidate.forbiddenPaths.length > 0) rejections.push("forbidden_path");

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
      .map((file) => {
        /* Both sides are in hand here and nowhere later, so the count happens
           here. A file past the bound reports nothing rather than a guess. */
        const stats = countChangedLines(file.baseContent, file.content);
        return {
          path: file.path,
          content: file.content,
          contentHash: file.contentHash,
          bytes: file.bytes,
          linesAdded: stats?.added ?? null,
          linesRemoved: stats?.removed ?? null,
        };
      })
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
    deletions: [],
  };
}
