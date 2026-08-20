/**
 * Which observed paths were never part of the customer's source.
 *
 * ## The run this exists for
 *
 * Run `b33635a1` changed six files — four auth pages and two layouts — and was
 * refused for `too_many_files` and `diff_too_large`. The other twelve paths in
 * its candidate set were produced by the agent's own check runs:
 *
 * ```
 * .swc/plugins/…wasmer-v7                          421 212 B   SWC plugin cache
 * src/app/.well-known/workflow/v1/step/route.js    262 145 B   Workflow codegen
 * src/app/.well-known/workflow/v1/flow/route.js    262 145 B   Workflow codegen
 * …six more under .well-known/workflow/v1/          54 090 B
 * next-env.d.ts, tsconfig.tsbuildinfo                  288 B
 * ```
 *
 * Ninety-nine percent of the diff, and none of it authored. The repository
 * already says so: every one of those paths is matched by a rule in the base
 * commit's own `.gitignore`.
 *
 * ## Why the repository's own answer, rather than a longer list of names
 *
 * A name list is a rule written for one project's layout. It would have caught
 * `.swc/`, and it would not have caught `src/app/.well-known/workflow/v1/` —
 * generated code that lives inside a source directory, under names no generic
 * rule predicts. `.gitignore` is the customer's own declaration of what is not
 * theirs, per repository, maintained by them.
 *
 * That also makes the exclusion a correctness property rather than a budget
 * optimisation: a file the repository ignores was never source, so writing it
 * onto a branch would be wrong at any budget.
 *
 * ## Where it is applied, and where it is deliberately not
 *
 * At **candidate extraction**, never at observation. The workspace walk still
 * sees everything the agent touched and the evidence still names it — a filter
 * at the walk would make a mutation invisible, and an unobserved mutation is a
 * hole in the audit trail whatever the reason for it.
 *
 * ## The three rules that make a hostile `.gitignore` harmless
 *
 * `.gitignore` is repository content, so it is untrusted (Rule 25). It is read
 * as *pattern data*, never as instructions, and it is bounded by three
 * properties rather than by trust:
 *
 *  1. **It can only ever narrow.** There is no rule here that adds a path to a
 *     change, only ones that withhold it.
 *  2. **A tracked file is never asked about.** The caller consults this only for
 *     paths absent from the pinned base tree, so no `.gitignore` can suppress a
 *     file the repository actually contains.
 *  3. **It is read at the pinned base commit.** The agent had write access to
 *     the workspace for twenty minutes, including to `.gitignore`; the version
 *     consulted here is the one that existed before the run started and that the
 *     agent could not reach.
 *
 * The residual risk is a repository that ignores a file its own agent then
 * writes, so the change silently omits it. That produces an incomplete change a
 * human reviews and rejects — not a dangerous one — and it is visible in the
 * evidence as `observed-but-ignored` rather than absent from the record.
 */

/** How many `.gitignore` files one run may read. */
export const MAX_IGNORE_FILES = 32;

/** How large one `.gitignore` may be before it is skipped. */
export const MAX_IGNORE_BYTES = 64 * 1024;

/** How many rules one `.gitignore` may contribute. */
export const MAX_RULES_PER_FILE = 500;

/** How long one rule may be. A longer line is skipped, never truncated. */
const MAX_RULE_LENGTH = 200;

/** How many `**` a single rule may contain, so a built regex stays linear. */
const MAX_WILDCARD_SPANS = 4;

export type IgnoreDecision =
  | { ignored: false }
  | {
      ignored: true;
      /** Which authority withheld it. */
      reason: "base_gitignore" | "known_build_artifact";
      /** The rule that matched, for the evidence record. Never file content. */
      rule: string;
    };

/**
 * Answers "was this path ever the customer's source?" for one untracked path.
 *
 * Only ever asked about paths absent from the pinned base tree — that
 * precondition is the caller's, and it is what makes rule 2 above structural.
 */
export type CandidateIgnorePort = {
  classify(path: string): Promise<IgnoreDecision>;
};

/** Reads a file at an exact commit. The same shape `BaseContentPort` has. */
type BaseReader = {
  getTextFile(path: string, commitSha: string, maxBytes: number): Promise<string | null>;
};

/* ---------------------------------------------------------------------------
 * Defense in depth
 * ------------------------------------------------------------------------ */

/**
 * Artifacts refused even by a repository that never wrote a `.gitignore`.
 *
 * Second line, not first: the base `.gitignore` is the authority, and this is
 * what catches a project that has none, one whose ignore file was unreadable,
 * or a tool whose output postdates the rules. Every entry names output that no
 * package manager, compiler or bundler expects to be committed.
 *
 * These are subject to the same precondition as everything else here — a path
 * tracked at the base commit is never offered to them. A repository that
 * genuinely commits its `out/` directory is not overruled by this list.
 */
