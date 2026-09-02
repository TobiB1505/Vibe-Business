import { describe, expect, it } from "vitest";
import { FakeDatabase, fakeSupabase } from "@/modules/operations/test-support";
import { classifyReviewForPreparedChange, type FileTextReader } from "./classification-inputs";

/**
 * Assembling the classifier's inputs, and the one lookup that reads file
 * content (Sprint 0053).
 *
 * The probe added here is the only place in review classification that makes a
 * network call, so the property that matters most is not that it works — it is
 * that it stays *small*. A probe that quietly grew to fetch every changed file
 * on every page render would be a performance defect nobody noticed until a
 * rate limit. The reader double below logs every read, and the cost bound is
 * asserted as a number.
 *
 * The surface and requirement lookups are deliberately left to degrade to null
 * here (no snapshot, no agent run in the fake database). That is their
 * documented behaviour and it keeps these cases about the probe.
 */

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const PREPARED_ID = "33333333-3333-4333-8333-333333333333";
const BASE_SHA = "a".repeat(40);
const COMMIT_SHA = "b".repeat(40);

/** A layout whose only difference between the two versions is `metadata`. */
const BASE_LAYOUT = `export const metadata = { title: "Vibe" };

export default function Layout() {
  return <html lang="en" />;
}
`;

const HEAD_LAYOUT_METADATA_ONLY = `export const metadata = { title: "Vibe", robots: { index: true } };

export default function Layout() {
  return <html lang="en" />;
}
`;

/** The same file, but the render path moved too. */
const HEAD_LAYOUT_JSX_CHANGED = HEAD_LAYOUT_METADATA_ONLY.replace('lang="en"', 'lang="de"');

type ReadLog = { path: string; ref: string }[];

/**
 * A reader that records what it was asked for.
 *
 * Three lines, because `FileTextReader` is declared as the one method the probe
 * needs rather than the whole `RepositoryReader` — which is exactly why it was
 * declared that way.
 */
function fakeReader(
  files: Record<string, string | null>,
  log: ReadLog = [],
): FileTextReader & { log: ReadLog } {
  return {
    log,
    async getTextFile(path: string, commitSha: string): Promise<string | null> {
      log.push({ path, ref: commitSha });
      return files[`${commitSha}:${path}`] ?? null;
    },
  };
}

function seed(db: FakeDatabase, changedPaths: readonly string[]) {
  db.seed("prepared_changes", {
    id: PREPARED_ID,
    project_id: PROJECT_ID,
    user_id: USER_ID,
    operation_run_id: "44444444-4444-4444-8444-444444444444",
    opportunity_set_id: null,
    opportunity_id: null,
    execution_capability: "agentic_change",
    execution_version: "v1",
    repository_snapshot_id: null,
    base_branch: "main",
    base_sha: BASE_SHA,
    branch_name: "vibe/agent-x",
    commit_sha: COMMIT_SHA,
    files: changedPaths.map((path) => ({ path, contentHash: "h", bytes: 1 })),
    execution_identity: "identity",
    status: "prepared",
    failure_code: null,
    created_at: new Date().toISOString(),
    completed_at: null,
  });
}

describe("the render-impact probe stays small", () => {
  /**
   * The test that stops the probe growing. Five changed paths, two of them
   * route segments — so exactly four reads, and not one more. If someone later
   * makes this probe inspect components, stylesheets or every changed file,
   * this number changes and the reason has to be argued rather than slipped in.
   */
  it("reads exactly two refs for each route-segment candidate, and nothing else", async () => {
    const db = new FakeDatabase();
    seed(db, [
      "src/app/layout.tsx",
      "src/app/page.tsx",
      "src/components/ui/button.tsx",
      "src/modules/billing/ledger.ts",
      "src/app/globals.css",
    ]);

    const reader = fakeReader({});
    await classifyReviewForPreparedChange({
      supabase: fakeSupabase(db),
      projectId: PROJECT_ID,
      preparedChangeId: PREPARED_ID,
      reader,
    });

    expect(reader.log).toHaveLength(4);
    expect(new Set(reader.log.map((entry) => entry.path))).toEqual(
      new Set(["src/app/layout.tsx", "src/app/page.tsx"]),
    );
  });

  /**
   * Never the branch tip. `commitSha` is the artifact Vibe verified; a branch
   * name resolves to whatever it points at now, which is a different question.
   */
  it("compares the pinned base and commit, never the branch", async () => {
    const db = new FakeDatabase();
    seed(db, ["src/app/layout.tsx"]);

    const reader = fakeReader({});
    await classifyReviewForPreparedChange({
      supabase: fakeSupabase(db),
      projectId: PROJECT_ID,
      preparedChangeId: PREPARED_ID,
      reader,
    });

    expect(new Set(reader.log.map((entry) => entry.ref))).toEqual(new Set([BASE_SHA, COMMIT_SHA]));
    expect(reader.log.every((entry) => entry.ref !== "vibe/agent-x")).toBe(true);
  });

  it("makes no read at all when nothing changed is a route segment", async () => {
    const db = new FakeDatabase();
    seed(db, ["src/components/ui/button.tsx", "src/modules/billing/ledger.ts"]);

    const reader = fakeReader({});
    await classifyReviewForPreparedChange({
      supabase: fakeSupabase(db),
      projectId: PROJECT_ID,
      preparedChangeId: PREPARED_ID,
      reader,
    });

    expect(reader.log).toEqual([]);
  });
});

