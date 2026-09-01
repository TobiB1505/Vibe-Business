import { beforeEach, describe, expect, it } from "vitest";
import { FakeDatabase, fakeSupabase } from "@/modules/operations/test-support";
import { DIFF_LIMITS, buildBranchUrl, getPreparedDiff, type DiffContentReader } from "./diff";

/**
 * Bounded diff retrieval (Sprint 9C §12, §13, §26; Sprint 0055 §1).
 *
 * Three properties carry the file: a caller can only ever read the *commits*
 * the server recorded, whatever comes back is bounded and returned as text, and
 * both sides of every file are compared so a modification reads as one.
 */

const PROJECT = "project_1";
const OTHER_PROJECT = "project_2";

const BASE_SHA = "base123";
const HEAD_SHA = "commit456";

let db: FakeDatabase;
let reads: string[];

/**
 * A reader over two pinned commits.
 *
 * `getTextFile` returning `null` stands for every reason a file cannot be read
 * — absent, binary, oversized — exactly as the real GitHub reader does.
 */
function reader(versions: Record<string, { base?: string; head?: string }>): DiffContentReader {
  return {
    async getTextFile(path, commitSha) {
      reads.push(`${commitSha}:${path}`);
      const file = versions[path];
      if (!file) return null;
      return (commitSha === BASE_SHA ? file.base : file.head) ?? null;
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
      reader({ "src/app/robots.ts": { head: "export default function robots() {}" } }),
      { projectId: PROJECT, preparedChangeId: "prepared_1" },
    );

    expect(result.ok).toBe(true);
  });

  it("refuses a prepared change belonging to another project", async () => {
    const result = await getPreparedDiff(fakeSupabase(db), reader({}), {
      projectId: OTHER_PROJECT,
      preparedChangeId: "prepared_1",
    });

    expect(result).toEqual({ ok: false, error: "not_found" });
    // Nothing was read from the repository either.
    expect(reads).toHaveLength(0);
  });

  it("refuses an unknown prepared change", async () => {
    const result = await getPreparedDiff(fakeSupabase(db), reader({}), {
      projectId: PROJECT,
      preparedChangeId: "does_not_exist",
    });

    expect(result).toEqual({ ok: false, error: "not_found" });
  });

  it("refuses a change that has not been prepared yet", async () => {
    db = new FakeDatabase();
    seedPrepared({ status: "preparing", commit_sha: null, completed_at: null });

    const result = await getPreparedDiff(fakeSupabase(db), reader({}), {
      projectId: PROJECT,
      preparedChangeId: "prepared_1",
    });

    expect(result).toEqual({ ok: false, error: "not_prepared" });
    expect(reads).toHaveLength(0);
  });

  it("only ever reads the two commits and the paths the server recorded", async () => {
    // A caller supplies a project and a prepared-change id. Both SHAs and every
    // path come from the stored row, so no client can ask for an arbitrary file
    // at an arbitrary commit — and neither can name a branch, which could move.
    await getPreparedDiff(fakeSupabase(db), reader({ "src/app/robots.ts": { head: "x" } }), {
      projectId: PROJECT,
      preparedChangeId: "prepared_1",
    });

    expect([...reads].sort()).toEqual([
      `${BASE_SHA}:src/app/robots.ts`,
      `${BASE_SHA}:src/app/sitemap.ts`,
      `${HEAD_SHA}:src/app/robots.ts`,
      `${HEAD_SHA}:src/app/sitemap.ts`,
    ]);
  });
});

