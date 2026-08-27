import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { FakeDatabase, FakeExecutor, fakeSupabase } from "@/modules/operations/test-support";
import { computeMergeIdentity } from "./identity";
import { MERGE_POLICY_VERSION } from "./schema";
import { getMergeCard, startMerge } from "./service";
import {
  FakeMergePort,
  MERGE_BASE_SHA,
  MERGE_FIXTURES,
  MERGE_TARGET_SHA,
  MERGE_THIRD_SHA,
  seedApprovedChange,
} from "./test-support";

/**
 * The request boundary (Sprint 11C §14, §16, §17, §20).
 *
 * Everything downstream of this function can move a customer's default branch,
 * so the tests here are mostly about what it refuses and what it never lets a
 * caller say. The write itself is tested in `change-merge/execution.test.ts`;
 * what matters here is that nothing reaches that step without a confirmation,
 * an owner, and an approval of exactly these bytes.
 */

let db: FakeDatabase;
let executor: FakeExecutor;

function client() {
  return fakeSupabase(db);
}

function start(
  port: FakeMergePort,
  overrides: { confirmed?: boolean; userId?: string; changeApprovalId?: string } = {},
) {
  return startMerge(client(), executor, port, {
    projectId: MERGE_FIXTURES.project,
    userId: overrides.userId ?? MERGE_FIXTURES.user,
    preparedChangeId: MERGE_FIXTURES.preparedChange,
    changeApprovalId: overrides.changeApprovalId ?? MERGE_FIXTURES.approval,
    confirmed: overrides.confirmed ?? true,
  });
}

beforeEach(() => {
  db = new FakeDatabase();
  executor = new FakeExecutor();
});

describe("confirmation is enforced on the server (§16)", () => {
  it("refuses an unconfirmed call", async () => {
    seedApprovedChange(db);

    const outcome = await start(new FakeMergePort(), { confirmed: false });

    expect(outcome).toEqual({ kind: "blocked", reason: "merge_confirmation_required" });
  });

  it("leaves absolutely nothing behind when unconfirmed", async () => {
    seedApprovedChange(db);
    const port = new FakeMergePort();

    await start(port, { confirmed: false });

    // No row, no operation, no audit event, no GitHub request. The refusal
    // happens before any state is read, so there is no evidence anything was
    // ever attempted (§16).
    expect(db.rows("change_merges")).toHaveLength(0);
    expect(db.rows("operation_runs")).toHaveLength(0);
    expect(db.rows("audit_events")).toHaveLength(0);
    expect(executor.starts).toHaveLength(0);
    expect(port.writes).toHaveLength(0);
    expect(port.headReads).toHaveLength(0);
  });

  it("refuses a caller who does not own the project", async () => {
    seedApprovedChange(db);

    const outcome = await start(new FakeMergePort(), { userId: "someone_else" });

    expect(outcome).toEqual({ kind: "blocked", reason: "merge_not_authorized" });
    expect(db.rows("change_merges")).toHaveLength(0);
  });
});

describe("the client cannot choose what is merged (§14)", () => {
  it("refuses an approval id the server did not resolve", async () => {
    // A stale tab holding a revoked approval's id. The server resolves the
    // standing approval independently and refuses when the two disagree.
    seedApprovedChange(db);

    const outcome = await start(new FakeMergePort(), { changeApprovalId: "approval_from_a_stale_tab" });

    expect(outcome).toEqual({ kind: "blocked", reason: "merge_approval_invalid" });
    expect(executor.starts).toHaveLength(0);
  });

  it("takes the target commit from the approval, never from the caller", async () => {
    seedApprovedChange(db);

    await start(new FakeMergePort());

    const merge = db.rows("change_merges")[0];
    expect(merge.prepared_commit_sha).toBe(MERGE_TARGET_SHA);
    expect(merge.prepared_base_sha).toBe(MERGE_BASE_SHA);
  });

  it("takes the default branch from GitHub, never from the stored connection", async () => {
    seedApprovedChange(db);
    // The connection row says `main`; GitHub says `trunk`. GitHub wins, because
    // a branch can be renamed and a stale name addresses the wrong ref.
    const port = new FakeMergePort({ defaultBranchName: "trunk" });

    await start(port);

    expect(db.rows("change_merges")[0].default_branch).toBe("trunk");
  });

  it("exposes only identifiers and a confirmation on the action signature", () => {
    const action = readFileSync(
      join(process.cwd(), "src/app/app/projects/[projectId]/merge-actions.ts"),
      "utf8",
    );

    // The whole surface, asserted structurally: three ids and a boolean. A
    // parameter for the target SHA or the branch is the one addition that would
    // let a caller move a default branch to bytes nobody approved.
    expect(action).toMatch(
      /mergeApprovedChangeAction\(\s*projectId: string,\s*preparedChangeId: string,\s*changeApprovalId: string,\s*confirmed: boolean,\s*\)/,
    );
    expect(action).not.toMatch(/targetSha|toSha|defaultBranch:|branchName|mergeStrategy|force/);
  });
});

