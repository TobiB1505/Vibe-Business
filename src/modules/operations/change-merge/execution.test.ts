import { beforeEach, describe, expect, it } from "vitest";
import { computeMergeIdentity } from "@/modules/merge/identity";
import { FAST_FORWARD_EXACT_COMMIT, MERGE_POLICY_VERSION } from "@/modules/merge/schema";
import {
  FakeMergePort,
  MERGE_BASE_SHA,
  MERGE_FIXTURES,
  MERGE_TARGET_SHA,
  MERGE_THIRD_SHA,
  seedApprovedChange,
  UnreachableMergePort,
} from "@/modules/merge/test-support";
import { FakeDatabase, fakeSupabase, type Row } from "@/modules/operations/test-support";
import {
  abortMergeStep,
  authorizeMergeStep,
  verifyMergeStep,
  writeMergeStep,
  type MergeDeps,
} from "./execution";

/**
 * The write path (Sprint 11C §38, §39, §41, §42).
 *
 * Every test in this file is ultimately about one number: **how many times the
 * default branch was written to**. On the paths that refuse it must be zero; on
 * the path that succeeds it must be one; on replay it must not become two. The
 * fake port counts, which is why these assertions are about the guarantee
 * rather than about the code's intentions.
 *
 * The in-memory database models the merge table's written-identity index and
 * its outcome constraints, so "cannot record a merge that was not verified" is
 * tested against what Postgres would do rather than what the step meant to do.
 */

let db: FakeDatabase;

function deps(port: FakeMergePort | UnreachableMergePort): MergeDeps {
  return { supabase: fakeSupabase(db), resolvePort: async () => port };
}

function seedOperation(): void {
  db.seed("operation_runs", {
    id: MERGE_FIXTURES.operation,
    project_id: MERGE_FIXTURES.project,
    user_id: MERGE_FIXTURES.user,
    operation_type: "change_merge",
    status: "queued",
    stage: "preparing",
    input_identity: identity(),
    created_at: "2026-08-14T04:00:00.000Z",
  });
}

function identity(): string {
  return computeMergeIdentity({
    projectId: MERGE_FIXTURES.project,
    preparedChangeId: MERGE_FIXTURES.preparedChange,
    changeApprovalId: MERGE_FIXTURES.approval,
    preparedCommitSha: MERGE_TARGET_SHA,
    preparedBaseSha: MERGE_BASE_SHA,
    mergePolicyVersion: MERGE_POLICY_VERSION,
  });
}

function seedMerge(overrides: Row = {}): void {
  db.seed("change_merges", {
    id: MERGE_FIXTURES.merge,
    project_id: MERGE_FIXTURES.project,
    user_id: MERGE_FIXTURES.user,
    prepared_change_id: MERGE_FIXTURES.preparedChange,
    change_approval_id: MERGE_FIXTURES.approval,
    repository_connection_id: MERGE_FIXTURES.connection,
    prepared_commit_sha: MERGE_TARGET_SHA,
    prepared_base_sha: MERGE_BASE_SHA,
    default_branch: "main",
    observed_default_head_before: null,
    merge_policy_version: MERGE_POLICY_VERSION,
    merge_strategy: FAST_FORWARD_EXACT_COMMIT,
    merge_identity: identity(),
    operation_run_id: MERGE_FIXTURES.operation,
    status: "preflight",
    resulting_default_head_sha: null,
    failure_code: null,
    preflight_checked_at: null,
    started_at: null,
    merged_at: null,
    failed_at: null,
    created_at: "2026-08-14T04:00:00.000Z",
    ...overrides,
  });
}

function mergeRow(): Row {
  const row = db.rows("change_merges").find((entry) => entry.id === MERGE_FIXTURES.merge);
  if (!row) throw new Error("merge row missing");
  return row;
}

function auditTypes(): string[] {
  return db.rows("audit_events").map((row) => String(row.event_type));
}

