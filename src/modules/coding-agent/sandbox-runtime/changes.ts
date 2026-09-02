import "server-only";

import type { SandboxHandle } from "@/modules/validation/sandbox-port";
import { writeSandboxTextFile } from "./files";

/**
 * What the run changed, established by Vibe looking (Rule 77).
 *
 * ## Why this file exists at all
 *
 * Because moving the harness into the sandbox moved the writes with it. In the
 * in-process topology every write was brokered by the tool gateway, so the
 * gateway's own record answered "which paths" — an authoritative answer,
 * because there was no other door.
 *
 * The agent now edits files itself, with the harness's built-in tools, inside
 * an isolated VM. There is no broker to ask. So the answer comes from the only
 * other source that is not the model: the filesystem, observed by Vibe's own
 * commands, before and after.
 *
 * ```
 * before   the file list, taken after install and before the first turn
 * after    the file list, plus everything modified since the marker
 * added    in after, not in before
 * deleted  in before, not in after
 * modified in both, and newer than the marker
 * ```
 *
 * That is strictly *more* trustworthy than the previous source, not less: the
 * gateway recorded what it was asked to do, and this records what is actually
 * there. A file the agent wrote through a shell command, a file a test run
 * regenerated, a file written and then deleted — none of those were visible to
 * the gateway's record, and all of them are visible here.
 *
 * What is never consulted is the agent's account of its own work. There is no
 * field for it in the runtime protocol and no call to read one here.
 *
 * ## Bounded, like every other repository read (Rule 27)
 *
 * `node_modules`, `.git` and build output are pruned rather than filtered, so
 * the walk does not descend into them at all — an install tree is hundreds of
 * thousands of files and walking it would be the unbounded crawl Rule 27
 * forbids. A listing that reaches the cap is reported as truncated rather than
 * silently shortened: an incomplete change set presented as complete is how a
 * PreparedChange comes to be missing a file nobody noticed.
 */

/** Directories never walked. Pruned by name, at any depth. */
const PRUNED_DIRECTORIES: readonly string[] = [
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  ".turbo",
  ".vercel",
  "coverage",
];

/**
 * The most paths a workspace listing may carry.
 *
 * Generous enough for any repository Vibe supports and small enough that a
 * pathological tree degrades to `truncated` instead of filling this process's
 * memory with somebody else's file names.
 */
export const MAX_WORKSPACE_PATHS = 20_000;

/** How long one listing may take. A walk of a pruned tree, not a build. */
const LISTING_TIMEOUT_MS = 60_000;

export type WorkspaceListing = {
  paths: ReadonlySet<string>;
  /** True when the cap was reached, so the listing is known incomplete. */
  truncated: boolean;
};

export type WorkspaceChanges = {
  /** Repository-relative, sorted, deduplicated. */
  paths: readonly string[];
  /**
   * True when any input listing was truncated.
   *
   * The caller must refuse to prepare a change from a truncated observation.
   * "We found these files" and "these are the files" are different claims, and
   * only the second may become a diff a person is asked to approve.
   */
  truncated: boolean;
};

function pruneExpression(): string[] {
  // `\( -name a -o -name b \) -prune -o …` — the standard prune idiom, written
  // as an argument array so there is no shell to parse it.
  const names: string[] = [];
  for (const directory of PRUNED_DIRECTORIES) {
    if (names.length > 0) names.push("-o");
    names.push("-name", directory);
  }
  return ["(", ...names, ")", "-prune", "-o"];
}

/**
 * Splits a NUL-delimited listing (VB-029).
 *
 * A newline is not a delimiter, because a newline is a legal character in a
 * POSIX filename — everything but `/` and NUL is. Splitting on `\n` turned one
 * file called `a\nb` into two paths, `a` and `b`, and neither of them is a file
 * the agent touched. NUL is the one byte that cannot appear in a name, which is
 * why `find` offers it and why it is the only safe delimiter here.
 *
 * If the transport ever mangled NUL, the listing would fail to split and come
 * back as one enormous path or as nothing — both of which degrade to
 * `truncated`, which callers already refuse to prepare a change from. The
 * failure mode of that assumption being wrong is a refusal, not a wrong diff.
 *
 * Names are **not** trimmed. A leading or trailing space is part of the name,
 * and silently renaming a file to something the repository does not contain is
 * how a "change" ends up describing a path that is not there.
 */