describe("bounds (§12)", () => {
  it("truncates a file that exceeds the byte limit", async () => {
    const huge = "a".repeat(DIFF_LIMITS.maxBytesPerFile + 5_000);

    const result = await getPreparedDiff(fakeSupabase(db), reader({ "src/app/robots.ts": { head: huge } }), {
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

    const result = await getPreparedDiff(fakeSupabase(db), reader({ "src/app/robots.ts": { head: many } }), {
      projectId: PROJECT,
      preparedChangeId: "prepared_1",
    });

    if (!result.ok) throw new Error("expected a diff");
    expect(result.diff.files[0].truncated).toBe(true);
    // Clipped, not summarised: exactly the lines inside the ceiling are shown.
    expect(result.diff.files[0].added).toBe(DIFF_LIMITS.maxLinesPerFile);
  });

  it("reports a recorded file it could not read rather than hiding it", async () => {
    const result = await getPreparedDiff(fakeSupabase(db), reader({}), {
      projectId: PROJECT,
      preparedChangeId: "prepared_1",
    });

    if (!result.ok) throw new Error("expected a diff");
    // A file silently missing from a diff is a file nobody reviewed. It is
    // shown as unreadable, never as a deletion — `getTextFile` cannot tell an
    // absent file from an oversized or binary one.
    expect(result.diff.files.map((file) => file.status)).toEqual(["unreadable", "unreadable"]);
    expect(result.diff.files.every((file) => file.hunks.length === 0)).toBe(true);
  });
});

describe("base versus head (Sprint 0055 §1)", () => {
  it("shows a modified file as removals and additions, not as a whole new file", async () => {
    const result = await getPreparedDiff(
      fakeSupabase(db),
      reader({
        "src/app/robots.ts": { base: "export const a = 1;\n", head: "export const a = 2;\n" },
      }),
      { projectId: PROJECT, preparedChangeId: "prepared_1" },
    );

    if (!result.ok) throw new Error("expected a diff");
    const [file] = result.diff.files;

    expect(file.status).toBe("modified");
    expect(file.added).toBe(1);
    expect(file.removed).toBe(1);
    expect(file.hunks[0].lines).toEqual([
      { kind: "removed", text: "export const a = 1;" },
      { kind: "added", text: "export const a = 2;" },
    ]);
  });

  it("shows a file that did not exist at the base commit as added", async () => {
    const result = await getPreparedDiff(
      fakeSupabase(db),
      reader({ "src/app/robots.ts": { head: "new\n" } }),
      { projectId: PROJECT, preparedChangeId: "prepared_1" },
    );

    if (!result.ok) throw new Error("expected a diff");
    expect(result.diff.files[0].status).toBe("added");
    expect(result.diff.files[0].removed).toBe(0);
  });

  it("shows no hunks for a file whose two versions are identical", async () => {
    // The candidate extractor drops byte-identical rewrites, so this should not
    // arise — and if it ever does, an empty diff is the honest rendering rather
    // than the whole file presented as new.
    const result = await getPreparedDiff(
      fakeSupabase(db),
      reader({ "src/app/robots.ts": { base: "same\n", head: "same\n" } }),
      { projectId: PROJECT, preparedChangeId: "prepared_1" },
    );

    if (!result.ok) throw new Error("expected a diff");
    expect(result.diff.files[0].hunks).toEqual([]);
    expect(result.diff.files[0].status).toBe("modified");
  });

  it("totals the additions and removals across every file", async () => {
    const result = await getPreparedDiff(
      fakeSupabase(db),
      reader({
        "src/app/robots.ts": { base: "a\n", head: "b\n" },
        "src/app/sitemap.ts": { head: "x\ny\n" },
      }),
      { projectId: PROJECT, preparedChangeId: "prepared_1" },
    );

    if (!result.ok) throw new Error("expected a diff");
    expect(result.diff.added).toBe(3);
    expect(result.diff.removed).toBe(1);
  });

  it("carries the two commits and the policy version, so the diff can be recomputed", async () => {
    // What an approval binds to (ADR 0040): the same two immutable commits under
    // the same rules produce the same diff.
    const result = await getPreparedDiff(
      fakeSupabase(db),
      reader({ "src/app/robots.ts": { head: "x\n" } }),
      { projectId: PROJECT, preparedChangeId: "prepared_1" },
    );

    if (!result.ok) throw new Error("expected a diff");
    expect(result.diff.baseSha).toBe(BASE_SHA);
    expect(result.diff.commitSha).toBe(HEAD_SHA);
    expect(result.diff.policyVersion).toBe("diff-policy-v1");
  });
});

describe("untrusted content (§13)", () => {
  it("returns repository content as plain text lines, never markup", async () => {
    const hostile = '<script>alert(1)</script>\n<img src=x onerror="steal()">';

    const result = await getPreparedDiff(fakeSupabase(db), reader({ "src/app/robots.ts": { head: hostile } }), {
      projectId: PROJECT,
      preparedChangeId: "prepared_1",
    });

    if (!result.ok) throw new Error("expected a diff");
    // Preserved verbatim as data — the renderer escapes it, nothing here
    // interprets it.
    expect(result.diff.files[0].hunks[0].lines).toEqual([
      { kind: "added", text: "<script>alert(1)</script>" },
      { kind: "added", text: '<img src=x onerror="steal()">' },
    ]);
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
