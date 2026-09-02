import { describe, expect, it } from "vitest";
import {
  extractCandidateChange,
  sha256,
  verifyCandidateChange,
  type BaseContentPort,
} from "./candidate";
import { computeAgentChangeIdentity, computeCandidateDigest, computeAgentRunIdentity } from "./identity";
import { fakeAgentLimits, fakeAgentSpec, fakeWorkspace } from "./test-support";

/**
 * Candidate extraction and post-agent verification
 * (EXECUTION CORE-4 §27, §28, §59).
 *
 * §27's rule is the one these tests exist for:
 *
 * > Do not trust an Agent-written summary as the actual change.
 *
 * Nothing below consults an agent's report. The paths come from the gateway's
 * own record; the bytes come from the workspace; the baseline comes from the
 * pinned commit. Each of the three is something Vibe observed.
 */

function base(files: Record<string, string>): BaseContentPort {
  return {
    async getTextFile(path: string) {
      return files[path] ?? null;
    },
  };
}

const LIMITS = fakeAgentLimits();

describe("§27 — Vibe computes the change", () => {
  it("classifies added, modified and deleted from the base commit", async () => {
    const workspace = fakeWorkspace({
      files: {
        "src/existing.ts": "after\n",
        "src/new.ts": "brand new\n",
      },
    });
    workspace.files.delete("src/gone.ts");

    const candidate = await extractCandidateChange({
      spec: fakeAgentSpec(),
      changes: [
        { path: "src/existing.ts", content: null },
        { path: "src/new.ts", content: null },
        { path: "src/gone.ts", content: null },
      ],
      workspace,
      base: base({ "src/existing.ts": "before\n", "src/gone.ts": "doomed\n" }),
      limits: LIMITS,
    });

    expect(candidate.files.map((file) => [file.path, file.status])).toEqual([
      ["src/existing.ts", "modified"],
      ["src/gone.ts", "deleted"],
      ["src/new.ts", "added"],
    ]);
  });

  /*
   * VB-029 — the write policy runs before the read, not after it.
   *
   * `verifyCandidateChange` always refused these paths; it just refused them
   * once extraction had already pulled every observed path's bytes into this
   * process. The refusal was right and the read had happened.
   */
  describe("a path the policy forbids", () => {
    const forbidden = [
      "/etc/passwd",
      "../outside.ts",
      ".env",
      ".env.production",
      ".github/workflows/deploy.yml",
      "pnpm-lock.yaml",
      "supabase/migrations/0001_x.sql",
    ];

    it.each(forbidden)("never has its bytes read (%s)", async (path) => {
      const workspace = fakeWorkspace({ files: { [path]: "secret bytes\n" } });

      const candidate = await extractCandidateChange({
        spec: fakeAgentSpec(),
        changes: [{ path, content: null }],
        workspace,
        base: base({}),
        limits: LIMITS,
      });

      expect(workspace.readPaths).not.toContain(path);
      expect(candidate.files).toEqual([]);
      expect(candidate.forbiddenPaths).toEqual([path]);
    });

    /**
     * Kept, not dropped. A run that tried to write somewhere forbidden must
     * not be recorded as one that changed nothing — those are different
     * findings and only one of them is a safety event.
     */
    it("still becomes a refusal rather than an empty change", async () => {
      const workspace = fakeWorkspace({ files: { ".env": "KEY=1\n", "src/a.ts": "ok\n" } });

      const candidate = await extractCandidateChange({
        spec: fakeAgentSpec(),
        changes: [
          { path: ".env", content: null },
          { path: "src/a.ts", content: null },
        ],
        workspace,
        base: base({}),
        limits: LIMITS,
      });

      const verification = verifyCandidateChange({
        spec: fakeAgentSpec(),
        candidate,
        sourceRevisionVerified: true,
      });

      expect(verification.accepted).toBe(false);
      if (!verification.accepted) expect(verification.rejections).toContain("forbidden_path");
    });

    it("still reads the paths that are allowed", async () => {
      const workspace = fakeWorkspace({ files: { ".env": "KEY=1\n", "src/a.ts": "ok\n" } });

      await extractCandidateChange({
        spec: fakeAgentSpec(),
        changes: [
          { path: ".env", content: null },
          { path: "src/a.ts", content: null },
        ],
        workspace,
        base: base({}),
        limits: LIMITS,
      });

      expect(workspace.readPaths).toEqual(["src/a.ts"]);
    });
  });

  /**
   * A file written back byte-identical to its base is not a change.
   *
   * Without this, an agent that read a file and rewrote it unchanged would
   * produce a PreparedChange containing a no-op — a diff a human would be asked
   * to review for nothing.
   */
  it("drops a write that reproduced the base bytes exactly", async () => {
    const workspace = fakeWorkspace({ files: { "src/same.ts": "unchanged\n" } });

    const candidate = await extractCandidateChange({
      spec: fakeAgentSpec(),
      changes: [{ path: "src/same.ts", content: null }],
      workspace,
      base: base({ "src/same.ts": "unchanged\n" }),
      limits: LIMITS,
    });

    expect(candidate.files).toEqual([]);
    expect(candidate.unchangedPaths).toEqual(["src/same.ts"]);
  });

  /**
   * The agent said it wrote a file; the filesystem says otherwise. The
   * filesystem wins, and — since the file did not exist at the base either —
   * nothing at all is recorded.
   */
  it("records nothing for a write that never landed", async () => {
    const workspace = fakeWorkspace();
    workspace.files.delete("src/never.ts");

    const candidate = await extractCandidateChange({
      spec: fakeAgentSpec(),
      changes: [{ path: "src/never.ts", content: null }],
      workspace,
      base: base({}),
      limits: LIMITS,
    });

    expect(candidate.files).toEqual([]);
  });

  it("hashes what is on disk, not what was requested", async () => {
    const workspace = fakeWorkspace({ files: { "src/a.ts": "actual bytes\n" } });

    const candidate = await extractCandidateChange({
      spec: fakeAgentSpec(),
      changes: [{ path: "src/a.ts", content: "the agent claimed this instead" }],
      workspace,
      base: base({}),
      limits: LIMITS,
    });

    expect(candidate.files[0].contentHash).toBe(sha256("actual bytes\n"));
  });
});