function parsePaths(output: string): { paths: Set<string>; truncated: boolean } {
  const paths = new Set<string>();
  let truncated = false;

  for (const entry of output.split("\0")) {
    if (entry.length === 0) continue;
    if (paths.size >= MAX_WORKSPACE_PATHS) {
      truncated = true;
      break;
    }
    paths.add(entry);
  }

  return { paths, truncated };
}

/**
 * Lists every file in the workspace, pruned and bounded.
 *
 * A failed listing is `truncated: true` with no paths rather than an empty
 * success. The distinction matters: "the workspace is empty" and "we could not
 * look" lead to opposite decisions, and only one of them is safe to act on.
 */
export async function listWorkspaceFiles(input: {
  sandbox: SandboxHandle;
  /** The workspace, relative to the sandbox home. */
  cwd: string;
}): Promise<WorkspaceListing> {
  const result = await input.sandbox.run({
    /*
     * `-type f` is load-bearing, not tidiness (VB-029).
     *
     * It matches regular files and nothing else — so a symlink is never in this
     * listing, and `find` without `-L` does not descend through a symlinked
     * directory either. That is what keeps a link the agent created out of the
     * observed set entirely, rather than being caught later by a read that
     * would already have followed it.
     *
     * `%P\\0` rather than `%P\\n`: see `parsePaths`. The escape is *two
     * characters* and belongs to `find`, which turns it into a NUL itself — not
     * to argv, which cannot carry one. Writing a real NUL here is how the whole
     * observation path died for four days: an argument list is a list of C
     * strings, so Node refuses to spawn at all, the provider reports the throw
     * as a failed command, and every run ended at its first listing as
     * `sandbox_lost`. The fake sandbox now refuses a NUL argument the same way,
     * so the next attempt fails in `pnpm test` instead of in production.
     */
    command: { command: "find", args: [".", ...pruneExpression(), "-type", "f", "-printf", "%P\\0"] },
    cwd: input.cwd,
    timeoutMs: LISTING_TIMEOUT_MS,
  });

  if (result.exitCode !== 0) return { paths: new Set(), truncated: true };

  const parsed = parsePaths(result.output);
  return { paths: parsed.paths, truncated: parsed.truncated };
}

/**
 * Takes the baseline listing and leaves it **in the sandbox**.
 *
 * ## Why it is written there rather than returned
 *
 * Because the step that takes it and the step that uses it are different
 * function invocations, minutes apart. The agent now runs detached, so nothing
 * in Vibe's memory survives from "before the first turn" to "after the last
 * one" — and a listing of twenty thousand paths is not something to carry
 * through a durable workflow's arguments either.
 *
 * The sandbox is the right home for it: it describes that filesystem, it dies
 * with it, and it is a listing this module already knows how to take.
 *
 * ## Why it does not build a shell line
 *
 * It used to, and that is what broke the first real run. `find … > path` was
 * assembled by joining `pruneExpression()`, whose tokens are written for an
 * *argument array* — so the bare `(` and `)` reached `sh -c` as unquoted shell
 * metacharacters, `find` never ran, and the workspace was reported unavailable
 * six seconds in.
 *
 * The repair is to remove the shell from the listing entirely rather than to
 * quote it correctly: the same `listWorkspaceFiles` the rest of this module
 * uses takes the listing over argv, and `writeSandboxTextFile` puts the bytes
 * down over stdin. Neither has a command line for a metacharacter to appear on.
 *
 * A truncated listing is refused rather than written. A baseline that is missing
 * files makes every one of them look newly added later, which is a worse outcome
 * than having no baseline at all.
 */
