import type { CandidateChange, CandidateRejection } from "./candidate";
import type { WriteScopeViolation } from "@/modules/execution-contract/policy";

/**
 * Why a candidate change looked the way it did — recorded as derived evidence.
 *
 * ## The question this exists to answer
 *
 * The first complete agent run produced fourteen changed files and more than
 * 60 KB, and was refused for both. The refusal was correct and the audit trail
 * said only `["too_many_files", "diff_too_large"]` — which is enough to know
 * the run failed and not enough to know *why the set was that big*. Two very
 * different findings produce identical audit rows:
 *
 *  - the agent genuinely edited fourteen source files, so the budget is wrong
 *    for this class of step; or
 *  - the observation swept up build output the prune list does not cover, so
 *    the *detection* is wrong and the budget is fine.
 *
 * Without the paths, choosing between those is guesswork. With them it is
 * reading.
 *
 * ## What is stored, and what is never stored
 *
 * Paths, byte counts, per-path status and a coarse artifact class. **No file
 * contents, no diffs, no excerpts, no base content** — Rule 26 forbids
 * persisting a copy of a customer's repository, and a sufficiently detailed
 * "evidence" payload is exactly that by another name. Every field here is a
 * measurement *about* a file, never any of it.
 *
 * ## Bounded, because a repository is untrusted input
 *
 * A hostile or merely enormous repository can present twenty thousand changed
 * paths with four-thousand-character names. The cap is deterministic — sorted,
 * then truncated — and truncation is *recorded* rather than silent, for the
 * same reason a truncated listing is: a bounded list presented as complete is
 * how an audit trail comes to lie.
 *
 * ## The classification is diagnostic, never a decision
 *
 * `artifactClass` colours a report. Nothing in the execution path branches on
 * it, no path is filtered by it, and no budget consults it. It exists so that a
 * person reading a rejection can tell "fourteen source files" from "three
 * source files and eleven pieces of build output" in one glance — and then
 * decide, with evidence, whether the prune rules or the budget is the thing to
 * change.
 */

/** How many paths one evidence payload may name. */
export const MAX_EVIDENCE_PATHS = 100;

/** How long one recorded path may be. Names are data, and data can be hostile. */
export const MAX_EVIDENCE_PATH_LENGTH = 200;

/** How many entries the size breakdown carries. */
export const MAX_LARGEST_CHANGES = 10;

export const CHANGE_ARTIFACT_CLASSES = ["source", "generated", "runtime", "unknown"] as const;
export type ChangeArtifactClass = (typeof CHANGE_ARTIFACT_CLASSES)[number];

/**
 * Where a path came from.
 *
 * Topology-level rather than per-path, because that is the provenance that
 * actually exists today: under `gateway_tools` every path is a write Vibe
 * brokered, and under `sandbox_workspace` every path comes from the filesystem
 * comparison. Within the workspace scan the three sources (new, deleted,
 * modified-since-marker) are collapsed into one set before they leave the
 * sandbox, so a per-path answer would have to be invented here — and inventing
 * provenance is worse than not having it.
 *
 * `status` below carries the per-path answer that *is* real, and it is the
 * stronger one: it is measured against the pinned base commit rather than
 * against an mtime.
 */
export type ChangeDetectionSource = "workspace_scan" | "gateway_tool_trail";

export type ChangedPathEvidence = {
  path: string;
  /**
   * What the path turned out to be, once read back and compared to the base.
   *
   * `unchanged` is a path the observation flagged that is byte-identical to the
   * base commit — a file the agent opened and rewrote, or one a tool touched
   * without editing. `absent` is a path that was observed and is no longer on
   * disk and did not exist at the base, so it is not a change at all. Both are
   * dropped from the candidate, and both are worth seeing: a run whose
   * observation is mostly `unchanged` has a detection problem, not a budget
   * problem.
   */
  status:
    | "added"
    | "modified"
    | "deleted"
    | "unchanged"
    | "absent"
    /** Present, and withheld from the change because it was never source. */
    | "ignored"
    /** Present, and larger than the read bound — so not representable. */
    | "unreadable";
  /** Bytes of the produced file. Zero for anything that is not a write. */
  bytes: number;
  artifactClass: ChangeArtifactClass;
  detectedBy: ChangeDetectionSource;
  /**
   * Why an `ignored` path was withheld, and by which rule.
   *
   * The whole reason suppression is safe to have at all: a filter whose
   * decisions cannot be read back is indistinguishable from a blind spot.
   */
  ignoredBy?: { reason: "base_gitignore" | "known_build_artifact"; rule: string };
};

