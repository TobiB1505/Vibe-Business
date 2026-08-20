import { describe, expect, it } from "vitest";
import { extractCandidateChange, verifyCandidateChange, type BaseContentPort } from "./candidate";
import {
  changeRejectionMetadata,
  classifyChangedPath,
  summarizeChangeEvidence,
  MAX_EVIDENCE_PATHS,
  MAX_EVIDENCE_PATH_LENGTH,
} from "./change-evidence";
import { fakeAgentLimits, fakeAgentSpec, fakeWorkspace } from "./test-support";

/**
 * Why a candidate change was the size it was.
 *
 * The first complete agent run was refused for `too_many_files` and
 * `diff_too_large`, and the audit trail recorded exactly those two strings. That
 * is enough to know the run failed and not enough to know whether the *budget*
 * is wrong or the *observation* is — two findings with opposite fixes and
 * identical audit rows.
 *
 * Everything below is about closing that gap without opening another: enough
 * detail to diagnose, no file contents, and a bound a hostile repository cannot
 * talk its way past.
 */

const LIMITS = fakeAgentLimits();

function base(files: Record<string, string>): BaseContentPort {
  return {
    async getTextFile(path: string) {
      return files[path] ?? null;
    },
  };
}

/** Fourteen paths, as the real run produced: some source, some build output. */
const SOURCE_PATHS = [
  "src/app/page.tsx",
  "src/app/about/page.tsx",
  "src/app/pricing/page.tsx",
  "src/app/robots.ts",
  "src/lib/metadata.ts",
];

const GENERATED_PATHS = [
  "tsconfig.tsbuildinfo",
  ".next/build-manifest.json",
  "coverage/lcov.info",
  "dist/index.js",
  ".turbo/turbo-build.log",
];

const RUNTIME_PATHS = ["debug.log", "tmp/scratch.txt", ".DS_Store", "server.pid"];

async function candidateOf(paths: readonly string[], contents: Record<string, string> = {}) {
  const files = Object.fromEntries(paths.map((path) => [path, contents[path] ?? `content of ${path}\n`]));
  const workspace = fakeWorkspace({ files });
  // Everything in the fixture workspace that is not part of this change would
  // otherwise be read back as an unrelated file; only the listed paths are asked
  // about, so the rest is irrelevant.

  return extractCandidateChange({
    spec: fakeAgentSpec(),
    changes: paths.map((path) => ({ path, content: null })),
    workspace,
    base: base({}),
    limits: LIMITS,
  });
}

describe("classifying what a path is", () => {
  it("separates generated artifacts from real source changes", () => {
    for (const path of SOURCE_PATHS) {
      expect(classifyChangedPath(path), path).toBe("source");
    }
    for (const path of GENERATED_PATHS) {
      expect(classifyChangedPath(path), path).toBe("generated");
    }
    for (const path of RUNTIME_PATHS) {
      expect(classifyChangedPath(path), path).toBe("runtime");
    }
  });

  /**
   * The class this run would have needed. `tsconfig.tsbuildinfo` is not in the
   * walk's prune list, is written by any `tsc` invocation, and is routinely
   * larger than the whole diff budget — so it can arrive in a candidate set on
   * its own and account for `diff_too_large` with no source change at all.
   */
  it("recognises the build artifacts the prune list does not cover", () => {
    expect(classifyChangedPath("tsconfig.tsbuildinfo")).toBe("generated");
    expect(classifyChangedPath("packages/web/tsconfig.tsbuildinfo")).toBe("generated");
    expect(classifyChangedPath(".cache/webpack/index.pack")).toBe("generated");
    expect(classifyChangedPath("pnpm-debug.log")).toBe("runtime");
  });

  /** An unrecognised file is `unknown`, never flattered into looking authored. */
  it("does not call an unrecognised file source", () => {
    expect(classifyChangedPath("Dockerfile")).toBe("unknown");
    expect(classifyChangedPath("bin/tool")).toBe("unknown");
  });

  /** A substring rule here would misclassify ordinary source. */
  it("anchors on segments rather than substrings", () => {
    expect(classifyChangedPath("src/lib/dist-helpers.ts")).toBe("source");
    expect(classifyChangedPath("src/next-build.ts")).toBe("source");
  });
});

