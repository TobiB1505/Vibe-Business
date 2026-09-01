import { beforeEach, describe, expect, it } from "vitest";
import {
  FakeDatabase,
  fakeSupabase,
  newQueryRecorder,
  readsOf,
  type QueryRecorder,
} from "@/modules/operations/test-support";
import { FIXTURE_ROUTES, fakeRepositorySnapshotFor } from "@/modules/execution/test-support";
import { getProjectImpact } from "./project-impact";

/**
 * The Experiments read model.
 *
 * ## What this file used to assert, and why it does not any more
 *
 * VB-024 bounded the concurrency of this page's GitHub calls: it walked its
 * prepared changes one at a time, and each step could reach GitHub through
 * `getMergeCard`, so ten changes meant ten sequential round trips. The tests
 * proved the work overlapped and that it did not overlap without limit.
 *
 * Both properties are gone because the calls are. `getMergeCard` spends up to
 * four read-only GitHub calls so it can tell a user whether an approved
 * branch is still where their approval expects it — the right question on the
 * Agent screen, and a meaningless one here, because this page lists changes
 * that **already merged** and a merged change is past that preflight. The
 * whole round trip was being spent to learn something `change_merges.status`
 * already states.
 *
 * So the guarantee this file keeps is the stronger one that replaced it: the
 * page reaches nothing outside the database, and its cost does not grow with
 * the number of changes.
 */

const USER = "user_1";
const PROJECT = "project_1";
const COMMIT = "a".repeat(40);

let db: FakeDatabase;
let recorder: QueryRecorder;

function client() {
  return fakeSupabase(db, recorder);
}

function seedChange(index: number, merged: boolean) {
  const id = `change_${index}`;

  db.seed("prepared_changes", {
    id,
    project_id: PROJECT,
    user_id: USER,
    operation_run_id: `run_${index}`,
    execution_capability: "nextjs_seo_foundations_v2",
    execution_version: "1",
    repository_snapshot_id: "snapshot_1",
    base_branch: "main",
    base_sha: "b".repeat(40),
    branch_name: `vibe/change-${index}`,
    commit_sha: COMMIT,
    files: [],
    execution_identity: `identity_${index}`,
    status: "prepared",
    created_at: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
  });

  if (!merged) return;

  db.seed("change_merges", {
    id: `merge_${index}`,
    project_id: PROJECT,
    user_id: USER,
    prepared_change_id: id,
    prepared_commit_sha: COMMIT,
    prepared_base_sha: "b".repeat(40),
    default_branch: "main",
    merge_policy_version: "merge-policy-v1",
    merge_strategy: "fast_forward_exact_commit",
    status: "merged",
    resulting_default_head_sha: COMMIT,
    merged_at: `2026-08-2${index}T00:00:00.000Z`,
    created_at: new Date(Date.UTC(2026, 0, index + 1, 1)).toISOString(),
  });
}

function seedProject() {
  db.seed("projects", { id: PROJECT, user_id: USER, production_url: "https://acme.test" });
  // A real analyzer shape, not `{}`: an empty result makes the outcome
  // contract unsupported, which is a different card from the one a merged
  // change with a real snapshot gets.
  db.seed("repository_intelligence_snapshots", {
    id: "snapshot_1",
    project_id: PROJECT,
    status: "completed",
    source_commit_sha: COMMIT,
    source_branch: "main",
    analyzer_version: "repo-intelligence-v2",
    completeness: "complete",
    completeness_reasons: [],
    result: {
      ...fakeRepositorySnapshotFor(),
      routes: { mode: "app_router", truncated: false, routes: FIXTURE_ROUTES },
    },
    created_at: "2026-01-01T00:00:00.000Z",
  });
}

async function impact() {
  return getProjectImpact(client(), {
    projectId: PROJECT,
    userId: USER,
    repositoryConnected: true,
  });
}

beforeEach(() => {
  db = new FakeDatabase();
  recorder = newQueryRecorder();
  seedProject();
});

describe("what the page shows", () => {
  it("lists the merged changes, newest first, and counts the rest", async () => {
    seedChange(0, true);
    seedChange(1, false);
    seedChange(2, true);
    seedChange(3, false);

    const result = await impact();

    expect(result.entries.map((entry) => entry.preparedChangeId)).toEqual([
      "change_2",
      "change_0",
    ]);
    expect(result.unmergedCount).toBe(2);
  });

  it("carries the merge instant from the merge row", async () => {
    seedChange(1, true);

    const [entry] = (await impact()).entries;

    expect(entry?.mergedAt).toBe("2026-08-21T00:00:00.000Z");
  });

  it("says nothing merged when nothing has", async () => {
    seedChange(0, false);
    seedChange(1, false);

    const result = await impact();

    expect(result.entries).toEqual([]);
    expect(result.unmergedCount).toBe(2);
  });
});

describe("what the page costs", () => {
  async function readCount(changes: number): Promise<number> {
    db = new FakeDatabase();
    recorder = newQueryRecorder();
    seedProject();
    for (let index = 0; index < changes; index += 1) seedChange(index, true);
    await impact();
    return recorder.reads.length;
  }

  it("does not grow with the number of merged changes", async () => {
    expect(await readCount(10)).toBe(await readCount(1));
  });

  it("never asks about a merge target, because it never asks GitHub", async () => {
    /*
     * `repository_connections` is what `resolveMergeTarget` reads before a
     * merge card can make its GitHub calls. Not reading it is the observable
     * shape of not making them — and it is the assertion that fails first if
     * anyone reintroduces `getMergeCard` here.
     */
    for (let index = 0; index < 4; index += 1) seedChange(index, true);

    await impact();

    expect(readsOf(recorder, "repository_connections")).toBe(0);
  });

  it("spends nothing at all on a project that has never merged", async () => {
    for (let index = 0; index < 5; index += 1) seedChange(index, false);

    await impact();

    // The merge table decides, and after that there is nothing to look up: no
    // measurement plan, no public origin, no repository snapshot.
    expect(readsOf(recorder, "measurement_plans")).toBe(0);
    expect(readsOf(recorder, "projects")).toBe(0);
    expect(readsOf(recorder, "repository_intelligence_snapshots")).toBe(0);
  });
});