describe("§28 — post-agent verification", () => {
  const spec = fakeAgentSpec();

  function candidateOf(files: { path: string; content: string }[]) {
    return {
      files: files.map((file) => ({
        path: file.path,
        content: file.content,
        baseContent: null,
        status: "added" as const,
        bytes: Buffer.byteLength(file.content, "utf8"),
        contentHash: sha256(file.content),
      })),
      totalBytes: files.reduce((total, file) => total + Buffer.byteLength(file.content, "utf8"), 0),
      unchangedPaths: [],
      ignoredPaths: [],
      unreadablePaths: [],
      forbiddenPaths: [],
    };
  }

  it("accepts an ordinary bounded change", () => {
    const verification = verifyCandidateChange({
      spec,
      candidate: candidateOf([{ path: "src/app/page.tsx", content: "export default () => null;" }]),
      sourceRevisionVerified: true,
    });

    expect(verification.accepted).toBe(true);
  });

  /**
   * The counts are Vibe's own observation, and this is the only place that
   * holds both sides — the bytes read back from the workspace and the baseline
   * from the pinned commit (§77). Fetching them from GitHub afterwards would
   * make the number GitHub's account of the change rather than Vibe's.
   */
  it("counts what each accepted file added and removed", () => {
    const verification = verifyCandidateChange({
      spec,
      candidate: {
        ...candidateOf([]),
        files: [
          {
            path: "src/app/page.tsx",
            content: "one\ntwo\nthree\n",
            baseContent: "one\nold\n",
            status: "modified" as const,
            bytes: 14,
            contentHash: sha256("one\ntwo\nthree\n"),
          },
          {
            path: "src/app/new.tsx",
            content: "a\nb\n",
            baseContent: null,
            status: "added" as const,
            bytes: 4,
            contentHash: sha256("a\nb\n"),
          },
        ],
      },
      sourceRevisionVerified: true,
    });

    expect(verification.accepted).toBe(true);
    if (!verification.accepted) return;

    // Sorted by path, so `new` comes before `page`.
    expect(verification.files.map((file) => [file.linesAdded, file.linesRemoved])).toEqual([
      [2, 0],
      [2, 1],
    ]);
  });

  it("refuses when the source revision could not be established", () => {
    const verification = verifyCandidateChange({
      spec,
      candidate: candidateOf([{ path: "src/app/page.tsx", content: "ok" }]),
      sourceRevisionVerified: false,
    });

    expect(verification.accepted).toBe(false);
    if (!verification.accepted) {
      expect(verification.rejections).toContain("source_revision_unverified");
    }
  });

  it("refuses a forbidden path even if the gateway somehow allowed it", () => {
    const verification = verifyCandidateChange({
      spec,
      candidate: candidateOf([
        { path: "src/app/page.tsx", content: "fine" },
        { path: ".github/workflows/deploy.yml", content: "on: push" },
      ]),
      sourceRevisionVerified: true,
    });

    expect(verification.accepted).toBe(false);
    if (!verification.accepted) expect(verification.rejections).toContain("forbidden_path");
  });

  it("refuses credential-shaped content in an ordinary source file", () => {
    const verification = verifyCandidateChange({
      spec,
      candidate: candidateOf([
        {
          path: "src/lib/config.ts",
          // A path check cannot catch this — which is exactly why the content
          // is checked too.
          content: 'export const key = "sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";',
        },
      ]),
      sourceRevisionVerified: true,
    });

    expect(verification.accepted).toBe(false);
    if (!verification.accepted) {
      expect(verification.rejections).toContain("secret_material_introduced");
    }
  });

  it("refuses a change with no files", () => {
    const verification = verifyCandidateChange({
      spec,
      candidate: {
        files: [],
        totalBytes: 0,
        unchangedPaths: [],
        ignoredPaths: [],
        unreadablePaths: [],
        forbiddenPaths: [],
      },
      sourceRevisionVerified: true,
    });

    expect(verification.accepted).toBe(false);
    if (!verification.accepted) expect(verification.rejections).toContain("no_files_produced");
  });

  it("refuses too many files, and says so alongside every other problem", () => {
    const many = Array.from({ length: 40 }, (_, index) => ({
      path: `src/file-${index}.ts`,
      content: "x",
    }));

    const verification = verifyCandidateChange({
      spec,
      candidate: candidateOf([...many, { path: ".env.production", content: "SECRET=1" }]),
      sourceRevisionVerified: false,
    });

    expect(verification.accepted).toBe(false);
    if (!verification.accepted) {
      // Collected, not short-circuited: a run that failed three ways is
      // reported as three problems.
      expect(verification.rejections).toContain("too_many_files");
      expect(verification.rejections).toContain("forbidden_path");
      expect(verification.rejections).toContain("source_revision_unverified");
    }
  });

  /** One removed path, in the shape the extractor produces for one. */
  function deletionOf(path: string) {
    return {
      path,
      content: null,
      baseContent: "was here",
      status: "deleted" as const,
      bytes: 0,
      contentHash: null,
    };
  }

  /**
   * Until ADR 0073 this was a refusal, and an honest one: the git writer built
   * its tree additively and its port had no operation that removed an entry, so
   * a candidate containing a deletion could not be written faithfully. The port
   * expresses one now, so the change is accepted — and the deletion is carried
   * out separately from the writes, because they are written differently.
   */
  it("accepts a deletion and carries it beside the writes", () => {
    const verification = verifyCandidateChange({
      spec,
      candidate: {
        files: [deletionOf("src/old.ts")],
        totalBytes: 0,
        unchangedPaths: [],
        ignoredPaths: [],
        unreadablePaths: [],
        forbiddenPaths: [],
      },
      sourceRevisionVerified: true,
    });

    expect(verification.accepted).toBe(true);
    if (verification.accepted) {
      expect(verification.deletions).toEqual(["src/old.ts"]);
      // Never as a write. A removed path has no content and no hash, and a
      // reader that took it for a file would look for bytes that do not exist.
      expect(verification.files).toEqual([]);
    }
  });

  /**
   * The narrowing that replaced the blanket refusal. A path nobody may write is
   * a path nobody may remove — and `forbidden_path` rather than a
   * deletion-specific rejection, because the finding is that the change touched
   * a protected path at all.
   */
  it("refuses a deletion of a path the policy protects", () => {
    const verification = verifyCandidateChange({
      spec,
      candidate: {
        files: [deletionOf(".github/workflows/deploy.yml")],
        totalBytes: 0,
        unchangedPaths: [],
        ignoredPaths: [],
        unreadablePaths: [],
        forbiddenPaths: [],
      },
      sourceRevisionVerified: true,
    });

    expect(verification.accepted).toBe(false);
    if (!verification.accepted) {
      expect(verification.rejections).toContain("forbidden_path");
    }
  });

  /**
   * A deletion is one file against the blast-radius ceiling, exactly as a write
   * is. Removing forty files is not a smaller change than writing forty.
   */
  it("counts a deletion against the changed-file ceiling", () => {
    // The same 40 the write ceiling test uses, comfortably past every profile's
    // `maxChangedFiles`.
    const deletions = Array.from({ length: 40 }, (_, index) => deletionOf(`src/old-${index}.ts`));

    const verification = verifyCandidateChange({
      spec,
      candidate: {
        files: deletions,
        totalBytes: 0,
        unchangedPaths: [],
        ignoredPaths: [],
        unreadablePaths: [],
        forbiddenPaths: [],
      },
      sourceRevisionVerified: true,
    });

    expect(verification.accepted).toBe(false);
    if (!verification.accepted) {
      expect(verification.rejections).toContain("too_many_files");
    }
  });

  it("returns files in a stable order", () => {
    const verification = verifyCandidateChange({
      spec,
      candidate: candidateOf([
        { path: "src/z.ts", content: "z" },
        { path: "src/a.ts", content: "a" },
        { path: "src/m.ts", content: "m" },
      ]),
      sourceRevisionVerified: true,
    });

    expect(verification.accepted).toBe(true);
    if (verification.accepted) {
      expect(verification.files.map((file) => file.path)).toEqual([
        "src/a.ts",
        "src/m.ts",
        "src/z.ts",
      ]);
    }
  });
});