export async function captureWorkspaceBaseline(input: {
  sandbox: SandboxHandle;
  cwd: string;
  /** Absolute, outside the repository, so the baseline is never itself a change. */
  baselinePath: string;
}): Promise<boolean> {
  const listing = await listWorkspaceFiles({ sandbox: input.sandbox, cwd: input.cwd });
  if (listing.truncated) return false;

  return writeSandboxTextFile(input.sandbox, {
    path: input.baselinePath,
    // NUL-delimited, matching `parsePaths` — the file has to be written the
    // way it will be read, and a newline is a legal character in a name
    // (VB-029).
    content: [...listing.paths].sort().map((path) => `${path}\0`).join(""),
  });
}

/**
 * Reads the baseline back.
 *
 * A missing or unreadable baseline is `null`, never an empty listing. The two
 * lead to opposite conclusions — "the workspace started empty" would make every
 * file in the repository look newly added — and only one of them is safe.
 */
export async function readWorkspaceBaseline(input: {
  sandbox: SandboxHandle;
  baselinePath: string;
}): Promise<WorkspaceListing | null> {
  const content = await input.sandbox.readFile({
    path: input.baselinePath,
    // Generous: this is one short path per entry, and truncating it would
    // silently turn existing files into additions.
    maxBytes: 8 * 1024 * 1024,
  });

  if (content === null) return null;

  const parsed = parsePaths(content);
  return { paths: parsed.paths, truncated: parsed.truncated };
}

/**
 * Plants the marker every "has this changed" question is asked against.
 *
 * A file rather than a timestamp captured in this process, because the
 * comparison happens inside the sandbox and the two clocks are not the same
 * clock. `find -newer` compares two inodes on one filesystem, which is a
 * question with an unambiguous answer.
 *
 * It lives outside the repository, so the marker itself is never a change.
 */
export async function plantChangeMarker(input: {
  sandbox: SandboxHandle;
  /** Absolute path, outside the repository tree. */
  markerPath: string;
}): Promise<boolean> {
  const result = await input.sandbox.run({
    command: { command: "touch", args: ["--", input.markerPath] },
    cwd: ".",
    timeoutMs: 30_000,
  });

  return result.exitCode === 0;
}

/**
 * Everything that is not as it was.
 *
 * Deletions come from set difference and modifications from `-newer`, because
 * neither can be derived from the other: a deleted file has no mtime to compare
 * and a modified one never leaves the listing.
 */
export async function discoverWorkspaceChanges(input: {
  sandbox: SandboxHandle;
  cwd: string;
  before: WorkspaceListing;
  /** The marker planted before the first turn. Absolute. */
  markerPath: string;
}): Promise<WorkspaceChanges> {
  const after = await listWorkspaceFiles({ sandbox: input.sandbox, cwd: input.cwd });

  const modified = await input.sandbox.run({
    command: {
      command: "find",
      args: [
        ".",
        ...pruneExpression(),
        "-type",
        "f",
        "-newer",
        input.markerPath,
        "-printf",
        // NUL, for the same reason as the full listing above (VB-029) — and
        // written as the two-character escape for the reason recorded there.
        "%P\\0",
      ],
    },
    cwd: input.cwd,
    timeoutMs: LISTING_TIMEOUT_MS,
  });

  const touched =
    modified.exitCode === 0 ? parsePaths(modified.output) : { paths: new Set<string>(), truncated: true };

  const changed = new Set<string>();

  for (const path of after.paths) {
    // New, or present before and written since. A file that existed and was not
    // touched is not a change, however much the agent says it worked on it.
    if (!input.before.paths.has(path) || touched.paths.has(path)) changed.add(path);
  }

  for (const path of input.before.paths) {
    if (!after.paths.has(path)) changed.add(path);
  }

  return {
    // Sorted, so two runs that produced the same set produce byte-identical
    // records — the property `execution/identity.ts` depends on downstream.
    paths: [...changed].sort(),
    truncated: input.before.truncated || after.truncated || touched.truncated,
  };
}