describe("an eligible merge is enqueued exactly once (§18, §20)", () => {
  it("creates one operation, one merge row and one durable run", async () => {
    seedApprovedChange(db);

    const outcome = await start(new FakeMergePort());

    expect(outcome.kind).toBe("started");
    expect(db.rows("operation_runs")).toHaveLength(1);
    expect(db.rows("change_merges")).toHaveLength(1);
    expect(executor.starts).toEqual([
      { operationId: db.rows("operation_runs")[0].id, operationType: "change_merge" },
    ]);
  });

  it("creates the merge row in a state that claims nothing", async () => {
    seedApprovedChange(db);

    await start(new FakeMergePort());

    const merge = db.rows("change_merges")[0];
    expect(merge.status).toBe("preflight");
    // `?? null` because the insert omits these columns entirely rather than
    // writing nulls into them — which is the point: there is no code path on
    // the request side that sets an outcome, and the RLS policy refuses one
    // anyway.
    expect(merge.started_at ?? null).toBeNull();
    expect(merge.merged_at ?? null).toBeNull();
    expect(merge.resulting_default_head_sha ?? null).toBeNull();
    expect(merge.failure_code ?? null).toBeNull();
    expect(merge.merge_strategy).toBe("fast_forward_exact_commit");
    expect(merge.merge_policy_version).toBe(MERGE_POLICY_VERSION);
  });

  it("binds the merge to the exact approval that authorized it", async () => {
    seedApprovedChange(db);

    await start(new FakeMergePort());

    expect(db.rows("change_merges")[0].change_approval_id).toBe(MERGE_FIXTURES.approval);
    expect(db.rows("change_merges")[0].merge_identity).toBe(
      computeMergeIdentity({
        projectId: MERGE_FIXTURES.project,
        preparedChangeId: MERGE_FIXTURES.preparedChange,
        changeApprovalId: MERGE_FIXTURES.approval,
        preparedCommitSha: MERGE_TARGET_SHA,
        preparedBaseSha: MERGE_BASE_SHA,
        mergePolicyVersion: MERGE_POLICY_VERSION,
      }),
    );
  });

  it("returns the live operation on a double click rather than starting a second", async () => {
    seedApprovedChange(db);
    const port = new FakeMergePort();

    const first = await start(port);
    const second = await start(port);

    expect(first.kind).toBe("started");
    expect(second.kind).toBe("active");
    expect(db.rows("operation_runs")).toHaveLength(1);
    expect(executor.starts).toHaveLength(1);
  });

  it("writes nothing to GitHub on the request path (§17)", async () => {
    seedApprovedChange(db);
    const port = new FakeMergePort();

    await start(port);

    // The request only reads. Every consequential write happens inside the
    // durable step, after its own fresh preflight.
    expect(port.writes).toHaveLength(0);
  });

  it("fails the operation when the durable run cannot be enqueued", async () => {
    seedApprovedChange(db);
    executor = new FakeExecutor({ fail: true });

    const outcome = await start(new FakeMergePort());

    expect(outcome).toEqual({ kind: "blocked", reason: "merge_provider_unavailable" });
    // Left queued with nothing carrying it, the operation would block this
    // merge's identity forever.
    expect(db.rows("operation_runs")[0].status).toBe("failed");
  });
});

describe("refusals never start durable work (§29, §42)", () => {
  it("blocks a drifted repository without creating an operation or a row", async () => {
    seedApprovedChange(db);
    const port = new FakeMergePort({ headSha: MERGE_THIRD_SHA });

    const outcome = await start(port);

    expect(outcome).toEqual({ kind: "blocked", reason: "merge_repository_changed" });
    expect(db.rows("operation_runs")).toHaveLength(0);
    expect(db.rows("change_merges")).toHaveLength(0);
    expect(port.writes).toHaveLength(0);
  });

  it("records the refusal as an event rather than a junk merge row", async () => {
    seedApprovedChange(db);

    await start(new FakeMergePort({ headSha: MERGE_THIRD_SHA }));

    const events = db.rows("audit_events");
    expect(events).toHaveLength(1);
    expect(events[0].event_type).toBe("change_merge.blocked");
    expect(db.rows("change_merges")).toHaveLength(0);
  });

  it("starts no re-analysis, re-validation or re-review when it blocks (§42)", async () => {
    seedApprovedChange(db);

    await start(new FakeMergePort({ headSha: MERGE_THIRD_SHA }));

    // Blocked work explains what needs refreshing; the user starts it
    // (CLAUDE.md rule 60).
    for (const table of ["repository_intelligence_snapshots", "business_readiness_audits", "preview_sessions"]) {
      expect(db.rows(table)).toHaveLength(0);
    }
    expect(db.rows("validation_runs")).toHaveLength(1);
    expect(db.rows("review_artifacts")).toHaveLength(1);
  });

  it("blocks when no repository is connected", async () => {
    db.seed("projects", { id: MERGE_FIXTURES.project, user_id: MERGE_FIXTURES.user });

    const outcome = await start(new FakeMergePort());

    expect(outcome).toEqual({ kind: "blocked", reason: "merge_repository_unavailable" });
  });
});