describe("the evidence a rejected candidate records", () => {
  it("names the actual paths behind a fourteen-file refusal", async () => {
    const paths = [...SOURCE_PATHS, ...GENERATED_PATHS, ...RUNTIME_PATHS];
    expect(paths).toHaveLength(14);

    const candidate = await candidateOf(paths);
    const evidence = summarizeChangeEvidence({
      observedPaths: paths,
      candidate,
      detectedBy: "workspace_scan",
    });

    expect(evidence.observedPathCount).toBe(14);
    expect(evidence.truncated).toBe(false);
    expect(evidence.paths.map((entry) => entry.path).sort()).toEqual([...paths].sort());

    // The count that makes the difference between "the budget is too small" and
    // "the walk is too broad".
    expect(evidence.classCounts).toEqual({ source: 5, generated: 5, runtime: 4, unknown: 0 });
  });

  it("reports the biggest contributors to the diff size", async () => {
    const candidate = await candidateOf(["small.ts", "huge.ts", "medium.ts"], {
      "small.ts": "a".repeat(10),
      "medium.ts": "b".repeat(500),
      "huge.ts": "c".repeat(9000),
    });

    const evidence = summarizeChangeEvidence({
      observedPaths: ["small.ts", "huge.ts", "medium.ts"],
      candidate,
      detectedBy: "workspace_scan",
    });

    expect(evidence.largestChanges.map((entry) => entry.path)).toEqual([
      "huge.ts",
      "medium.ts",
      "small.ts",
    ]);
    expect(evidence.largestChanges[0].bytes).toBe(9000);
    expect(evidence.totalDiffBytes).toBe(9510);
  });

  /**
   * The gap between "observed" and "candidate" is itself a finding: a run whose
   * observation is mostly paths identical to the base has a detection problem,
   * and no budget change would help it.
   */
  it("distinguishes an observed path from one that is actually a change", async () => {
    const workspace = fakeWorkspace({ files: { "src/kept.ts": "same\n", "src/real.ts": "new\n" } });

    const candidate = await extractCandidateChange({
      spec: fakeAgentSpec(),
      changes: [
        { path: "src/kept.ts", content: null },
        { path: "src/real.ts", content: null },
        { path: "src/never-existed.ts", content: null },
      ],
      workspace,
      base: base({ "src/kept.ts": "same\n" }),
      limits: LIMITS,
    });

    const evidence = summarizeChangeEvidence({
      observedPaths: ["src/kept.ts", "src/real.ts", "src/never-existed.ts"],
      candidate,
      detectedBy: "workspace_scan",
    });

    expect(evidence.observedPathCount).toBe(3);
    expect(evidence.candidateFileCount).toBe(1);
    expect(evidence.unchangedPathCount).toBe(1);
    expect(evidence.absentPathCount).toBe(1);

    const statuses = Object.fromEntries(evidence.paths.map((entry) => [entry.path, entry.status]));
    expect(statuses).toEqual({
      "src/kept.ts": "unchanged",
      "src/real.ts": "added",
      "src/never-existed.ts": "absent",
    });
  });

  it("records which topology produced the paths", async () => {
    const candidate = await candidateOf(["src/a.ts"]);

    const brokered = summarizeChangeEvidence({
      observedPaths: ["src/a.ts"],
      candidate,
      detectedBy: "gateway_tool_trail",
    });

    expect(brokered.paths[0].detectedBy).toBe("gateway_tool_trail");
  });
});

describe("what the evidence must never contain", () => {
  /**
   * Rule 26. A payload detailed enough to reconstruct a customer's files is a
   * copy of their repository under a different name.
   */
  it("carries no file contents, at any depth", async () => {
    const secret = "SUPER_SECRET_BODY_TEXT";
    const candidate = await candidateOf(["src/a.ts", "src/b.ts"], {
      "src/a.ts": `${secret}\n`,
      "src/b.ts": `${secret}\n`,
    });

    const verification = verifyCandidateChange({
      spec: fakeAgentSpec(),
      candidate,
      sourceRevisionVerified: true,
    });
    const rejections = verification.accepted ? [] : verification.rejections;
    const violations = verification.accepted ? [] : verification.violations;

    const metadata = changeRejectionMetadata({
      evidence: summarizeChangeEvidence({
        observedPaths: ["src/a.ts", "src/b.ts"],
        candidate,
        detectedBy: "workspace_scan",
      }),
      rejections,
      violations,
    });

    const serialized = JSON.stringify(metadata);
    expect(serialized).not.toContain(secret);
    // Nor a hash of it — a content hash is a fingerprint of the bytes, and it is
    // not needed to explain why a change was too big.
    expect(serialized).not.toMatch(/[0-9a-f]{64}/);
  });
});

