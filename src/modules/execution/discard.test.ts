import { beforeEach, describe, expect, it } from "vitest";
import { FakeDatabase, fakeSupabase } from "@/modules/operations/test-support";
import { discardChange } from "./discard";

/**
 * Rejecting a prepared change.
 *
 * The product had no way to say no. `PreparedChangeStatus` carried a fourth
 * value from the table's first day that no CHECK admitted, nothing wrote and
 * nothing read — so an unwanted change stayed `prepared` forever, kept
 * answering "this Move already has a prepared change", and held the
 * single-active index against its own execution identity, which meant the step
 * could not be run again either.
 */

const PROJECT = "project_1";
const USER = "user_1";
const CHANGE = "prepared_1";

let db: FakeDatabase;

function seed(options: { status?: string; projectId?: string; userId?: string } = {}) {
  db.seed("projects", { id: options.projectId ?? PROJECT, user_id: options.userId ?? USER });
  db.seed("prepared_changes", {
    id: CHANGE,
    project_id: options.projectId ?? PROJECT,
    user_id: options.userId ?? USER,
    // The agent's capability, which is what every real change carries now, and
    // the one the opportunity-set constraint does not require a set id for.
    execution_capability: "agentic_execution_v1",
    opportunity_id: "opportunity_1",
    status: options.status ?? "prepared",
    commit_sha: "a".repeat(40),
    branch_name: "vibe/change-1",
    completed_at: new Date().toISOString(),
  });
}

const discard = () =>
  discardChange(fakeSupabase(db), { projectId: PROJECT, userId: USER, preparedChangeId: CHANGE });

beforeEach(() => {
  db = new FakeDatabase();
});

describe("discarding a prepared change", () => {
  it("frees the change, and the execution identity with it", async () => {
    seed();

    expect(await discard()).toEqual({ kind: "discarded" });

    // The whole mechanism: `prepared_changes_single_active_idx` is scoped to
    // ('preparing', 'prepared'), so leaving that set is what makes the same
    // step runnable again. Nothing else has to happen.
    expect(db.rows("prepared_changes")[0].status).toBe("discarded");
  });

  it("records what was discarded, not just that something was", async () => {
    seed();
    await discard();

    const [event] = db.rows("audit_events");
    expect(event.event_type).toBe("change_preparation.discarded");
    expect(event.metadata).toMatchObject({
      prepared_change_id: CHANGE,
      prepared_commit_sha: "a".repeat(40),
      branch_name: "vibe/change-1",
    });
  });

  it("leaves the branch alone", async () => {
    seed();
    await discard();

    // Rule 71: Vibe never deletes a branch. A discard is a decision recorded,
    // not an artifact destroyed — the commit stays reachable on GitHub.
    expect(db.rows("prepared_changes")[0].branch_name).toBe("vibe/change-1");
  });

  it("says the same thing when clicked twice", async () => {
    seed();
    await discard();

    expect(await discard()).toEqual({ kind: "already_discarded" });
    expect(db.rows("audit_events")).toHaveLength(1);
  });
});

describe("what discarding refuses", () => {
  it("refuses a change a person has approved", async () => {
    seed();
    db.seed("change_approvals", {
      id: "approval_1",
      project_id: PROJECT,
      user_id: USER,
      prepared_change_id: CHANGE,
      status: "approved",
    });

    /*
     * Rule 68: `human_approved` records that a person looked at one specific
     * reviewed commit and said yes. Unwinding that as a side effect of a
     * different button is exactly what the approval model exists to prevent, so
     * the honest sequence is two deliberate acts — revoke, then discard.
     */
    expect(await discard()).toEqual({
      kind: "blocked",
      reason: "discard_approval_standing",
    });
    expect(db.rows("prepared_changes")[0].status).toBe("prepared");
  });

  it("allows it once the approval has been withdrawn", async () => {
    seed();
    db.seed("change_approvals", {
      id: "approval_1",
      project_id: PROJECT,
      user_id: USER,
      prepared_change_id: CHANGE,
      status: "revoked",
    });

    expect(await discard()).toEqual({ kind: "discarded" });
  });

  it("refuses a change that already reached the default branch", async () => {
    seed();
    db.seed("change_merges", {
      id: "merge_1",
      project_id: PROJECT,
      user_id: USER,
      prepared_change_id: CHANGE,
      status: "merged",
    });

    // `merged` means the default branch points at this commit and Vibe read it
    // back (rule 74). Calling that discarded would be a false statement about
    // the customer's repository.
    expect(await discard()).toEqual({ kind: "blocked", reason: "discard_already_merged" });
  });

  it("refuses one that is still being written", async () => {
    seed({ status: "preparing" });

    expect(await discard()).toEqual({ kind: "blocked", reason: "discard_not_discardable" });
  });

  it("refuses another person's change", async () => {
    seed({ userId: "someone_else" });

    expect(await discard()).toEqual({ kind: "blocked", reason: "discard_not_authorized" });
    expect(db.rows("prepared_changes")[0].status).toBe("prepared");
  });
});