describe("the merge card is read-only and authorizes nothing (§17)", () => {
  it("reports ready when the artifact is approved and the branch has not moved", async () => {
    seedApprovedChange(db);

    const card = await getMergeCard(client(), new FakeMergePort(), {
      projectId: MERGE_FIXTURES.project,
      userId: MERGE_FIXTURES.user,
      preparedChangeId: MERGE_FIXTURES.preparedChange,
    });

    expect(card).toMatchObject({
      state: "ready",
      canMerge: true,
      defaultBranch: "main",
      currentDefaultHeadSha: MERGE_BASE_SHA,
      targetCommitSha: MERGE_TARGET_SHA,
      deploymentVerified: false,
    });
  });

  it("spends no GitHub call at all when nothing is approved", async () => {
    // Opening a project page must not cost a round trip per prepared change
    // for an answer nobody can act on.
    seedApprovedChange(db, { withApproval: false });
    const port = new FakeMergePort();

    const card = await getMergeCard(client(), port, {
      projectId: MERGE_FIXTURES.project,
      userId: MERGE_FIXTURES.user,
      preparedChangeId: MERGE_FIXTURES.preparedChange,
    });

    expect(card.state).toBe("not_eligible");
    expect(card.canMerge).toBe(false);
    expect(port.headReads).toHaveLength(0);
  });

  it("never writes while rendering", async () => {
    seedApprovedChange(db);
    const port = new FakeMergePort();

    await getMergeCard(client(), port, {
      projectId: MERGE_FIXTURES.project,
      userId: MERGE_FIXTURES.user,
      preparedChangeId: MERGE_FIXTURES.preparedChange,
    });

    expect(port.writes).toHaveLength(0);
    expect(db.rows("change_merges")).toHaveLength(0);
    expect(db.rows("operation_runs")).toHaveLength(0);
  });

  it("says a drifted repository is not mergeable, with copy the user can act on", async () => {
    seedApprovedChange(db);

    const card = await getMergeCard(client(), new FakeMergePort({ headSha: MERGE_THIRD_SHA }), {
      projectId: MERGE_FIXTURES.project,
      userId: MERGE_FIXTURES.user,
      preparedChangeId: MERGE_FIXTURES.preparedChange,
    });

    expect(card.state).toBe("not_eligible");
    expect(card.canMerge).toBe(false);
    expect(card.failureCode).toBe("merge_repository_changed");
    expect(card.failureMessage).toMatch(/default branch changed/i);
    expect(card.failureMessage).toMatch(/did not modify/i);
  });

  it("never claims a deployment, in any state", async () => {
    seedApprovedChange(db);

    for (const port of [new FakeMergePort(), new FakeMergePort({ headSha: MERGE_TARGET_SHA })]) {
      const card = await getMergeCard(client(), port, {
        projectId: MERGE_FIXTURES.project,
        userId: MERGE_FIXTURES.user,
        preparedChangeId: MERGE_FIXTURES.preparedChange,
      });

      expect(card.deploymentVerified).toBe(false);
    }
  });
});