const KNOWN_BUILD_ARTIFACTS: readonly { rule: string; test: RegExp }[] = [
  { rule: ".swc/", test: /(^|\/)\.swc\// },
  { rule: ".cache/", test: /(^|\/)\.cache\// },
  { rule: "out/", test: /(^|\/)out\// },
  { rule: ".pnpm-store/", test: /(^|\/)\.pnpm-store\// },
  { rule: "*.tsbuildinfo", test: /\.tsbuildinfo$/ },
  { rule: "next-env.d.ts", test: /(^|\/)next-env\.d\.ts$/ },
];

export function matchesKnownBuildArtifact(path: string): { rule: string } | null {
  const normalized = normalize(path);
  const match = KNOWN_BUILD_ARTIFACTS.find((artifact) => artifact.test.test(normalized));
  return match ? { rule: match.rule } : null;
}

/* ---------------------------------------------------------------------------
 * `.gitignore`, as pattern data
 * ------------------------------------------------------------------------ */

type IgnoreRule = {
  negated: boolean;
  /** Trailing `/`: matches a directory, so only via an ancestor of a file. */
  directoryOnly: boolean;
  matcher: RegExp;
  /** The original line. Recorded in evidence so a decision can be explained. */
  source: string;
};

function normalize(path: string): string {
  return path.replace(/^\.\//, "").replace(/^\/+/, "");
}

function escapeRegex(character: string): string {
  return character.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * One `.gitignore` glob as a regular expression.
 *
 * A deliberate subset of git's syntax: `*`, `?` and `**` are honoured, and
 * bracket character classes are escaped to literals rather than translated.
 * Both choices err the same way — an unrecognised construct fails to match, and
 * a rule that fails to match leaves the path in the change. Being wrong towards
 * "this is a real change" is a rejected diff; being wrong the other way is a
 * silently dropped file.
 *
 * Escaping brackets also removes the only place a repository-supplied string
 * could reach the regex engine as syntax rather than as data.
 */
function globToRegex(glob: string, anchored: boolean): RegExp | null {
  if ((glob.match(/\*\*/g)?.length ?? 0) > MAX_WILDCARD_SPANS) return null;

  let pattern = "";
  let index = 0;

  while (index < glob.length) {
    const character = glob[index];

    if (character === "\\" && index + 1 < glob.length) {
      pattern += escapeRegex(glob[index + 1]);
      index += 2;
      continue;
    }

    if (character === "*") {
      if (glob[index + 1] === "*") {
        // `**/` spans any number of directories, including none.
        if (glob[index + 2] === "/") {
          pattern += "(?:[^/]+/)*";
          index += 3;
          continue;
        }
        pattern += "[\\s\\S]*";
        index += 2;
        continue;
      }
      pattern += "[^/]*";
      index += 1;
      continue;
    }

    if (character === "?") {
      pattern += "[^/]";
      index += 1;
      continue;
    }

    pattern += escapeRegex(character);
    index += 1;
  }

  try {
    return new RegExp(anchored ? `^${pattern}$` : `(?:^|/)${pattern}$`);
  } catch {
    return null;
  }
}

/**
 * Parses one `.gitignore`, relative to the directory it sits in.
 *
 * `baseDirectory` is prefixed onto anchored rules, which is what makes a nested
 * ignore file mean what git means by it: `src/.gitignore` containing `/build`
 * ignores `src/build`, not the repository root's.
 */
export function parseGitignore(content: string, baseDirectory = ""): IgnoreRule[] {
  const rules: IgnoreRule[] = [];
  const prefix = baseDirectory.length > 0 ? `${normalize(baseDirectory)}/` : "";

  for (const raw of content.split("\n")) {
    if (rules.length >= MAX_RULES_PER_FILE) break;

    const line = raw.replace(/\r$/, "").trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    if (line.length > MAX_RULE_LENGTH) continue;

    const negated = line.startsWith("!");
    let glob = negated ? line.slice(1) : line;
    if (glob.length === 0) continue;

    const directoryOnly = glob.endsWith("/");
    if (directoryOnly) glob = glob.slice(0, -1);
    if (glob.length === 0) continue;

    // git: a slash anywhere but the end anchors the pattern to this file's
    // directory. Without one it matches at any depth below it.
    const anchored = glob.includes("/");
    if (glob.startsWith("/")) glob = glob.slice(1);
    if (glob.length === 0) continue;

    const matcher = globToRegex(anchored ? `${prefix}${glob}` : glob, anchored);
    if (!matcher) continue;

    rules.push({ negated, directoryOnly, matcher, source: line });
  }

  return rules;
}

/** Every directory a path lives under, outermost first. */
function ancestorDirectories(path: string): string[] {
  const segments = normalize(path).split("/");
  const directories: string[] = [];
  for (let index = 1; index < segments.length; index += 1) {
    directories.push(segments.slice(0, index).join("/"));
  }
  return directories;
}

/**
 * The last rule in a set that applies to one file path — negations included.
 *
 * Last match wins, which is git's rule for negation, so a `!keep.log` after a
 * `*.log` must be *returned* rather than filtered out here: the caller composes
 * several rule sets and only the final survivor decides. Dropping negations at
 * this level would make a nested `.gitignore`'s re-inclusion invisible, which
 * is the one error direction that silently omits a real change.
 *
 * A directory-only rule is tested against the file's ancestors rather than the
 * file itself, so `src/app/.well-known/workflow/` withholds everything beneath
 * it.
 *
 * Deviates from git in one respect, recorded rather than hidden: git does not
 * re-include a file whose parent directory was excluded, and this does. That
 * deviation can only ever *keep* a path in a change, never drop one.
 */
export function lastMatchingRule(path: string, rules: readonly IgnoreRule[]): IgnoreRule | null {
  const normalized = normalize(path);
  const candidates = [...ancestorDirectories(normalized), normalized];

  let matched: IgnoreRule | null = null;

  for (const rule of rules) {
    const targets = rule.directoryOnly ? candidates.slice(0, -1) : candidates;
    if (targets.some((target) => rule.matcher.test(target))) {
      matched = rule;
    }
  }

  return matched;
}

/** Whether one rule set, on its own, withholds a path. */
export function isIgnoredByRules(path: string, rules: readonly IgnoreRule[]): boolean {
  const matched = lastMatchingRule(path, rules);
  return matched !== null && !matched.negated;
}

/**
 * The ignore rules as they stood at the pinned base commit.
 *
 * Reads lazily and memoizes: only the directories a queried path actually lives
 * under are fetched, so a change touching two files costs a handful of reads
 * rather than a repository crawl (Rule 27). A read that fails or blows a bound
 * contributes no rules — the path stays in the change, which is the safe
 * direction.
 */
export function createBaseIgnorePort(input: {
  base: BaseReader;
  baseSha: string;
  /** Called once per skipped ignore file, so a bound is visible rather than silent. */
  onSkipped?: (detail: { path: string; reason: "unreadable" | "budget" }) => void;
}): CandidateIgnorePort {
  const loaded = new Map<string, IgnoreRule[]>();
  let filesRead = 0;

  async function rulesFor(directory: string): Promise<IgnoreRule[]> {
    const cached = loaded.get(directory);
    if (cached) return cached;

    if (filesRead >= MAX_IGNORE_FILES) {
      input.onSkipped?.({ path: `${directory}/.gitignore`, reason: "budget" });
      loaded.set(directory, []);
      return [];
    }
    filesRead += 1;

    const path = directory.length > 0 ? `${directory}/.gitignore` : ".gitignore";

    let content: string | null = null;
    try {
      content = await input.base.getTextFile(path, input.baseSha, MAX_IGNORE_BYTES);
    } catch {
      // A read failure is not a reason to fail an execution, and it is not a
      // reason to guess either. No rules, so nothing is suppressed.
      input.onSkipped?.({ path, reason: "unreadable" });
      loaded.set(directory, []);
      return [];
    }

    const rules = content === null ? [] : parseGitignore(content, directory);
    loaded.set(directory, rules);
    return rules;
  }

  return {
    async classify(path: string): Promise<IgnoreDecision> {
      const normalized = normalize(path);

      const directories = ["", ...ancestorDirectories(normalized)];

      /*
       * Outermost first, so a nested rule is applied after — and therefore wins
       * over — one from a directory above it, which is git's precedence. A
       * negation is carried through as the surviving decision rather than
       * discarded, so `src/.gitignore` containing `!keep.log` really does undo
       * the root's `*.log`.
       */
      let decision: IgnoreRule | null = null;
      for (const directory of directories) {
        const matched = lastMatchingRule(normalized, await rulesFor(directory));
        if (matched) decision = matched;
      }

      if (decision && !decision.negated) {
        return { ignored: true, reason: "base_gitignore", rule: decision.source };
      }

      // An explicit re-inclusion beats the artifact list too: a repository that
      // says `!out/keep.js` has stated its intent, and this list is a fallback
      // for repositories that stated none.
      if (decision?.negated) return { ignored: false };

      const artifact = matchesKnownBuildArtifact(normalized);
      return artifact
        ? { ignored: true, reason: "known_build_artifact", rule: artifact.rule }
        : { ignored: false };
    },
  };
}
