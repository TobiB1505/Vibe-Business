import { describe, expect, it } from "vitest";
import {
  extractCandidateChange,
  verifyCandidateChange,
  type BaseContentPort,
  type BaseTreePort,
} from "./candidate";
import { summarizeChangeEvidence } from "./change-evidence";
import { createBaseIgnorePort } from "./ignored-paths";
import { deriveAgentLimits, CORE4_DOGFOOD_DISCOVERY } from "./budget";
import { fakeAgentSpec, fakeWorkspace } from "./test-support";

/**
 * Run `b33635a1`, reproduced exactly.
 *
 * The real run edited six files — four auth pages and two layouts, 11 814 bytes
 * in total — and was refused for `too_many_files` and `diff_too_large`. Twelve
 * of its eighteen observed paths were produced by its own check runs, and they
 * accounted for 999 994 of the 1 012 096 bytes measured.
 *
 * Every path, byte count and rule below is taken from that run's audit record.
 * The property under test is the whole point of the change: the candidate
 * shrinks to the six authored files while the other twelve stay fully visible
 * in the evidence, and no budget moves.
 */

/**
 * The real dogfood write scope: eight files, 60 KB. Not the fixture's looser
 * one — the whole question is whether the authored change fits *this* policy,
 * and no number in it moves in this sprint.
 */
const DOGFOOD_SCOPE = {
  discovery: CORE4_DOGFOOD_DISCOVERY,
  mutation: { maxChangedFiles: 8, maxChangedBytes: 61_440, forbiddenPathClasses: [] },
} as const;

const SPEC = fakeAgentSpec({ writeScope: DOGFOOD_SCOPE });
const LIMITS = deriveAgentLimits({ budget: SPEC.budget!, policy: SPEC.policy });
const BASE_SHA = SPEC.repository.baseSha;

/** The six files the agent actually edited, with the bytes it left behind. */
const AUTHORED: Record<string, number> = {
  "src/app/login/page.tsx": 3055,
  "src/app/signup/page.tsx": 2510,
  "src/app/reset-password/page.tsx": 2109,
  "src/app/forgot-password/page.tsx": 1818,
  "src/app/layout.tsx": 1438,
  "src/app/app/layout.tsx": 884,
};

/** Everything the run's own typecheck and build wrote into the workspace. */
const GENERATED: Record<string, number> = {
  ".swc/plugins/linux_x86_64_22.0.1/6ea9d3dec20e87696401db15d4c456817f842cb.wasmer-v7": 421_212,
  "src/app/.well-known/workflow/v1/flow/route.js": 262_145,
  "src/app/.well-known/workflow/v1/step/route.js": 262_145,
  "src/app/.well-known/workflow/v1/manifest.json": 48_387,
  "src/app/.well-known/workflow/v1/step/route.js.debug.json": 3105,
  "src/app/.well-known/workflow/v1/flow/route.js.debug.json": 1578,
  "src/app/.well-known/workflow/v1/webhook/[token]/route.js": 877,
  "src/app/.well-known/workflow/v1/config.json": 542,
  ".swc/.gitignore": 2,
  "src/app/.well-known/workflow/v1/.gitignore": 1,
  "next-env.d.ts": 288,
  "tsconfig.tsbuildinfo": 512,
};

/** This repository's `.gitignore`, at the commit the run was pinned to. */
const GITIGNORE = [
  "/node_modules",
  "/coverage",
  "/.next/",
  "/out/",
  "/build",
  ".DS_Store",
  "*.tsbuildinfo",
  "next-env.d.ts",
  "/.swc",
  "src/app/.well-known/workflow/",
].join("\n");

/** What the repository contained before the run. The six pages, and the rules. */
const BASE_FILES: Record<string, string> = {
  ...Object.fromEntries(Object.keys(AUTHORED).map((path) => [path, `original ${path}\n`])),
  ".gitignore": GITIGNORE,
};

const base: BaseContentPort = {
  async getTextFile(path: string, commitSha: string) {
    // Every read is against the pinned commit, never a moving reference.
    expect(commitSha).toBe(BASE_SHA);
    return BASE_FILES[path] ?? null;
  },
};

const baseTree: BaseTreePort = {
  async getTree() {
    return {
      entries: Object.keys(BASE_FILES).map((path) => ({ path, type: "blob" as const })),
      truncated: false,
    };
  },
};

/** The workspace as the agent left it: edited pages plus generated output. */
function workspaceAfterTheRun() {
  return fakeWorkspace({
    files: {
      ...Object.fromEntries(
        Object.entries(AUTHORED).map(([path, bytes]) => [path, "e".repeat(bytes)]),
      ),
      ...Object.fromEntries(
        Object.entries(GENERATED).map(([path, bytes]) => [path, "g".repeat(bytes)]),
      ),
    },
  });
}

const OBSERVED = [...Object.keys(AUTHORED), ...Object.keys(GENERATED)];

