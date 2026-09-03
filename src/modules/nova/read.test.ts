import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";

import {
  FakeDatabase,
  fakeSupabase,
  newQueryRecorder,
  readsOf,
  type QueryRecorder,
} from "@/modules/operations/test-support";

import { readNovaFocus, readNovaFocusFacts, stageFromRows } from "./read";

const USER = "user_1";
const PROJECT = "project_1";
const COMMIT = "a".repeat(40);
const BASE_SHA = "b".repeat(40);

/** Every table one prepared change makes Nova read. */
const LIFECYCLE_TABLES = [
  "prepared_changes",
  "validation_runs",
  "change_approvals",
  "change_merges",
  "change_outcome_verifications",
];

let db: FakeDatabase;
let recorder: QueryRecorder;

function client() {
  return fakeSupabase(db, recorder);
}

function reset() {
  db = new FakeDatabase();
  recorder = newQueryRecorder();
}

beforeEach(reset);

function seedProject() {
  db.seed("projects", { id: PROJECT, user_id: USER, production_url: "https://acme.test" });
}

function seedChange(index: number, validationStatus: "passed" | "failed" | null): string {
  const id = `prepared_${index}`;

  db.seed("prepared_changes", {
    id,
    project_id: PROJECT,
    user_id: USER,
    operation_run_id: `run_${index}`,
    opportunity_set_id: null,
    opportunity_id: null,
    execution_capability: "nextjs_seo_foundations_v2",
    execution_version: "1",
    repository_snapshot_id: "snapshot_1",
    base_branch: "main",
    base_sha: BASE_SHA,
    branch_name: `vibe/change-${index}`,
    commit_sha: COMMIT,
    files: [{ path: "src/app/robots.ts", contentHash: "c".repeat(64), bytes: 400 }],
    execution_identity: `identity_${index}`,
    status: "prepared",
    failure_code: null,
    created_at: new Date(Date.UTC(2026, 0, index)).toISOString(),
    completed_at: null,
  });

  if (validationStatus !== null) {
    db.seed("validation_runs", {
      id: `validation_${index}`,
      project_id: PROJECT,
      user_id: USER,
      prepared_change_id: id,
      status: validationStatus,
      prepared_commit_sha: COMMIT,
      validation_profile: "next_app_router",
      artifact_snapshot_id: `snapshot_${index}`,
      artifact_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      artifact_deleted_at: null,
      created_at: new Date(Date.UTC(2026, 0, index, 1)).toISOString(),
    });
  }

  return id;
}

function seedChanges(count: number, validationStatus: "passed" | "failed" | null = "passed") {
  seedProject();
  for (let index = 1; index <= count; index += 1) seedChange(index, validationStatus);
}

/**
 * The stage precedence, tested where it lives rather than through the database.
 *
 * `stageFromRows` is the one piece of `read.ts` that makes a judgement, and it
 * is pure, so every branch is reachable without seeding five tables. What the
 * database tests below are for is the property only I/O has: what a render
 * costs.
 */
describe("the stage of one change", () => {
  const clean = {
    commitSha: COMMIT,
    validationStatus: null,
    approval: null,
    mergeStatus: null,
    outcomeStatus: null,
  } as const;

  it("reads a merged change with no settled outcome as merged", () => {
    expect(stageFromRows({ ...clean, mergeStatus: "merged" })).toBe("merged");
  });

  it.each(["verified", "partial", "not_observed", "failed"])(
    "reads a merged change with a %s outcome as observed",
    (outcomeStatus) => {
      expect(stageFromRows({ ...clean, mergeStatus: "merged", outcomeStatus })).toBe("observed");
    },
  );

  it("reads an outcome still being observed as merged, not observed", () => {
    expect(stageFromRows({ ...clean, mergeStatus: "merged", outcomeStatus: "observing" })).toBe(
      "merged",
    );
  });

  it.each(["merging", "preflight"] as const)("reads %s as in flight", (mergeStatus) => {
    expect(stageFromRows({ ...clean, mergeStatus })).toBe("merging");
  });

  it.each(["blocked", "failed"] as const)("reads a %s merge as stalled", (mergeStatus) => {
    expect(stageFromRows({ ...clean, mergeStatus })).toBe("stalled");
  });

  it("reads a standing approval for this commit as ready to merge", () => {
    const stage = stageFromRows({
      ...clean,
      validationStatus: "passed",
      approval: { status: "approved", preparedCommitSha: COMMIT },
    });

    expect(stage).toBe("ready_to_merge");
  });

  /**
   * The approval is bound to a commit, and Vibe re-derives the full identity
   * before it writes anything. What must not happen here is the weaker error:
   * showing a merge control for a commit nobody approved.
   */
  it("does not read an approval of a different commit as ready to merge", () => {
    const stage = stageFromRows({
      ...clean,
      validationStatus: "passed",
      approval: { status: "approved", preparedCommitSha: "d".repeat(40) },
    });

    expect(stage).toBe("awaiting_approval");
  });

  it.each(["revoked", "invalidated"] as const)(
    "does not read a %s approval as ready to merge",
    (status) => {
      const stage = stageFromRows({
        ...clean,
        validationStatus: "passed",
        approval: { status, preparedCommitSha: COMMIT },
      });

      expect(stage).toBe("awaiting_approval");
    },
  );

  it("cannot reach ready to merge before a commit exists", () => {
    const stage = stageFromRows({
      ...clean,
      commitSha: null,
      validationStatus: "passed",
      approval: { status: "approved", preparedCommitSha: COMMIT },
    });

    expect(stage).toBe("awaiting_approval");
  });

  it("reads a failed check as a failed validation", () => {
    expect(stageFromRows({ ...clean, validationStatus: "failed" })).toBe("validation_failed");
  });

  it.each(["queued", "running"] as const)("reads a %s check as in flight", (validationStatus) => {
    expect(stageFromRows({ ...clean, validationStatus })).toBe("validating");
  });

  /**
   * A change nothing has checked must never read as one to look at — the
   * founder would take "review this" as "Vibe checked this" (rule 66).
   */
  it.each([null, "cancelled" as const])(
    "reads a change with %s validation as unvalidated",
    (validationStatus) => {
      expect(stageFromRows({ ...clean, validationStatus })).toBe("not_validated");
    },
  );

  it("reads a checked, unapproved change as awaiting approval", () => {
    expect(stageFromRows({ ...clean, validationStatus: "passed" })).toBe("awaiting_approval");
  });

  it("lets a landed merge outrank a failed check on the same change", () => {
    const stage = stageFromRows({ ...clean, validationStatus: "failed", mergeStatus: "merged" });

    expect(stage).toBe("merged");
  });
});