export type ChangeEvidence = {
  /** Paths the observation reported — the number stored as `changed_file_count`. */
  observedPathCount: number;
  /** Paths that survived comparison with the base and would be written. */
  candidateFileCount: number;
  /** Observed paths that were byte-identical to the base. */
  unchangedPathCount: number;
  /** Observed paths that are neither on disk nor at the base. */
  absentPathCount: number;
  /** Observed paths withheld from the change. Observed, never invisible. */
  ignoredPathCount: number;
  /** Observed paths that exist and exceed the read bound. */
  unreadablePathCount: number;
  /** Bytes the candidate would write. The number `diff_too_large` is measured against. */
  totalDiffBytes: number;
  /** Counts by class, over every observed path — computed before truncation. */
  classCounts: Record<ChangeArtifactClass, number>;
  /** Sorted by path, then capped. */
  paths: readonly ChangedPathEvidence[];
  /** True when `paths` names fewer than `observedPathCount`. */
  truncated: boolean;
  /** The biggest contributors to `totalDiffBytes`, largest first. */
  largestChanges: readonly { path: string; bytes: number }[];
};

/*
 * Build output, by the names build tools actually use.
 *
 * Overlaps deliberately with `changes.ts`'s prune list: the prune list stops a
 * walk from descending, and this labels whatever arrived anyway. A path that is
 * pruned can still reach here under the other topology, and a class this list
 * covers but the prune list does not is precisely the finding worth surfacing.
 */
const GENERATED_PATTERNS: readonly RegExp[] = [
  /(^|\/)\.next\//,
  /(^|\/)node_modules\//,
  /(^|\/)dist\//,
  /(^|\/)build\//,
  /(^|\/)out\//,
  /(^|\/)coverage\//,
  /(^|\/)\.turbo\//,
  /(^|\/)\.vercel\//,
  /(^|\/)\.cache\//,
  /(^|\/)\.svelte-kit\//,
  /(^|\/)\.pnpm-store\//,
  /(^|\/)storybook-static\//,
  /\.tsbuildinfo$/,
  /(^|\/)\.eslintcache$/,
];

/** Written while something ran, and belonging to nobody's repository. */
const RUNTIME_PATTERNS: readonly RegExp[] = [
  /\.log$/,
  /(^|\/)tmp\//,
  /(^|\/)temp\//,
  /(^|\/)\.tmp\//,
  /(^|\/)\.DS_Store$/,
  /(^|\/)\.vibe-agent\//,
  /(^|\/)\.claude\//,
  /(^|\/)\.git\//,
  /\.pid$/,
  /\.lock$/,
];

/** Extensions a person writes by hand. Everything else is `unknown`, not source. */
const SOURCE_EXTENSIONS: readonly string[] = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".css",
  ".scss",
  ".sass",
  ".less",
  ".html",
  ".md",
  ".mdx",
  ".json",
  ".yml",
  ".yaml",
  ".toml",
  ".svg",
  ".txt",
  ".sql",
  ".sh",
  ".py",
  ".rb",
  ".go",
  ".rs",
];

/**
 * A coarse label, never a decision.
 *
 * Generated is checked before runtime, so `.next/trace` reads as build output
 * rather than as a log — the directory is the more useful fact about it. Source
 * is checked last and requires a known extension, so an unrecognised file is
 * `unknown` rather than being flattered into looking like something a person
 * wrote.
 */