/** Runs the workflow's happy sequence against one port, as the workflow does. */
async function runMerge(port: FakeMergePort | UnreachableMergePort) {
  const authorized = await authorizeMergeStep(deps(port), MERGE_FIXTURES.operation);
  if (!authorized.ok) return authorized;

  const written = await writeMergeStep(deps(port), MERGE_FIXTURES.operation);
  if (!written.ok) return written;

  return verifyMergeStep(deps(port), MERGE_FIXTURES.operation);
}

beforeEach(() => {
  db = new FakeDatabase();
});

describe("the successful merge is exactly one non-force write (§38, §52)", () => {
  it("fast-forwards the default branch to the approved commit", async () => {
    seedApprovedChange(db);
    seedOperation();
    seedMerge();
    const port = new FakeMergePort();

    const outcome = await runMerge(port);

    expect(outcome.ok).toBe(true);
    expect(port.writes).toEqual([{ branch: "main", toSha: MERGE_TARGET_SHA }]);
    expect(port.currentHead).toBe(MERGE_TARGET_SHA);
  });

  it("records the merge only after reading the branch back (§22)", async () => {
    seedApprovedChange(db);
    seedOperation();
    seedMerge();
    const port = new FakeMergePort();

    // After the write step alone, the row must not claim success — a 2xx is a
    // claim about a request, not an observation of a branch.
    await authorizeMergeStep(deps(port), MERGE_FIXTURES.operation);
    await writeMergeStep(deps(port), MERGE_FIXTURES.operation);
    expect(mergeRow().status).toBe("merging");
    expect(mergeRow().resulting_default_head_sha).toBeNull();

    await verifyMergeStep(deps(port), MERGE_FIXTURES.operation);
    expect(mergeRow().status).toBe("merged");
    expect(mergeRow().resulting_default_head_sha).toBe(MERGE_TARGET_SHA);
  });

  it("marks the write attempted before making it, never after (§19)", async () => {
    seedApprovedChange(db);
    seedOperation();
    seedMerge();

    // The port asserts the invariant from inside the call: by the time the
    // write happens, the row must already say a write was attempted. Otherwise
    // an interrupted merge is indistinguishable from one that never started.
    let statusAtWriteTime: unknown = null;
    const port = new FakeMergePort();
    const original = port.fastForwardDefaultBranch.bind(port);
    port.fastForwardDefaultBranch = async (input) => {
      statusAtWriteTime = mergeRow().status;
      return original(input);
    };

    await runMerge(port);

    expect(statusAtWriteTime).toBe("merging");
  });

  it("emits the lifecycle events once each (§27)", async () => {
    seedApprovedChange(db);
    seedOperation();
    seedMerge();

    await runMerge(new FakeMergePort());

    expect(auditTypes()).toEqual([
      "change_merge.preflight_passed",
      "change_merge.default_branch_updated",
      "change_merge.verified",
    ]);
  });

  it("never records an installation token or provider prose in the audit log (§27, §34)", async () => {
    seedApprovedChange(db);
    seedOperation();
    seedMerge();

    await runMerge(new FakeMergePort());

    const serialized = JSON.stringify(db.rows("audit_events"));
    expect(serialized).not.toMatch(/ghs_|token|secret|Authorization/i);
  });
});