describe("what a render costs", () => {
  async function readWith(changes: number): Promise<QueryRecorder> {
    reset();
    seedChanges(changes);
    await readNovaFocusFacts(client(), PROJECT);
    return recorder;
  }

  it("reads each lifecycle table exactly once, however many changes there are", async () => {
    const counts = await readWith(8);

    for (const table of LIFECYCLE_TABLES) {
      expect(readsOf(counts, table), `${table} was read more than once`).toBe(1);
    }
  });

  it("does not grow with the number of prepared changes", async () => {
    const one = await readWith(1);
    const eight = await readWith(8);

    for (const table of LIFECYCLE_TABLES) {
      expect(readsOf(eight, table), table).toBe(readsOf(one, table));
    }
  });

  it("asks the lifecycle tables nothing when a project has no prepared changes", async () => {
    reset();
    seedProject();

    await readNovaFocusFacts(client(), PROJECT);

    expect(readsOf(recorder, "prepared_changes")).toBe(1);
    for (const table of LIFECYCLE_TABLES.filter((name) => name !== "prepared_changes")) {
      expect(readsOf(recorder, table), table).toBe(0);
    }
  });

  /** A read model that writes is a render with a side effect. */
  it("writes nothing at all", async () => {
    reset();
    seedChanges(3);

    await readNovaFocusFacts(client(), PROJECT);

    expect(recorder.writes).toEqual([]);
  });
});

describe("reading a project's focus", () => {
  it("leads with a failed validation", async () => {
    seedChanges(1, "failed");

    const focus = await readNovaFocus(client(), PROJECT);

    expect(focus.primary.kind).toBe("validation_failed");
    expect(focus.nextAction).toBe("nova.validate_again");
  });

  it("leads with a change to review when the check passed", async () => {
    seedChanges(1, "passed");

    const focus = await readNovaFocus(client(), PROJECT);

    expect(focus.primary.kind).toBe("review_change");
  });

  it("says nothing_to_do for an empty project", async () => {
    seedProject();

    const focus = await readNovaFocus(client(), PROJECT);

    expect(focus.primary.kind).toBe("nothing_to_do");
    expect(focus.working).toBeNull();
  });

  it("keeps a second change visible rather than hiding it behind the first", async () => {
    seedProject();
    seedChange(1, "failed");
    seedChange(2, "passed");

    const focus = await readNovaFocus(client(), PROJECT);

    expect(focus.primary.kind).toBe("validation_failed");
    expect(focus.secondary.map((candidate) => candidate.kind)).toEqual(["review_change"]);
  });

  /**
   * A project that has never been audited is not one whose audit is out of
   * date. Telling that founder to refresh something nobody ran would be a
   * missing measurement rendered as a bad one (rule 44).
   */
  it("does not call a never-run audit outdated", async () => {
    seedProject();

    const facts = await readNovaFocusFacts(client(), PROJECT);

    expect(facts.auditOutdated).toBe(false);
  });
});

/**
 * The invariants that are properties of the *source*, not of a run.
 *
 * The same shape as `dashboard-contract.test.ts`: some costs can only be
 * proven absent by looking at what the module is allowed to import, because a
 * test that never hits the branch never sees the network call on it.
 */
describe("what this module may never reach for", () => {
  const raw = readFileSync(new URL("./read.ts", import.meta.url), "utf8");
  /*
   * Comments stripped first, or the guard fires on the paragraph explaining
   * why `resolvePlanExecutionRoutes` is *not* called — which would make
   * documenting a deliberate omission the thing that fails the test.
   */
  const source = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  it("never reaches for a provider, a sandbox or GitHub", () => {
    for (const forbidden of [
      "createVercelSandboxProvider",
      "createGithubMergePort",
      "createGithubRepositoryReader",
      "VercelWorkflowExecutor",
      "getPreviewStatus",
      "getReviewImages",
      "resolvePlanExecutionRoutes",
    ]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });

  /** It bypasses RLS, and every fact here is scoped by a project's owner. */
  it("keeps the service-role client out", () => {
    expect(source).not.toContain("createServiceClient");
    expect(source).not.toContain("lib/supabase/service");
  });

  /**
   * The networked workspace read is the one an unwary refactor would reach for
   * to get a `ChangeProgress` — it is the reason `stageFromRows` exists.
   */
  it("does not assemble the full prepared-change workspace", () => {
    expect(source).not.toContain("getPreparedChangeWorkspace");
    expect(source).not.toContain("getMergeCard");
  });

  it("has no await inside a loop", () => {
    const loops = source.match(/for\s*\(const[^)]*\)\s*\{[\s\S]*?\n {2}\}/g) ?? [];
    for (const loop of loops) expect(loop).not.toContain("await ");
  });
});