describe("§56, §59 — identity", () => {
  const runIdentity = () =>
    computeAgentRunIdentity({
      projectId: "project-1",
      executionSpecIdentity: "spec-abc",
      codingAgentPolicyVersion: "coding-agent-policy-v1",
      promptCompilerVersion: "agent-prompt-v1",
      model: "claude-sonnet-5",
      budgetPolicyVersion: "core4-dogfood-budget-v1",
    });

  it("gives two clicks on the same work one identity (§56)", () => {
    expect(runIdentity()).toBe(runIdentity());
  });

  it("changes when the policy, the prompt, the model or the budget changes", () => {
    const baseline = runIdentity();

    const variants = [
      { codingAgentPolicyVersion: "coding-agent-policy-v2" },
      { promptCompilerVersion: "agent-prompt-v2" },
      { model: "claude-opus-5" },
      { budgetPolicyVersion: "something-else" },
      { executionSpecIdentity: "spec-def" },
      { projectId: "project-2" },
    ];

    for (const variant of variants) {
      const identity = computeAgentRunIdentity({
        projectId: "project-1",
        executionSpecIdentity: "spec-abc",
        codingAgentPolicyVersion: "coding-agent-policy-v1",
        promptCompilerVersion: "agent-prompt-v1",
        model: "claude-sonnet-5",
        budgetPolicyVersion: "core4-dogfood-budget-v1",
        ...variant,
      });
      expect(identity, JSON.stringify(variant)).not.toBe(baseline);
    }
  });

  /**
   * §59's exactness requirement, at the level where it can be broken.
   *
   * Two agent runs of one spec legitimately produce different code. If the
   * prepared change were keyed on the spec, the second run would find the
   * first's branch and hand a reviewer bytes no run of this execution produced.
   */
  it("gives different bytes a different prepared-change identity (§59)", () => {
    const digestA = computeCandidateDigest([{ path: "src/a.ts", contentHash: "aaa" }]);
    const digestB = computeCandidateDigest([{ path: "src/a.ts", contentHash: "bbb" }]);

    const changeA = computeAgentChangeIdentity({
      projectId: "project-1",
      agentRunIdentity: runIdentity(),
      baseSha: "abc123",
      candidateDigest: digestA,
    });
    const changeB = computeAgentChangeIdentity({
      projectId: "project-1",
      agentRunIdentity: runIdentity(),
      baseSha: "abc123",
      candidateDigest: digestB,
    });

    expect(changeA).not.toBe(changeB);
  });

  it("gives the same bytes on a moved base a different identity", () => {
    const digest = computeCandidateDigest([{ path: "src/a.ts", contentHash: "aaa" }]);

    expect(
      computeAgentChangeIdentity({
        projectId: "p",
        agentRunIdentity: "r",
        baseSha: "abc123",
        candidateDigest: digest,
      }),
    ).not.toBe(
      computeAgentChangeIdentity({
        projectId: "p",
        agentRunIdentity: "r",
        baseSha: "def456",
        candidateDigest: digest,
      }),
    );
  });

  it("is order-independent over the file set", () => {
    expect(
      computeCandidateDigest([
        { path: "b.ts", contentHash: "2" },
        { path: "a.ts", contentHash: "1" },
      ]),
    ).toBe(
      computeCandidateDigest([
        { path: "a.ts", contentHash: "1" },
        { path: "b.ts", contentHash: "2" },
      ]),
    );
  });
});
