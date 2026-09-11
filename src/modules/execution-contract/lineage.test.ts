import { beforeEach, describe, expect, it } from "vitest";
import { FakeDatabase, fakeSupabase } from "@/modules/operations/test-support";
import { resolveSpecLineage } from "./lineage";
import type { ExecutionSpec } from "./spec";

/**
 * The Move a spec descends from.
 *
 * The agent's branch step threw this away and wrote two nulls, so every change
 * the product makes reached a founder's screen naming nothing it was for. The
 * lineage was never unknown — `ExecutionSpec` carries `opportunityId` so that
 * it survives into execution, and the plan the spec names carries the set.
 */

const PLAN = "plan_1";
const SET = "set_1";
/* A uuid, because that is what the column is. The spec carries it as text and
   `prepared_changes.opportunity_id` is a uuid with a foreign key — which is
   the mismatch that would have failed the claim. */
const MOVE = "11111111-1111-4111-8111-111111111111";

let db: FakeDatabase;

function spec(overrides: Partial<ExecutionSpec> = {}): ExecutionSpec {
  /* Only the three fields this resolver reads. It is given a whole spec in
     production and must not develop an appetite for the rest of it. */
  return {
    actionPlanId: PLAN,
    opportunityId: MOVE,
    projectId: "project_1",
    ...overrides,
  } as ExecutionSpec;
}

beforeEach(() => {
  db = new FakeDatabase();
});

describe("the Move a spec descends from", () => {
  it("takes the set from the plan and the Move from the row it read", () => {
    db.seed("action_plans", { id: PLAN, opportunity_set_id: SET, opportunity_id: MOVE });
    db.seed("business_opportunities", { id: MOVE, opportunity_set_id: SET });

    return expect(resolveSpecLineage(fakeSupabase(db), spec())).resolves.toEqual({
      opportunitySetId: SET,
      opportunityId: MOVE,
    });
  });

  /**
   * The write is safe because the row was read.
   *
   * `prepared_changes.opportunity_id` has a foreign key. A spec naming a Move
   * that is not in the plan's set — or not a uuid at all, which an internal
   * benchmark's fixture key is not — would fail that key inside
   * `claimPreparedChange`, and a run that had already written a branch would
   * end as `change_preparation_failed`. Not finding it is the ordinary answer.
   */
  it("records nothing when the Move is not in the plan's set", () => {
    db.seed("action_plans", { id: PLAN, opportunity_set_id: SET, opportunity_id: MOVE });
    db.seed("business_opportunities", { id: MOVE, opportunity_set_id: "some_other_set" });

    return expect(resolveSpecLineage(fakeSupabase(db), spec())).resolves.toBeNull();
  });

  it("records nothing for a spec whose Move is a fixture key rather than a uuid", () => {
    db.seed("action_plans", { id: PLAN, opportunity_set_id: SET, opportunity_id: "benchmark-1" });
    db.seed("business_opportunities", { id: MOVE, opportunity_set_id: SET });

    return expect(
      resolveSpecLineage(fakeSupabase(db), spec({ opportunityId: "benchmark-1" })),
    ).resolves.toBeNull();
  });

  /**
   * The spec is the authority, not the plan.
   *
   * They are equal by construction — `buildExecutionSpec` copies
   * `plan.opportunityId` into the spec — so this only differs if a plan were
   * reworded underneath a running spec. The run was authorized against the
   * spec, so its artifacts trace to the spec's Move, and a lookup that then
   * misses is the honest outcome: the surface draws nothing rather than a Move
   * this change did not come from.
   */
  it("does not take the opportunity from the plan when the two disagree", async () => {
    db.seed("action_plans", {
      id: PLAN,
      opportunity_set_id: SET,
      opportunity_id: "22222222-2222-4222-8222-222222222222",
    });
    db.seed("business_opportunities", { id: MOVE, opportunity_set_id: SET });

    const lineage = await resolveSpecLineage(fakeSupabase(db), spec());
    expect(lineage?.opportunityId).toBe(MOVE);
  });

  /**
   * No plan row, no Move — and no failure.
   *
   * An internal benchmark step has no plan and never will: its fixture lives
   * in Vibe's own code. The columns are nullable for exactly this, and a run
   * that cannot name its Move still prepares its change.
   */
  it("answers null when the plan is not there", () => {
    return expect(resolveSpecLineage(fakeSupabase(db), spec())).resolves.toBeNull();
  });

  it("answers null rather than throwing when the read fails", async () => {
    const failing = {
      from: () => {
        throw new Error("unreachable");
      },
    } as never;

    await expect(resolveSpecLineage(failing, spec())).resolves.toBeNull();
  });
});