describe("bounded, because a repository is untrusted input", () => {
  it("caps how many paths it names and says that it did", async () => {
    const paths = Array.from({ length: MAX_EVIDENCE_PATHS + 37 }, (_, index) =>
      `src/generated/file-${String(index).padStart(4, "0")}.ts`,
    );
    const candidate = await candidateOf(paths);

    const evidence = summarizeChangeEvidence({
      observedPaths: paths,
      candidate,
      detectedBy: "workspace_scan",
    });

    expect(evidence.paths).toHaveLength(MAX_EVIDENCE_PATHS);
    expect(evidence.truncated).toBe(true);

    // The totals stay true even when the list does not — a truncated list whose
    // counts also shrank would understate the problem it exists to describe.
    expect(evidence.observedPathCount).toBe(paths.length);
    expect(evidence.classCounts.source).toBe(paths.length);
  });

  it("caps the length of a single path", async () => {
    const long = `src/${"a".repeat(4000)}.ts`;
    const candidate = await candidateOf([long]);

    const evidence = summarizeChangeEvidence({
      observedPaths: [long],
      candidate,
      detectedBy: "workspace_scan",
    });

    expect(evidence.paths[0].path.length).toBeLessThanOrEqual(MAX_EVIDENCE_PATH_LENGTH + 1);
    expect(evidence.paths[0].path.endsWith("…")).toBe(true);
  });

  /** Same run, same record: the cap is deterministic, never a sample. */
  it("names the same subset every time", async () => {
    const paths = Array.from({ length: MAX_EVIDENCE_PATHS + 5 }, (_, index) => `src/f-${index}.ts`);
    const candidate = await candidateOf(paths);

    const first = summarizeChangeEvidence({
      observedPaths: paths,
      candidate,
      detectedBy: "workspace_scan",
    });
    const second = summarizeChangeEvidence({
      observedPaths: [...paths].reverse(),
      candidate,
      detectedBy: "workspace_scan",
    });

    expect(second.paths).toEqual(first.paths);
  });
});

describe("verification is unchanged", () => {
  /**
   * The whole point of this change is that it observes. A candidate that was
   * refused before must be refused now, for the same reasons, with the same
   * measured numbers — the evidence rides alongside the verdict rather than
   * participating in it.
   */
  it("still refuses the same candidate for the same reasons", async () => {
    const spec = fakeAgentSpec();
    const overBudget = Array.from({ length: 20 }, (_, index) => `src/f-${index}.ts`);
    const candidate = await candidateOf(overBudget, {
      // Three files under the per-file read bound that together exceed the
      // diff bound, so the refusal is about the change's size rather than about
      // one file being unreadable.
      "src/f-0.ts": "x".repeat(90_000),
      "src/f-1.ts": "y".repeat(90_000),
      "src/f-2.ts": "z".repeat(90_000),
    });

    const verification = verifyCandidateChange({ spec, candidate, sourceRevisionVerified: true });

    expect(verification.accepted).toBe(false);
    if (verification.accepted) return;

    expect([...verification.rejections].sort()).toEqual(["diff_too_large", "too_many_files"]);

    const metadata = changeRejectionMetadata({
      evidence: summarizeChangeEvidence({
        observedPaths: overBudget,
        candidate,
        detectedBy: "workspace_scan",
      }),
      rejections: verification.rejections,
      violations: verification.violations,
    });

    // The limit the change was measured against, recorded rather than dropped.
    expect(metadata.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "too_many_files", changed: 20, limit: 15 }),
        expect.objectContaining({ kind: "diff_too_large", limit: 200_000 }),
      ]),
    );
    expect(metadata.rejections).toEqual([...verification.rejections]);
  });

  it("accepts what it accepted before, and still records evidence for it", async () => {
    const candidate = await candidateOf(["src/app/robots.ts"]);
    const verification = verifyCandidateChange({
      spec: fakeAgentSpec(),
      candidate,
      sourceRevisionVerified: true,
    });

    expect(verification.accepted).toBe(true);

    const evidence = summarizeChangeEvidence({
      observedPaths: ["src/app/robots.ts"],
      candidate,
      detectedBy: "workspace_scan",
    });
    expect(evidence.candidateFileCount).toBe(1);
    expect(evidence.classCounts.source).toBe(1);
  });
});
