import { describe, expect, it } from "vitest";
import { generateSeoFoundations, sha256 } from "./generators/nextjs-seo-foundations";
import type { GitWritePort } from "./git-port";
import {
  COMMIT_MESSAGE,
  commitMessageFor,
  inspectExistingBranch,
  prepareChangeOnBranch,
  type WriteTarget,
} from "./github-writer";

/**
 * The repository write and its recovery path (Sprint 9B §26, §27).
 *
 * `inspectExistingBranch` was explicitly untested in Sprint 9A. It is the most
 * consequential decision in the write path — it decides whether a re-entry
 * adopts a branch, refuses it, or creates one — so it is tested directly here
 * against an in-memory port with no network.
 */

const TARGET: WriteTarget = {
  owner: "acme",
  repo: "product",
  baseBranch: "main",
  baseSha: "base-sha",
  branchName: "vibe/seo-foundations-abc123",
  capability: "nextjs_seo_foundations_v2",
};

const FILES = generateSeoFoundations({ origin: "https://acme.com", appRoot: "src/app/", routes: [] });

type Call = { op: string; detail?: string };

/**
 * An in-memory Git host.
 *
 * Records every call, so "exactly one commit" and "the ref was created last"
 * are assertions rather than hopes.
 */
function fakeGit(
  seed: { refs?: Record<string, string>; files?: Record<string, Record<string, string>> } = {},
) {
  const refs: Record<string, string> = { ...seed.refs };
  /** ref → path → content */
  const files: Record<string, Record<string, string>> = { ...seed.files };
  const calls: Call[] = [];
  let counter = 0;

  const port: GitWritePort = {
    async getRefSha(ref) {
      calls.push({ op: "getRefSha", detail: ref });
      return refs[ref] ?? null;
    },
    async getFileContent(path, ref) {
      calls.push({ op: "getFileContent", detail: `${ref}:${path}` });
      return files[ref]?.[path] ?? null;
    },
    async getCommitTreeSha(commitSha) {
      calls.push({ op: "getCommitTreeSha", detail: commitSha });
      return `tree-of-${commitSha}`;
    },
    async createBlob(content) {
      calls.push({ op: "createBlob" });
      return `blob-${sha256(content).slice(0, 8)}`;
    },
    async createTree({ baseTreeSha, files: entries }) {
      calls.push({ op: "createTree", detail: `${baseTreeSha}+${entries.length}` });
      return `tree-${(counter += 1)}`;
    },
    async createCommit({ message, parentSha }) {
      calls.push({ op: "createCommit", detail: `${message}|parent:${parentSha}` });
      return `commit-${(counter += 1)}`;
    },
    async createRef({ ref, sha }) {
      calls.push({ op: "createRef", detail: ref });
      // Writes name a ref fully (`refs/heads/x`); reads name it short
      // (`heads/x`). The double normalizes the way the host does, or the
      // verification read would never find what was just created.
      const shortRef = ref.replace(/^refs\//, "");
      if (refs[shortRef] !== undefined) throw new Error("ref already exists");
      refs[shortRef] = sha;
      // A real host serves the committed content from the new ref.
      files[shortRef.replace(/^heads\//, "")] = Object.fromEntries(
        FILES.map((file) => [file.path, file.content]),
      );
    },
  };

  return { port, refs, files, calls };
}

/** A branch already holding exactly what we would write. */
function branchWithOurContent(commitSha = "existing-commit") {
  return fakeGit({
    refs: { [`heads/${TARGET.branchName}`]: commitSha },
    files: {
      [TARGET.branchName]: Object.fromEntries(FILES.map((file) => [file.path, file.content])),
    },
  });
}

describe("inspectExistingBranch (§27)", () => {
  it("reports absent when no branch exists", async () => {
    const git = fakeGit();

    expect(await inspectExistingBranch(git.port, TARGET, FILES)).toEqual({ state: "absent" });
  });

  it("reports a match when the branch holds exactly our content", async () => {
    const git = branchWithOurContent("abc");

    expect(await inspectExistingBranch(git.port, TARGET, FILES)).toEqual({
      state: "matches",
      commitSha: "abc",
    });
  });

  it("reports a conflict when the branch holds different content", async () => {
    const git = fakeGit({
      refs: { [`heads/${TARGET.branchName}`]: "someone-elses" },
      files: {
        [TARGET.branchName]: {
          "src/app/robots.ts": "// somebody else wrote this",
          "src/app/sitemap.ts": "// and this",
        },
      },
    });

    const result = await inspectExistingBranch(git.port, TARGET, FILES);

    expect(result.state).toBe("conflict");
  });

  it("reports a conflict when the branch is missing one of our files", async () => {
    // A partially-written branch is not ours to complete in place.
    const git = fakeGit({
      refs: { [`heads/${TARGET.branchName}`]: "half" },
      files: { [TARGET.branchName]: { "src/app/robots.ts": FILES[0].content } },
    });

    expect((await inspectExistingBranch(git.port, TARGET, FILES)).state).toBe("conflict");
  });

  it("reports a conflict when content differs by a single byte", async () => {
    const git = fakeGit({
      refs: { [`heads/${TARGET.branchName}`]: "nearly" },
      files: {
        [TARGET.branchName]: {
          "src/app/robots.ts": `${FILES[0].content} `,
          "src/app/sitemap.ts": FILES[1].content,
        },
      },
    });

    expect((await inspectExistingBranch(git.port, TARGET, FILES)).state).toBe("conflict");
  });
});

describe("prepareChangeOnBranch — the happy path", () => {
  it("creates exactly one commit and one ref", async () => {
    const git = fakeGit();

    const result = await prepareChangeOnBranch(git.port, TARGET, FILES);

    expect(result).toEqual({ ok: true, commitSha: expect.any(String), recovered: false });
    expect(git.calls.filter((call) => call.op === "createCommit")).toHaveLength(1);
    expect(git.calls.filter((call) => call.op === "createRef")).toHaveLength(1);
    expect(git.calls.filter((call) => call.op === "createBlob")).toHaveLength(2);
  });

  it("creates the ref last, after every object exists", async () => {
    // Ordering is the safety property: a failure before this point leaves
    // collectable objects and no branch (§16).
    const git = fakeGit();
    await prepareChangeOnBranch(git.port, TARGET, FILES);

    const ops = git.calls.map((call) => call.op);
    expect(ops.indexOf("createRef")).toBeGreaterThan(ops.indexOf("createCommit"));
    expect(ops.indexOf("createCommit")).toBeGreaterThan(ops.indexOf("createTree"));
    expect(ops.indexOf("createTree")).toBeGreaterThan(ops.indexOf("createBlob"));
  });

  it("commits onto the base sha with a fixed message", async () => {
    const git = fakeGit();
    await prepareChangeOnBranch(git.port, TARGET, FILES);

    const commit = git.calls.find((call) => call.op === "createCommit");
    expect(commit?.detail).toBe(`${COMMIT_MESSAGE}|parent:base-sha`);
  });

  it("only ever touches the Vibe branch ref", async () => {
    const git = fakeGit();
    await prepareChangeOnBranch(git.port, TARGET, FILES);

    const created = git.calls.filter((call) => call.op === "createRef");
    expect(created.map((call) => call.detail)).toEqual([`refs/heads/${TARGET.branchName}`]);
    expect(git.refs["heads/main"]).toBeUndefined();
  });
});

describe("prepareChangeOnBranch — recovery (§15, §26)", () => {
  it("adopts an existing matching branch without writing anything", async () => {
    const git = branchWithOurContent("already-there");

    const result = await prepareChangeOnBranch(git.port, TARGET, FILES);

    expect(result).toEqual({ ok: true, commitSha: "already-there", recovered: true });
    expect(git.calls.some((call) => call.op === "createCommit")).toBe(false);
    expect(git.calls.some((call) => call.op === "createRef")).toBe(false);
  });

  it("refuses a branch holding something else, and writes nothing", async () => {
    const git = fakeGit({
      refs: { [`heads/${TARGET.branchName}`]: "not-ours" },
      files: { [TARGET.branchName]: { "src/app/robots.ts": "// unrelated" } },
    });

    const result = await prepareChangeOnBranch(git.port, TARGET, FILES);

    expect(result).toEqual({ ok: false, reason: "branch_conflict" });
    expect(git.calls.some((call) => call.op === "createRef")).toBe(false);
    expect(git.refs[`heads/${TARGET.branchName}`]).toBe("not-ours");
  });

  it("is idempotent across repeated preparations", async () => {
    const git = fakeGit();

    const first = await prepareChangeOnBranch(git.port, TARGET, FILES);
    const second = await prepareChangeOnBranch(git.port, TARGET, FILES);

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.commitSha).toBe(first.commitSha);
    expect(second.recovered).toBe(true);
    expect(git.calls.filter((call) => call.op === "createCommit")).toHaveLength(1);
  });
});

describe("prepareChangeOnBranch — verification (§25)", () => {
  it("fails when the ref does not resolve to the commit we made", async () => {
    const git = fakeGit();
    const original = git.port.getRefSha;
    let seen = 0;
    git.port.getRefSha = async (ref) => {
      seen += 1;
      // First call is the recovery probe; the verification read is the second.
      return seen === 1 ? original(ref) : "a-different-commit";
    };

    const result = await prepareChangeOnBranch(git.port, TARGET, FILES);

    expect(result).toEqual({ ok: false, reason: "write_verification_failed" });
  });

  it("fails when a file reads back with different content", async () => {
    const git = fakeGit();
    const original = git.port.getFileContent;
    let created = false;
    git.port.createRef = async ({ ref, sha }) => {
      created = true;
      git.refs[ref.replace(/^refs\//, "")] = sha;
    };
    git.port.getRefSha = async () => (created ? "commit-2" : null);
    git.port.getFileContent = async (path, ref) => (created ? "// tampered" : original(path, ref));

    const result = await prepareChangeOnBranch(git.port, TARGET, FILES);

    expect(result).toEqual({ ok: false, reason: "write_verification_failed" });
  });

  it("reports a typed failure when the host errors, never provider prose", async () => {
    const git = fakeGit();
    git.port.createBlob = async () => {
      throw new Error("secret-internal-detail token=abc123");
    };

    const result = await prepareChangeOnBranch(git.port, TARGET, FILES);

    expect(result).toEqual({ ok: false, reason: "github_unavailable" });
    expect(JSON.stringify(result)).not.toContain("token=abc123");
  });
});

describe("prepareChangeOnBranch — path enforcement (§13)", () => {
  it("refuses to write a file outside the capability allowlist", async () => {
    const git = fakeGit();
    const hostile = [{ ...FILES[0], path: ".github/workflows/deploy.yml" }];

    const result = await prepareChangeOnBranch(git.port, TARGET, hostile);

    expect(result).toEqual({ ok: false, reason: "change_preparation_failed" });
    expect(git.calls).toHaveLength(0);
  });
});

describe("commitMessageFor (Sprint 0046)", () => {
  it("keeps the deterministic capability's fixed message untouched", () => {
    expect(
      commitMessageFor({ capability: "nextjs_seo_foundations_v2", commitMessage: "feat(seo): should be ignored" }),
    ).toBe(COMMIT_MESSAGE);
  });

  it("uses the compiled agentic message verbatim", () => {
    const compiled = "feat(seo): add canonical URLs to public pages\n\nVibe-Execution: e1";
    expect(commitMessageFor({ capability: "agentic_execution_v1", commitMessage: compiled })).toBe(compiled);
  });

  it("falls back to a generic Conventional Commit, never the old step-number string", () => {
    const message = commitMessageFor({ capability: "agentic_execution_v1", commitMessage: null });
    expect(message).toBe("chore: apply prepared product change");
    expect(message).not.toContain("implement plan step");
  });

  it("falls back the same way for an empty string, not just null", () => {
    expect(commitMessageFor({ capability: "agentic_execution_v1", commitMessage: "" })).toBe(
      "chore: apply prepared product change",
    );
  });
});

/**
 * PART H — the Prepared SHA / validated SHA invariant.
 *
 * Commit-message generation changes the resulting SHA, which is expected. What
 * must never happen is a *second* write changing the message of a commit that
 * already exists — that would move the SHA a prior validation was run against
 * without anyone re-validating it. `GitWritePort` has no operation that could
 * amend a commit or force-update a ref (see the module's own header comment),
 * so this is provable by showing the recovery path, not the mutation path,
 * is what a second call with a *different* compiled message actually takes.
 */
describe("PART H — no amendment after a commit exists", () => {
  const AGENTIC_TARGET: WriteTarget = { ...TARGET, capability: "agentic_execution_v1" };

  it("a second write with a different commit message does not change the existing commit", async () => {
    const first = { ...AGENTIC_TARGET, commitMessage: "feat(seo): add canonical URLs to public pages" };
    const git = fakeGit();

    const firstResult = await prepareChangeOnBranch(git.port, first, FILES);
    expect(firstResult.ok).toBe(true);
    if (!firstResult.ok) return;

    const second = { ...AGENTIC_TARGET, commitMessage: "fix(seo): a completely different message" };
    const secondResult = await prepareChangeOnBranch(git.port, second, FILES);

    expect(secondResult).toEqual({ ok: true, commitSha: firstResult.commitSha, recovered: true });
    // Exactly one createCommit call happened, ever — the second call took the
    // recovery path and never called the Git API that could have amended
    // anything, because there is no such call to take.
    expect(git.calls.filter((call) => call.op === "createCommit")).toHaveLength(1);
    expect(git.calls.filter((call) => call.op === "createCommit")[0]?.detail).toContain(
      "feat(seo): add canonical URLs to public pages",
    );
  });

  it("the port itself offers no operation that could amend a commit or force a ref", async () => {
    // Structural, not behavioural: this is what makes the property above true
    // for every possible caller, not just this test's specific sequence.
    const git = fakeGit();
    const methodNames = Object.keys(git.port);
    for (const forbidden of ["updateRef", "amendCommit", "forceRef", "deleteRef", "forcePush"]) {
      expect(methodNames).not.toContain(forbidden);
    }
  });
});

/**
 * Removing a file (ADR 0074).
 *
 * The write path was additive for its whole life, and `candidate.ts` refused a
 * deletion rather than write a commit missing part of what the agent did. What
 * follows is the other half of lifting that refusal: the tree entry that
 * removes a path, and the read-back that asserts absence rather than assuming
 * it. The fake below models a real base tree — the existing one seeds a branch
 * from `FILES` whatever the tree said, which cannot answer "is it gone?".
 */
describe("prepareChangeOnBranch — deletions (ADR 0074)", () => {
  const AGENTIC_TARGET: WriteTarget = {
    ...TARGET,
    branchName: "vibe/agent-delete-abc123",
    capability: "agentic_execution_v2",
    commitMessage: "refactor(app): remove the unused pricing page",
  };

  /** A host whose branch content is whatever the tree entries said it is. */
  function treeGit(baseFiles: Record<string, string>) {
    const refs: Record<string, string> = {};
    const blobs: Record<string, string> = {};
    const trees: Record<string, Record<string, string>> = { "tree-of-base-sha": { ...baseFiles } };
    const branch: Record<string, string> = {};
    let counter = 0;

    const port: GitWritePort = {
      async getRefSha(ref) {
        return refs[ref] ?? null;
      },
      async getFileContent(path, ref) {
        if (ref === AGENTIC_TARGET.branchName) return branch[path] ?? null;
        return baseFiles[path] ?? null;
      },
      async getCommitTreeSha(commitSha) {
        return `tree-of-${commitSha}`;
      },
      async createBlob(content) {
        const sha = `blob-${(counter += 1)}`;
        blobs[sha] = content;
        return sha;
      },
      async createTree({ baseTreeSha, files: entries }) {
        const sha = `tree-${(counter += 1)}`;
        const next = { ...(trees[baseTreeSha] ?? {}) };
        for (const entry of entries) {
          // The Git data model's own semantics, which is the whole point of
          // this fake: a null blob removes the path from the new tree.
          if (entry.blobSha === null) delete next[entry.path];
          else next[entry.path] = blobs[entry.blobSha] ?? "";
        }
        trees[sha] = next;
        return sha;
      },
      async createCommit({ treeSha }) {
        const sha = `commit-${(counter += 1)}`;
        trees[`tree-of-${sha}`] = trees[treeSha] ?? {};
        return sha;
      },
      async createRef({ ref, sha }) {
        refs[ref.replace(/^refs\//, "")] = sha;
        for (const key of Object.keys(branch)) delete branch[key];
        Object.assign(branch, trees[`tree-of-${sha}`] ?? {});
      },
    };

    return { port, branch };
  }

  it("removes the path from the tree, and reads it back absent", async () => {
    const git = treeGit({ "src/app/pricing/page.tsx": "export default () => null;\n" });

    const result = await prepareChangeOnBranch(git.port, AGENTIC_TARGET, [], [
      "src/app/pricing/page.tsx",
    ]);

    expect(result.ok).toBe(true);
    expect(git.branch["src/app/pricing/page.tsx"]).toBeUndefined();
  });

  it("writes and removes in the same commit", async () => {
    const git = treeGit({
      "src/app/pricing/page.tsx": "export default () => null;\n",
      "src/app/page.tsx": "old home\n",
    });

    const result = await prepareChangeOnBranch(
      git.port,
      AGENTIC_TARGET,
      [{ path: "src/app/page.tsx", content: "new home\n", contentHash: sha256("new home\n"), bytes: 9 }],
      ["src/app/pricing/page.tsx"],
    );

    expect(result.ok).toBe(true);
    expect(git.branch).toEqual({ "src/app/page.tsx": "new home\n" });
  });

  /**
   * The read-back is the verification, not the API's own 201. A host that
   * accepted the tree and served the path anyway is a failed write.
   */
  it("fails verification when a deleted path is still there afterwards", async () => {
    const git = treeGit({ "src/app/pricing/page.tsx": "export default () => null;\n" });
    const original = git.port.getFileContent;
    git.port.getFileContent = async (path, ref) =>
      ref === AGENTIC_TARGET.branchName ? "still here\n" : original(path, ref);

    const result = await prepareChangeOnBranch(git.port, AGENTIC_TARGET, [], [
      "src/app/pricing/page.tsx",
    ]);

    expect(result).toEqual({ ok: false, reason: "write_verification_failed" });
  });

  /**
   * A path nobody may write is a path nobody may remove. Refused before any
   * call reaches the host, exactly as a forbidden write is.
   */
  it("refuses to remove a path outside the capability allowlist", async () => {
    const git = treeGit({ ".github/workflows/deploy.yml": "on: push\n" });

    const result = await prepareChangeOnBranch(git.port, AGENTIC_TARGET, [], [
      ".github/workflows/deploy.yml",
    ]);

    expect(result).toEqual({ ok: false, reason: "change_preparation_failed" });
  });
});