describe("every refusal writes nothing (§35, §36, §37)", () => {
  const cases: {
    name: string;
    seed: () => void;
    port: () => FakeMergePort;
    expected: string;
  }[] = [
    {
      name: "no approval exists",
      seed: () => seedApprovedChange(db, { withApproval: false }),
      port: () => new FakeMergePort(),
      expected: "merge_approval_required",
    },
    {
      name: "the approval was revoked",
      seed: () => seedApprovedChange(db, { approvalStatus: "revoked" }),
      port: () => new FakeMergePort(),
      expected: "merge_approval_required",
    },
    {
      name: "the approval was invalidated",
      seed: () => seedApprovedChange(db, { approvalStatus: "invalidated" }),
      port: () => new FakeMergePort(),
      expected: "merge_approval_required",
    },
    {
      name: "the default branch moved",
      seed: () => seedApprovedChange(db),
      port: () => new FakeMergePort({ headSha: MERGE_THIRD_SHA }),
      expected: "merge_repository_changed",
    },
    {
      name: "the prepared branch moved",
      seed: () => seedApprovedChange(db),
      port: () => new FakeMergePort({ preparedBranchHead: MERGE_THIRD_SHA }),
      expected: "merge_prepared_branch_changed",
    },
    {
      name: "the approved commit is gone",
      seed: () => seedApprovedChange(db),
      port: () => new FakeMergePort({ preparedCommitParents: null }),
      expected: "merge_prepared_commit_missing",
    },
    {
      name: "the commit is not a child of the base",
      seed: () => seedApprovedChange(db),
      port: () => new FakeMergePort({ preparedCommitParents: [MERGE_THIRD_SHA] }),
      expected: "merge_not_fast_forward",
    },
    {
      name: "write permission is gone",
      seed: () => seedApprovedChange(db),
      port: () => new FakeMergePort({ hasWritePermission: false }),
      expected: "merge_permission_missing",
    },
  ];

  for (const testCase of cases) {
    it(`blocks and writes nothing when ${testCase.name}`, async () => {
      testCase.seed();
      seedOperation();
      seedMerge();
      const port = testCase.port();

      const outcome = await runMerge(port);

      expect(outcome).toMatchObject({ ok: false, kind: "blocked", failureCode: testCase.expected });
      expect(port.writes).toHaveLength(0);
    });

    it(`records "blocked", not "failed", when ${testCase.name}`, async () => {
      testCase.seed();
      seedOperation();
      seedMerge();
      const port = testCase.port();

      const outcome = await runMerge(port);
      if (outcome.ok) throw new Error("expected a refusal");

      await abortMergeStep(deps(port), MERGE_FIXTURES.operation, {
        failureCode: outcome.failureCode,
      });

      // `blocked` is the database-enforced statement that the repository was
      // never touched (§29). Reporting these as `failed` would tell a user
      // their default branch might have been written to.
      expect(mergeRow().status).toBe("blocked");
      expect(mergeRow().started_at).toBeNull();
      expect(auditTypes()).toContain("change_merge.blocked");
    });
  }

  it("blocks when the approval that authorized this merge is no longer the standing one", async () => {
    // A re-approval of a regenerated artifact is authority for something else.
    seedApprovedChange(db);
    seedOperation();
    seedMerge({ change_approval_id: "approval_from_another_life" });
    const port = new FakeMergePort();

    const outcome = await runMerge(port);

    expect(outcome).toMatchObject({ kind: "blocked", failureCode: "merge_approval_invalid" });
    expect(port.writes).toHaveLength(0);
  });

  it("blocks and writes nothing when GitHub cannot be reached", async () => {
    seedApprovedChange(db);
    seedOperation();
    seedMerge();
    const port = new UnreachableMergePort();

    const outcome = await runMerge(port);

    expect(outcome).toMatchObject({ kind: "blocked", failureCode: "merge_provider_unavailable" });
    expect(port.writes).toHaveLength(0);
  });
});