export function classifyChangedPath(path: string): ChangeArtifactClass {
  const normalized = path.replace(/^\.\//, "").replace(/^\/+/, "");

  if (GENERATED_PATTERNS.some((pattern) => pattern.test(normalized))) return "generated";
  if (RUNTIME_PATTERNS.some((pattern) => pattern.test(normalized))) return "runtime";

  const lowered = normalized.toLowerCase();
  if (SOURCE_EXTENSIONS.some((extension) => lowered.endsWith(extension))) return "source";

  return "unknown";
}

/** Truncated from the end and marked, so a long name can never hide a short one. */
function boundPath(path: string): string {
  return path.length <= MAX_EVIDENCE_PATH_LENGTH
    ? path
    : `${path.slice(0, MAX_EVIDENCE_PATH_LENGTH)}…`;
}

/**
 * Everything a person needs to explain one candidate, and nothing more.
 *
 * `observedPaths` is what the detection produced; `candidate` is what survived
 * comparison with the base. Reporting both is the point — the gap between them
 * is the difference between "the agent changed a lot" and "the observation is
 * too broad", and only one of those is fixed by changing a budget.
 */
export function summarizeChangeEvidence(input: {
  observedPaths: readonly string[];
  candidate: CandidateChange;
  detectedBy: ChangeDetectionSource;
}): ChangeEvidence {
  const byPath = new Map(input.candidate.files.map((file) => [file.path, file]));
  const unchanged = new Set(input.candidate.unchangedPaths);
  const ignored = new Map(input.candidate.ignoredPaths.map((entry) => [entry.path, entry]));
  const unreadable = new Set(input.candidate.unreadablePaths);

  // Sorted before capping, so the same run always records the same subset.
  const observed = [...new Set(input.observedPaths)].sort();

  const classCounts: Record<ChangeArtifactClass, number> = {
    source: 0,
    generated: 0,
    runtime: 0,
    unknown: 0,
  };

  const entries: ChangedPathEvidence[] = [];
  let unchangedCount = 0;
  let absentCount = 0;
  let ignoredCount = 0;
  let unreadableCount = 0;

  for (const path of observed) {
    const artifactClass = classifyChangedPath(path);
    classCounts[artifactClass] += 1;

    const file = byPath.get(path);
    const withheld = ignored.get(path);
    const status: ChangedPathEvidence["status"] = file
      ? file.status
      : withheld
        ? "ignored"
        : unreadable.has(path)
          ? "unreadable"
          : unchanged.has(path)
            ? "unchanged"
            : "absent";

    if (status === "unchanged") unchangedCount += 1;
    if (status === "absent") absentCount += 1;
    if (status === "ignored") ignoredCount += 1;
    if (status === "unreadable") unreadableCount += 1;

    // Counted for every path, recorded for the first `MAX_EVIDENCE_PATHS` — so
    // the totals stay true even when the list does not.
    if (entries.length < MAX_EVIDENCE_PATHS) {
      entries.push({
        path: boundPath(path),
        status,
        bytes: file?.bytes ?? 0,
        artifactClass,
        detectedBy: input.detectedBy,
        ...(withheld
          ? { ignoredBy: { reason: withheld.reason, rule: boundPath(withheld.rule) } }
          : {}),
      });
    }
  }

  const largestChanges = [...input.candidate.files]
    .filter((file) => file.bytes > 0)
    .sort((a, b) => b.bytes - a.bytes || (a.path < b.path ? -1 : 1))
    .slice(0, MAX_LARGEST_CHANGES)
    .map((file) => ({ path: boundPath(file.path), bytes: file.bytes }));

  return {
    observedPathCount: observed.length,
    candidateFileCount: input.candidate.files.length,
    unchangedPathCount: unchangedCount,
    absentPathCount: absentCount,
    ignoredPathCount: ignoredCount,
    unreadablePathCount: unreadableCount,
    totalDiffBytes: input.candidate.totalBytes,
    classCounts,
    paths: entries,
    truncated: entries.length < observed.length,
    largestChanges,
  };
}

/**
 * The evidence, shaped for an audit row.
 *
 * A plain JSON object rather than the typed value, because `audit_events`
 * stores JSON and a structure that round-trips is one a later reader can query.
 * The rejection reasons and the scope violations travel with it: the violations
 * already carry the measured number *and* the limit it exceeded, which the
 * previous audit row dropped and which is half of "why".
 */
export function changeRejectionMetadata(input: {
  evidence: ChangeEvidence;
  rejections: readonly CandidateRejection[];
  violations: readonly WriteScopeViolation[];
}): Record<string, unknown> {
  return {
    rejections: [...input.rejections],
    violations: input.violations.map((violation) => ({ ...violation })),
    changedPathCount: input.evidence.observedPathCount,
    changedFileCount: input.evidence.candidateFileCount,
    unchangedPathCount: input.evidence.unchangedPathCount,
    absentPathCount: input.evidence.absentPathCount,
    ignoredPathCount: input.evidence.ignoredPathCount,
    unreadablePathCount: input.evidence.unreadablePathCount,
    totalDiffBytes: input.evidence.totalDiffBytes,
    classCounts: { ...input.evidence.classCounts },
    changedPaths: input.evidence.paths.map((entry) => ({ ...entry })),
    changedPathsTruncated: input.evidence.truncated,
    largestChanges: input.evidence.largestChanges.map((entry) => ({ ...entry })),
  };
}
