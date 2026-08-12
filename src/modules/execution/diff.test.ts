import { beforeEach, describe, expect, it } from "vitest";
import { FakeDatabase, fakeSupabase } from "@/modules/operations/test-support";
import { DIFF_LIMITS, buildBranchUrl, getPreparedDiff } from "./diff";
import type { GitWritePort } from "./git-port";

/**
 * Bounded diff retrieval (Sprint 9C §12, §13, §26).
 *
 * Two properties carry the file: a caller can only ever read the branch the
 * *server* recorded, and whatever comes back is bounded and returned as text.
 */

const PROJECT = "project_1";
const OTHER_PROJECT = "project_2";

let db: FakeDatabase;
let reads: string[];

function port(files: Record<string, string>): GitWritePort {
  return {
    async getRefSha() {
      return null;
    },
    async getFileContent(path, ref) {
      reads.push(`${ref}:${path}`);
      return files[path] ?? null;
    },
    async getCommitTreeSha() {
      return "tree";
    },
    async createBlob() {
      throw new Error("a diff read must never write");
    },
    async createTree() {
      throw new Error("a diff read must never write");
    },
    async createCommit() {
      throw new Error("a diff read must never write");
    },
    async createRef() {
      throw new Error("a diff read must never write");
    },
  };
}

function seedPrepared(overrides: Record<string, unknown> = {}) {
  db.seed("prepared_changes", {
    id: "prepared_1",
    project_id: PROJECT,
    status: "prepared",
    branch_name: "vibe/seo-foundations-abc123",
    base_branch: "main",
    base_sha: "base123",
    commit_sha: "commit456",
    files: [
      { path: "src/app/robots.ts", contentHash: "h1", bytes: 100 },
      { path: "src/app/sitemap.ts", contentHash: "h2", bytes: 200 },
    ],
    execution_identity: "e".repeat(64),
    created_at: "2026-08-12T00:00:00.000Z",
    completed_at: "2026-08-12T00:00:00.000Z",
    ...overrides,
  });
}

beforeEach(() => {
  db = new FakeDatabase();
  reads = [];
  seedPrepared();
});

describe("authorization (§26)", () => {
  it("returns the diff for the owning project", async () => {
    const result = await getPreparedDiff(
      fakeSupabase(db),
      port({ "src/app/robots.ts": "export default function robots() {}" }),
      { projectId: PROJECT, preparedChangeId: "prepared_1" },
    );

    expect(result.ok).toBe(true);
  });

  it("refuses a prepared change belonging to another project", async () => {
    const result = await getPreparedDiff(fakeSupabase(db), port({}), {
      projectId: OTHER_PROJECT,
      preparedChangeId: "prepared_1",
    });

    expect(result).toEqual({ ok: false, error: "not_found" });
    // Nothing was read from the repository either.
    expect(reads).toHaveLength(0);
  });

  it("refuses an unknown prepared change", async () => {
    const result = await getPreparedDiff(fakeSupabase(db), port({}), {
      projectId: PROJECT,
      preparedChangeId: "does_not_exist",
    });

    expect(result).toEqual({ ok: false, error: "not_found" });
  });

  it("refuses a change that has not been prepared yet", async () => {
    db = new FakeDatabase();
    seedPrepared({ status: "preparing", commit_sha: null, completed_at: null });

    const result = await getPreparedDiff(fakeSupabase(db), port({}), {
      projectId: PROJECT,
      preparedChangeId: "prepared_1",
    });

    expect(result).toEqual({ ok: false, error: "not_prepared" });
    expect(reads).toHaveLength(0);
  });

  it("only ever reads the branch and paths the server recorded", async () => {
    // A caller supplies a project and a prepared-change id. The ref and the
    // paths come from the stored row, so no client can ask for an arbitrary
    // file on an arbitrary branch.
    await getPreparedDiff(fakeSupabase(db), port({ "src/app/robots.ts": "x" }), {
      projectId: PROJECT,
      preparedChangeId: "prepared_1",
    });

    expect(reads).toEqual([
      "vibe/seo-foundations-abc123:src/app/robots.ts",
      "vibe/seo-foundations-abc123:src/app/sitemap.ts",
    ]);
  });
});

describe("bounds (§12)", () => {
  it("truncates a file that exceeds the byte limit", async () => {
    const huge = "a".repeat(DIFF_LIMITS.maxBytesPerFile + 5_000);

    const result = await getPreparedDiff(fakeSupabase(db), port({ "src/app/robots.ts": huge }), {
      projectId: PROJECT,
      preparedChangeId: "prepared_1",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.diff.files[0].truncated).toBe(true);
    expect(result.diff.files[0].bytes).toBeLessThanOrEqual(DIFF_LIMITS.maxBytesPerFile);
  });

  it("truncates a file with too many lines", async () => {
    const many = Array.from({ length: DIFF_LIMITS.maxLinesPerFile + 50 }, (_, i) => `line ${i}`).join("\n");

    const result = await getPreparedDiff(fakeSupabase(db), port({ "src/app/robots.ts": many }), {
      projectId: PROJECT,
      preparedChangeId: "prepared_1",
    });

    if (!result.ok) throw new Error("expected a diff");
    expect(result.diff.files[0].lines).toHaveLength(DIFF_LIMITS.maxLinesPerFile);
    expect(result.diff.files[0].truncated).toBe(true);
  });

  it("reports a recorded file that is missing from the branch rather than hiding it", async () => {
    const result = await getPreparedDiff(fakeSupabase(db), port({}), {
      projectId: PROJECT,
      preparedChangeId: "prepared_1",
    });

    if (!result.ok) throw new Error("expected a diff");
    expect(result.diff.files.every((file) => file.lines.length === 0)).toBe(true);
  });
});

describe("untrusted content (§13)", () => {
  it("returns repository content as plain text lines, never markup", async () => {
    const hostile = '<script>alert(1)</script>\n<img src=x onerror="steal()">';

    const result = await getPreparedDiff(fakeSupabase(db), port({ "src/app/robots.ts": hostile }), {
      projectId: PROJECT,
      preparedChangeId: "prepared_1",
    });

    if (!result.ok) throw new Error("expected a diff");
    // Preserved verbatim as data — the renderer escapes it, nothing here
    // interprets it.
    expect(result.diff.files[0].lines).toEqual([
      "<script>alert(1)</script>",
      '<img src=x onerror="steal()">',
    ]);
    expect(typeof result.diff.files[0].lines[0]).toBe("string");
  });
});

describe("branch url (§15)", () => {
  it("builds the url from stored linkage", () => {
    expect(buildBranchUrl("TobiB1505/Vibe-Business", "vibe/seo-foundations-abc123")).toBe(
      "https://github.com/TobiB1505/Vibe-Business/tree/vibe/seo-foundations-abc123",
    );
  });

  it("encodes each ref segment without destroying the slash structure", () => {
    const url = buildBranchUrl("acme/product", "vibe/seo foundations");

    expect(url).toBe("https://github.com/acme/product/tree/vibe/seo%20foundations");
  });
});