describe("branch protection is respected, never bypassed (§37)", () => {
  it("classifies a protection rejection and does not retry", async () => {
    seedApprovedChange(db);
    seedOperation();
    seedMerge();
    const port = new FakeMergePort({
      writeOutcomes: [{ kind: "rejected", reason: "protected_branch" }],
    });

    const outcome = await runMerge(port);

    expect(outcome).toMatchObject({ kind: "failed", failureCode: "merge_protected_branch" });
    // One attempt, refused, and no second one. There is no force path to fall
    // back to, which is the point of the port having no force parameter.
    expect(port.writes).toHaveLength(1);
  });

  it("classifies a permission rejection without attempting anything else", async () => {
    seedApprovedChange(db);
    seedOperation();
    seedMerge();
    const port = new FakeMergePort({
      writeOutcomes: [{ kind: "rejected", reason: "permission_denied" }],
    });

    const outcome = await runMerge(port);

    expect(outcome).toMatchObject({ kind: "failed", failureCode: "merge_permission_missing" });
    expect(port.writes).toHaveLength(1);
  });

  it("classifies a late non-fast-forward rejection, which is GitHub closing our race", async () => {
    // The branch moved between our read and our write. `force: false` makes the
    // worst case a refusal rather than an overwrite (§21).
    seedApprovedChange(db);
    seedOperation();
    seedMerge();
    const port = new FakeMergePort({
      writeOutcomes: [{ kind: "rejected", reason: "not_fast_forward" }],
    });

    const outcome = await runMerge(port);

    expect(outcome).toMatchObject({ kind: "failed", failureCode: "merge_not_fast_forward" });
    expect(port.writes).toHaveLength(1);
  });
});

describe("ambiguous writes are reconciled by reading, never by retrying (§19, §38)", () => {
  it("treats an ambiguous write whose branch reached the target as a success", async () => {
    seedApprovedChange(db);
    seedOperation();
    seedMerge();
    const port = new FakeMergePort({
      writeOutcomes: [{ kind: "ambiguous" }],
      // The write landed; the response was lost.
      headAfterAmbiguous: MERGE_TARGET_SHA,
    });

    const outcome = await runMerge(port);

    expect(outcome.ok).toBe(true);
    expect(port.writes).toHaveLength(1);
    expect(mergeRow().status).toBe("merged");
  });

  it("does not retry when the branch is still at the base", async () => {
    seedApprovedChange(db);
    seedOperation();
    seedMerge();
    const port = new FakeMergePort({
      writeOutcomes: [{ kind: "ambiguous" }],
      headAfterAmbiguous: MERGE_BASE_SHA,
    });

    const outcome = await runMerge(port);

    // The explicit safe policy: recovery from an ambiguous default-branch write
    // is a fresh human action that re-runs the whole preflight — never an
    // automatic second attempt from inside the same step.
    expect(outcome).toMatchObject({ kind: "failed", failureCode: "merge_write_failed" });
    expect(port.writes).toHaveLength(1);
  });

  it("stops on a third state rather than guessing", async () => {
    seedApprovedChange(db);
    seedOperation();
    seedMerge();
    const port = new FakeMergePort({
      writeOutcomes: [{ kind: "ambiguous" }],
      headAfterAmbiguous: MERGE_THIRD_SHA,
    });

    const outcome = await runMerge(port);

    expect(outcome).toMatchObject({
      kind: "failed",
      failureCode: "merge_ambiguous_write",
      observedHead: MERGE_THIRD_SHA,
    });
    expect(port.writes).toHaveLength(1);
  });

  it("records the observed head so the failure can be diagnosed", async () => {
    seedApprovedChange(db);
    seedOperation();
    seedMerge();
    const port = new FakeMergePort({
      writeOutcomes: [{ kind: "ambiguous" }],
      headAfterAmbiguous: MERGE_THIRD_SHA,
    });

    const outcome = await runMerge(port);
    if (outcome.ok) throw new Error("expected a failure");

    await abortMergeStep(deps(port), MERGE_FIXTURES.operation, {
      failureCode: outcome.failureCode,
      observedHead: "observedHead" in outcome ? outcome.observedHead : null,
    });

    expect(mergeRow().status).toBe("failed");
    expect(mergeRow().resulting_default_head_sha).toBe(MERGE_THIRD_SHA);
    expect(auditTypes()).toContain("change_merge.failed");
  });

  it("does not retry when the branch cannot be read at all afterwards", async () => {
    seedApprovedChange(db);
    seedOperation();
    seedMerge();
    const port = new FakeMergePort({
      writeOutcomes: [{ kind: "ambiguous" }],
      headAfterAmbiguous: null,
    });

    const outcome = await runMerge(port);

    expect(outcome).toMatchObject({ kind: "failed", failureCode: "merge_provider_unavailable" });
    expect(port.writes).toHaveLength(1);
  });
});