async function extract(options: { withIgnoreRules: boolean }) {
  return extractCandidateChange({
    spec: SPEC,
    changes: OBSERVED.map((path) => ({ path, content: null })),
    workspace: workspaceAfterTheRun(),
    base,
    limits: LIMITS,
    tree: baseTree,
    ignore: options.withIgnoreRules
      ? createBaseIgnorePort({ base, baseSha: BASE_SHA })
      : null,
  });
}

describe("run b33635a1, before the fix", () => {
  /**
   * The baseline this test file exists to move. Kept so the reproduction is
   * demonstrably of the real failure rather than of a convenient one.
   */
  it("was refused for both limits, and for bytes nobody authored", async () => {
    const candidate = await extract({ withIgnoreRules: false });

    // Sixteen of the eighteen become files; the two 262 145-byte route bundles
    // exceed the per-file read bound and are `unreadablePaths` instead — which
    // is itself part of the repair, since the real run recorded them as
    // complete additions after truncating them.
    expect(candidate.files.length).toBeGreaterThan(DOGFOOD_SCOPE.mutation.maxChangedFiles);
    expect(candidate.totalBytes).toBeGreaterThan(DOGFOOD_SCOPE.mutation.maxChangedBytes);

    // And the authored six are a small minority of it. The real run measured
    // 1.2%; here it is higher only because the two oversized route bundles now
    // drop out as unreadable instead of being counted at their truncated size.
    const authoredBytes = Object.values(AUTHORED).reduce((total, bytes) => total + bytes, 0);
    expect(authoredBytes).toBe(11_814);
    expect(authoredBytes / candidate.totalBytes).toBeLessThan(0.2);

    const verification = verifyCandidateChange({
      spec: SPEC,
      candidate,
      sourceRevisionVerified: true,
    });

    expect(verification.accepted).toBe(false);
    if (verification.accepted) return;
    expect(verification.rejections).toContain("too_many_files");
    expect(verification.rejections).toContain("diff_too_large");
  });
});

describe("run b33635a1, with the repository's own rules applied", () => {
  it("keeps exactly the six files the agent authored", async () => {
    const candidate = await extract({ withIgnoreRules: true });

    expect(candidate.files.map((file) => file.path).sort()).toEqual(
      Object.keys(AUTHORED).sort(),
    );
    expect(candidate.files.every((file) => file.status === "modified")).toBe(true);
    expect(candidate.totalBytes).toBe(
      Object.values(AUTHORED).reduce((total, bytes) => total + bytes, 0),
    );
  });

  /**
   * The measurement that decides the sprint. Six files against a ceiling of
   * eight, 11 814 bytes against 61 440 — the change the agent set out to make
   * was always inside the budget it was given.
   */
  it("comes in under the unchanged 8-file and 60-KB policy", async () => {
    const candidate = await extract({ withIgnoreRules: true });

    const scope = SPEC.policy.writeScope.mutation;
    expect(scope.maxChangedFiles).toBe(8);
    expect(scope.maxChangedBytes).toBe(61_440);

    expect(candidate.files.length).toBeLessThanOrEqual(scope.maxChangedFiles);
    expect(candidate.totalBytes).toBeLessThanOrEqual(scope.maxChangedBytes);

    const verification = verifyCandidateChange({
      spec: SPEC,
      candidate,
      sourceRevisionVerified: true,
    });
    expect(verification.accepted).toBe(true);
  });

  it("withholds all twelve generated paths, and no others", async () => {
    const candidate = await extract({ withIgnoreRules: true });

    expect(candidate.ignoredPaths.map((entry) => entry.path).sort()).toEqual(
      Object.keys(GENERATED).sort(),
    );
  });

  /**
   * Suppressed is not invisible. A filter whose decisions cannot be read back
   * is indistinguishable from a blind spot, and this run is exactly the case
   * where somebody will need to ask what happened to a file.
   */
  it("still names every withheld path in the evidence, with its rule", async () => {
    const candidate = await extract({ withIgnoreRules: true });
    const evidence = summarizeChangeEvidence({
      observedPaths: OBSERVED,
      candidate,
      detectedBy: "workspace_scan",
    });

    expect(evidence.observedPathCount).toBe(18);
    expect(evidence.candidateFileCount).toBe(6);
    expect(evidence.ignoredPathCount).toBe(12);
    expect(evidence.truncated).toBe(false);

    // Every observed path is present, whether it became a change or not.
    expect(evidence.paths.map((entry) => entry.path).sort()).toEqual([...OBSERVED].sort());

    const withheld = new Map(
      evidence.paths
        .filter((entry) => entry.status === "observed_ignored")
        .map((entry) => [entry.path, entry.ignoredBy]),
    );

    expect(withheld.get("src/app/.well-known/workflow/v1/step/route.js")).toEqual({
      reason: "base_gitignore",
      rule: "src/app/.well-known/workflow/",
    });
    expect(withheld.get(".swc/.gitignore")).toEqual({
      reason: "base_gitignore",
      rule: "/.swc",
    });
    expect(withheld.get("tsconfig.tsbuildinfo")).toEqual({
      reason: "base_gitignore",
      rule: "*.tsbuildinfo",
    });
  });
});