describe("an approved change that cannot be merged is recorded once", () => {
  /**
   * The gap the first real merge dogfood exposed.
   *
   * `startMerge` records `change_merge.blocked` on every refusal it reaches —
   * but the UI withholds the button when the render-time preflight already says
   * no, so that path is never reached. `main` had moved, the product correctly
   * declined, and nothing anywhere recorded that it had.
   *
   * These tests pin the two halves that make the fix safe: it records the state
   * worth remembering, and it does **not** record one entry per page view.
   */
  function notEligibleEvents() {
    return db.rows("audit_events").filter((row) => row.event_type === "change_merge.not_eligible");
  }

  const drifted = () => new FakeMergePort({ headSha: MERGE_THIRD_SHA });

  /**
   * A client whose `audit_events` reads fail but whose writes still work.
   *
   * Narrow on purpose: the store's dedup lookup is the only read of this table,
   * so failing it exercises the "unknown" path without also disabling the write
   * the test is checking for the absence of.
   */
  function withFailingAuditReads(base: ReturnType<typeof client>) {
    const failing = {
      select: () => failing,
      eq: () => failing,
      order: () => failing,
      limit: () => failing,
      maybeSingle: async () => ({ data: null, error: { message: "read failed" } }),
    };

    return new Proxy(base, {
      get(target, property, receiver) {
        if (property !== "from") return Reflect.get(target, property, receiver);
        return (table: string) => {
          const real = target.from(table);
          if (table !== "audit_events") return real;
          return Object.assign(Object.create(real as object), real, {
            select: () => failing,
          });
        };
      },
    });
  }

  function render(port: FakeMergePort) {
    return getMergeCard(client(), port, {
      projectId: MERGE_FIXTURES.project,
      userId: MERGE_FIXTURES.user,
      preparedChangeId: MERGE_FIXTURES.preparedChange,
    });
  }

  it("records the refusal, with what the branch was doing", async () => {
    seedApprovedChange(db);

    await render(drifted());

    expect(notEligibleEvents()).toHaveLength(1);
    expect(notEligibleEvents()[0].metadata).toMatchObject({
      project_id: MERGE_FIXTURES.project,
      prepared_change_id: MERGE_FIXTURES.preparedChange,
      failure_code: "merge_repository_changed",
      // Without both SHAs the entry cannot say what "changed" means.
      observed_default_head_sha: MERGE_THIRD_SHA,
      approved_commit_sha: MERGE_TARGET_SHA,
    });

    // The real column, not only the payload copy. ADR 0056 §8's erasure scrub
    // strips `project_id` from the metadata, and the deduplicating read below
    // filters on this column — if it were ever unpopulated, the dedup would
    // match nothing and this would go back to logging one entry per render.
    expect(notEligibleEvents()[0].project_id).toBe(MERGE_FIXTURES.project);
  });

  it("does not write one entry per render", async () => {
    seedApprovedChange(db);

    // Three page loads of the same unchanged situation.
    await render(drifted());
    await render(drifted());
    await render(drifted());

    // An audit log that grows with page views is a page-view log.
    expect(notEligibleEvents()).toHaveLength(1);
  });

  it("records again when the reason changes", async () => {
    seedApprovedChange(db);

    await render(drifted());
    // The branch is back where it belongs, but the app lost write permission:
    // a different fact, and one a reader needs separately.
    await render(new FakeMergePort({ hasWritePermission: false }));

    expect(notEligibleEvents().map((row) => (row.metadata as Record<string, unknown>).failure_code))
      .toEqual(["merge_repository_changed", "merge_permission_missing"]);
  });

  it("stays silent when nothing has been approved", async () => {
    // The resting state of every change nobody has decided on. Recording it
    // would mostly log the absence of a decision.
    seedApprovedChange(db, { withApproval: false });

    await render(drifted());

    expect(notEligibleEvents()).toHaveLength(0);
  });

  it("stays silent when the change is mergeable", async () => {
    seedApprovedChange(db);

    await render(new FakeMergePort());

    expect(notEligibleEvents()).toHaveLength(0);
  });

  it("stays silent when a previous attempt already failed", async () => {
    // The card shows `failed` — an attempt that touched GitHub and did not end
    // verified — and its failure code belongs to that attempt. Logging it as a
    // fresh "cannot be merged" observation would record the old attempt's
    // reason as though Vibe had just declined for it.
    seedApprovedChange(db);
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
      merge_policy_version: "merge-policy-v1",
      merge_strategy: "fast_forward_exact_commit",
      merge_identity: "m".repeat(64),
      status: "failed",
      failure_code: "merge_write_unverified",
      failed_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    });

    // Drifted, so the eligibility answer *is* a refusal — and the card still
    // shows the earlier failed attempt, because "we tried and it did not
    // finish" outranks "it cannot be merged right now".
    const card = await render(drifted());

    expect(card.state).toBe("failed");
    expect(notEligibleEvents()).toHaveLength(0);
  });

  it("stays silent when the last reason could not be read", async () => {
    // A failed dedup read must not be mistaken for "nothing recorded yet".
    // Treating the two the same would write on every render for as long as the
    // read keeps failing — the page-view log this guard exists to prevent,
    // arriving through the error path instead of the happy one.
    seedApprovedChange(db);
    const blind = withFailingAuditReads(client());

    await getMergeCard(blind, drifted(), {
      projectId: MERGE_FIXTURES.project,
      userId: MERGE_FIXTURES.user,
      preparedChangeId: MERGE_FIXTURES.preparedChange,
    });
    await getMergeCard(blind, drifted(), {
      projectId: MERGE_FIXTURES.project,
      userId: MERGE_FIXTURES.user,
      preparedChangeId: MERGE_FIXTURES.preparedChange,
    });

    expect(notEligibleEvents()).toHaveLength(0);
  });

  it("returns the same card whether or not it recorded anything", async () => {
    seedApprovedChange(db);

    const first = await render(drifted());
    const second = await render(drifted());

    // The second render records nothing, and the user must not be able to tell.
    expect(second).toEqual(first);
  });
});