describe("replay and double submission produce one write (§20, §38)", () => {
  it("does not write again when the branch already holds the approved commit", async () => {
    seedApprovedChange(db);
    seedOperation();
    seedMerge();
    const port = new FakeMergePort();

    await runMerge(port);
    // The workflow replays from the top against the post-merge world.
    const replayed = await runMerge(port);

    expect(replayed.ok).toBe(true);
    expect(port.writes).toHaveLength(1);
    expect(mergeRow().status).toBe("merged");
  });

  it("refuses a second write when the row already says one was attempted", async () => {
    seedApprovedChange(db);
    seedOperation();
    seedMerge();
    const port = new FakeMergePort();

    // A replay of the write step alone, with the branch still at the base —
    // the case where a naive implementation happily writes twice.
    await authorizeMergeStep(deps(port), MERGE_FIXTURES.operation);
    await writeMergeStep(deps(port), MERGE_FIXTURES.operation);

    // Wind the fake branch back, as though the first write never landed, and
    // replay. The row is the lock, so the step must still refuse.
    const replayPort = new FakeMergePort({ headSha: MERGE_BASE_SHA });
    const outcome = await writeMergeStep(deps(replayPort), MERGE_FIXTURES.operation);

    expect(outcome.ok).toBe(true);
    expect(replayPort.writes).toHaveLength(0);
  });

  it("verifies rather than re-merges when someone merged the commit by hand", async () => {
    seedApprovedChange(db);
    seedOperation();
    seedMerge();
    // The branch is already there and no Vibe write ever happened.
    const port = new FakeMergePort({ headSha: MERGE_TARGET_SHA });

    const outcome = await runMerge(port);

    expect(outcome.ok).toBe(true);
    expect(port.writes).toHaveLength(0);
    expect(mergeRow().status).toBe("merged");
  });
});

describe("verification decides, and only exact equality passes (§39)", () => {
  it("refuses to mark merged when the read-back is a different commit", async () => {
    seedApprovedChange(db);
    seedOperation();
    seedMerge({
      status: "merging",
      preflight_checked_at: "2026-08-14T04:01:00.000Z",
      started_at: "2026-08-14T04:02:00.000Z",
      observed_default_head_before: MERGE_BASE_SHA,
    });

    // GitHub accepted a write, and the branch is now somewhere else entirely.
    const port = new FakeMergePort({ headSha: MERGE_THIRD_SHA });
    const outcome = await verifyMergeStep(deps(port), MERGE_FIXTURES.operation);

    expect(outcome).toMatchObject({
      kind: "failed",
      failureCode: "merge_verification_failed",
      observedHead: MERGE_THIRD_SHA,
    });
    expect(mergeRow().status).toBe("merging");
  });

  it("refuses to mark merged when the branch merely moved forward", async () => {
    // "The branch changed somehow" is not verification. A branch that moved to
    // somebody else's commit is not this change being merged.
    seedApprovedChange(db);
    seedOperation();
    seedMerge({
      status: "merging",
      preflight_checked_at: "2026-08-14T04:01:00.000Z",
      started_at: "2026-08-14T04:02:00.000Z",
    });

    const port = new FakeMergePort({ headSha: MERGE_THIRD_SHA });
    await verifyMergeStep(deps(port), MERGE_FIXTURES.operation);

    expect(db.rows("change_merges").every((row) => row.status !== "merged")).toBe(true);
  });

  it("fails verification rather than claiming success when GitHub cannot be read", async () => {
    seedApprovedChange(db);
    seedOperation();
    seedMerge({
      status: "merging",
      preflight_checked_at: "2026-08-14T04:01:00.000Z",
      started_at: "2026-08-14T04:02:00.000Z",
    });

    const outcome = await verifyMergeStep(deps(new UnreachableMergePort()), MERGE_FIXTURES.operation);

    expect(outcome).toMatchObject({ kind: "failed", failureCode: "merge_provider_unavailable" });
  });

  it("cannot store a merged row whose result is not the approved commit", async () => {
    // The database's own guarantee, asserted directly: even if every check
    // above were removed, this row cannot exist.
    seedApprovedChange(db);
    seedOperation();
    seedMerge({
      status: "merging",
      preflight_checked_at: "2026-08-14T04:01:00.000Z",
      started_at: "2026-08-14T04:02:00.000Z",
    });

    const error = db.checkConstraints(
      "change_merges",
      {
        ...mergeRow(),
        status: "merged",
        merged_at: "2026-08-14T04:03:00.000Z",
        resulting_default_head_sha: MERGE_THIRD_SHA,
      },
      // Excluded so this asserts the CHECK constraint rather than the row
      // colliding with its own written-identity index.
      MERGE_FIXTURES.merge,
    );

    expect(error?.message).toBe("change_merges_merged_matches_approved_commit");
  });

  it("cannot store a merged row with no observed result at all", async () => {
    seedApprovedChange(db);
    seedOperation();
    seedMerge();

    const error = db.checkConstraints(
      "change_merges",
      {
        ...mergeRow(),
        status: "merged",
        merged_at: "2026-08-14T04:03:00.000Z",
        resulting_default_head_sha: null,
      },
      MERGE_FIXTURES.merge,
    );

    expect(error?.message).toBe("change_merges_merged_matches_approved_commit");
  });
});