describe("what a .gitignore may never do", () => {
  /**
   * The rule that makes reading untrusted repository content safe here. A file
   * the base commit tracks is source by the repository's own history, and no
   * pattern may take it out of a change.
   */
  it("never withholds a path the base commit tracks", async () => {
    const tracked = "src/app/.well-known/workflow/v1/step/route.js";

    const candidate = await extractCandidateChange({
      spec: SPEC,
      changes: [{ path: tracked, content: null }],
      workspace: fakeWorkspace({ files: { [tracked]: "edited by the agent\n" } }),
      base: {
        async getTextFile(path: string) {
          // Same ignore rules — and this time the repository also *contains*
          // the file they cover.
          if (path === tracked) return "committed after all\n";
          return BASE_FILES[path] ?? null;
        },
      },
      limits: LIMITS,
      tree: {
        async getTree() {
          return {
            entries: [...Object.keys(BASE_FILES), tracked].map((path) => ({
              path,
              type: "blob" as const,
            })),
            truncated: false,
          };
        },
      },
      ignore: createBaseIgnorePort({ base, baseSha: BASE_SHA }),
    });

    expect(candidate.ignoredPaths).toEqual([]);
    expect(candidate.files.map((file) => file.path)).toEqual([tracked]);
  });

  /**
   * A tree Vibe could not enumerate is not evidence that anything is untracked.
   * Without that answer, nothing at all may be withheld.
   */
  it("withholds nothing when the base tree was truncated", async () => {
    const candidate = await extractCandidateChange({
      spec: SPEC,
      changes: OBSERVED.map((path) => ({ path, content: null })),
      workspace: workspaceAfterTheRun(),
      base,
      limits: LIMITS,
      tree: {
        async getTree() {
          return { entries: [], truncated: true };
        },
      },
      ignore: createBaseIgnorePort({ base, baseSha: BASE_SHA }),
    });

    expect(candidate.ignoredPaths).toEqual([]);
    expect(candidate.files.length + candidate.unreadablePaths.length).toBe(18);
  });

  it("withholds nothing when no tracked-path answer is available at all", async () => {
    const candidate = await extractCandidateChange({
      spec: SPEC,
      changes: OBSERVED.map((path) => ({ path, content: null })),
      workspace: workspaceAfterTheRun(),
      base,
      limits: LIMITS,
      tree: null,
      ignore: createBaseIgnorePort({ base, baseSha: BASE_SHA }),
    });

    expect(candidate.ignoredPaths).toEqual([]);
    expect(candidate.files.length + candidate.unreadablePaths.length).toBe(18);
  });
});

describe("a file that exists but cannot be read", () => {
  /**
   * The defect this separates out. `too_large` and `absent` both used to mean
   * "no content", and "no content plus something at the base" is exactly how a
   * *deletion* is recognised — so an oversized file the agent never removed
   * could be reported as the agent removing a repository file.
   */
  it("is never reported as a deletion", async () => {
    const oversized = "src/app/huge.tsx";

    const candidate = await extractCandidateChange({
      spec: SPEC,
      changes: [{ path: oversized, content: null }],
      workspace: fakeWorkspace({
        files: { [oversized]: "x".repeat(LIMITS.maxBytesPerFile + 1024) },
      }),
      base: {
        async getTextFile(path: string) {
          return path === oversized ? "small original\n" : null;
        },
      },
      limits: LIMITS,
    });

    expect(candidate.files).toEqual([]);
    expect(candidate.unreadablePaths).toEqual([oversized]);
  });

  /** And it is refused rather than quietly dropped from the change. */
  it("makes the change unrepresentable rather than partial", async () => {
    const oversized = "src/app/huge.tsx";

    const candidate = await extractCandidateChange({
      spec: SPEC,
      changes: [
        { path: oversized, content: null },
        { path: "src/app/small.tsx", content: null },
      ],
      workspace: fakeWorkspace({
        files: {
          [oversized]: "x".repeat(LIMITS.maxBytesPerFile + 1024),
          "src/app/small.tsx": "export const x = 1;\n",
        },
      }),
      base: { async getTextFile() { return null; } },
      limits: LIMITS,
    });

    const verification = verifyCandidateChange({
      spec: SPEC,
      candidate,
      sourceRevisionVerified: true,
    });

    expect(verification.accepted).toBe(false);
    if (verification.accepted) return;
    expect(verification.rejections).toContain("change_not_representable");
  });

  it("appears in the evidence as unreadable, not as absent", async () => {
    const oversized = "src/app/huge.tsx";

    const candidate = await extractCandidateChange({
      spec: SPEC,
      changes: [{ path: oversized, content: null }],
      workspace: fakeWorkspace({
        files: { [oversized]: "x".repeat(LIMITS.maxBytesPerFile + 1024) },
      }),
      base: { async getTextFile() { return null; } },
      limits: LIMITS,
    });

    const evidence = summarizeChangeEvidence({
      observedPaths: [oversized],
      candidate,
      detectedBy: "workspace_scan",
    });

    expect(evidence.unreadablePathCount).toBe(1);
    expect(evidence.absentPathCount).toBe(0);
    expect(evidence.paths[0].status).toBe("unreadable");
  });
});