describe("the probe downgrades only what it can prove", () => {
  it("downgrades a metadata-only layout to a code review", async () => {
    const db = new FakeDatabase();
    seed(db, ["src/app/layout.tsx", "src/app/robots-meta.test.ts"]);

    const reader = fakeReader({
      [`${BASE_SHA}:src/app/layout.tsx`]: BASE_LAYOUT,
      [`${COMMIT_SHA}:src/app/layout.tsx`]: HEAD_LAYOUT_METADATA_ONLY,
    });

    const result = await classifyReviewForPreparedChange({
      supabase: fakeSupabase(db),
      projectId: PROJECT_ID,
      preparedChangeId: PREPARED_ID,
      reader,
    });

    expect(result?.classification).toBe("code");
    expect(result?.downgradedPaths).toEqual(["src/app/layout.tsx"]);
  });

  it("leaves a layout visual when its render path also moved", async () => {
    const db = new FakeDatabase();
    seed(db, ["src/app/layout.tsx"]);

    const reader = fakeReader({
      [`${BASE_SHA}:src/app/layout.tsx`]: BASE_LAYOUT,
      [`${COMMIT_SHA}:src/app/layout.tsx`]: HEAD_LAYOUT_JSX_CHANGED,
    });

    const result = await classifyReviewForPreparedChange({
      supabase: fakeSupabase(db),
      projectId: PROJECT_ID,
      preparedChangeId: PREPARED_ID,
      reader,
    });

    expect(result?.classification).toBe("visual");
    expect(result?.downgradedPaths).toEqual([]);
  });
});

describe("every degradation leaves the path answer standing", () => {
  it("returns the path-based answer with no reader at all", async () => {
    const db = new FakeDatabase();
    seed(db, ["src/app/layout.tsx"]);

    const result = await classifyReviewForPreparedChange({
      supabase: fakeSupabase(db),
      projectId: PROJECT_ID,
      preparedChangeId: PREPARED_ID,
      reader: null,
    });

    expect(result?.classification).toBe("visual");
    expect(result?.downgradedPaths).toEqual([]);
  });

  it("returns the path-based answer when the reader throws", async () => {
    const db = new FakeDatabase();
    seed(db, ["src/app/layout.tsx"]);

    const result = await classifyReviewForPreparedChange({
      supabase: fakeSupabase(db),
      projectId: PROJECT_ID,
      preparedChangeId: PREPARED_ID,
      reader: {
        async getTextFile() {
          throw new Error("rate limited");
        },
      },
    });

    expect(result?.classification).toBe("visual");
    expect(result?.downgradedPaths).toEqual([]);
  });

  it("returns the path-based answer when a file cannot be read", async () => {
    const db = new FakeDatabase();
    seed(db, ["src/app/layout.tsx"]);

    // Base missing: a new page, or a failed read. Indistinguishable, and both
    // want the same conservative answer.
    const reader = fakeReader({
      [`${COMMIT_SHA}:src/app/layout.tsx`]: HEAD_LAYOUT_METADATA_ONLY,
    });

    const result = await classifyReviewForPreparedChange({
      supabase: fakeSupabase(db),
      projectId: PROJECT_ID,
      preparedChangeId: PREPARED_ID,
      reader,
    });

    expect(result?.classification).toBe("visual");
  });

  /**
   * A removed page is a visual change (ADR 0074).
   *
   * Removing `src/app/pricing/page.tsx` takes a page off the site, which is
   * about as visual as a change gets. It reaches the classifier because a
   * deletion is one of the entries in `prepared_changes.files` — the same list
   * every changed path has always come from — and the render-impact probe
   * cannot clear it, because there is no head version to prove anything about.
   */
  it("classifies a removed page as visual", async () => {
    const db = new FakeDatabase();
    db.seed("prepared_changes", {
      id: PREPARED_ID,
      project_id: PROJECT_ID,
      user_id: USER_ID,
      operation_run_id: "44444444-4444-4444-8444-444444444444",
      opportunity_set_id: null,
      opportunity_id: null,
      execution_capability: "agentic_execution_v2",
      execution_version: "agentic-execution-v2",
      repository_snapshot_id: null,
      base_branch: "main",
      base_sha: BASE_SHA,
      branch_name: "vibe/agent-x",
      commit_sha: COMMIT_SHA,
      files: [{ path: "src/app/pricing/page.tsx", status: "deleted" }],
      execution_identity: "identity",
      status: "prepared",
      failure_code: null,
      created_at: new Date().toISOString(),
      completed_at: null,
    });

    const result = await classifyReviewForPreparedChange({
      supabase: fakeSupabase(db),
      projectId: PROJECT_ID,
      preparedChangeId: PREPARED_ID,
      reader: fakeReader({ [`${BASE_SHA}:src/app/pricing/page.tsx`]: HEAD_LAYOUT_JSX_CHANGED }),
    });

    expect(result?.classification).toBe("visual");
  });

  it("returns null for a prepared change that does not exist", async () => {
    const result = await classifyReviewForPreparedChange({
      supabase: fakeSupabase(new FakeDatabase()),
      projectId: PROJECT_ID,
      preparedChangeId: PREPARED_ID,
      reader: fakeReader({}),
    });

    expect(result).toBeNull();
  });
});