describe("a merge deletes nothing and starts nothing (§41, §42)", () => {
  it("leaves the prepared branch untouched on success", async () => {
    seedApprovedChange(db);
    seedOperation();
    seedMerge();
    const port = new FakeMergePort();

    await runMerge(port);

    // Structural rather than incidental: the port has no delete operation, so
    // there is no call that could have removed it (§33).
    expect(Object.keys(port)).not.toContain("deletes");
    expect(db.rows("prepared_changes")).toHaveLength(1);
    expect(db.rows("prepared_changes")[0].branch_name).toBe("vibe/seo-foundations");
  });

  it("leaves the prepared branch untouched on failure", async () => {
    seedApprovedChange(db);
    seedOperation();
    seedMerge();
    const port = new FakeMergePort({
      writeOutcomes: [{ kind: "rejected", reason: "protected_branch" }],
    });

    await runMerge(port);

    expect(db.rows("prepared_changes")[0].branch_name).toBe("vibe/seo-foundations");
  });

  it("preserves the approval after a successful merge (§23)", async () => {
    seedApprovedChange(db);
    seedOperation();
    seedMerge();

    await runMerge(new FakeMergePort());

    expect(db.rows("change_approvals")).toHaveLength(1);
    expect(db.rows("change_approvals")[0].status).toBe("approved");
  });

  it("starts no analysis, validation, preview or review — on any path (§42)", async () => {
    for (const port of [
      new FakeMergePort(),
      new FakeMergePort({ headSha: MERGE_THIRD_SHA }),
      new FakeMergePort({ writeOutcomes: [{ kind: "rejected", reason: "protected_branch" }] }),
    ]) {
      db = new FakeDatabase();
      seedApprovedChange(db);
      seedOperation();
      seedMerge();

      await runMerge(port);

      // A blocked merge explains what changed; it never spends provider time
      // fixing it on the user's behalf (CLAUDE.md rule 60, §29).
      for (const table of [
        "repository_intelligence_snapshots",
        "business_readiness_audits",
        "opportunity_sets",
        "validation_runs",
        "preview_sessions",
        "review_artifacts",
        "ai_usage_events",
        "sandbox_usage_events",
        "review_browser_usage",
      ]) {
        const seeded = ["validation_runs", "review_artifacts"].includes(table) ? 1 : 0;
        expect(db.rows(table), `${table} grew during a merge`).toHaveLength(seeded);
      }

      // And exactly one operation: the merge's own.
      expect(db.rows("operation_runs")).toHaveLength(1);
    }
  });
});
