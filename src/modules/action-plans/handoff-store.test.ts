import { describe, expect, it } from "vitest";
import { FakeDatabase, fakeSupabase } from "@/modules/operations/test-support";
import { buildHandoffKeys, listHandoffsForPlan } from "./handoff-store";

/**
 * Which issued prompts count as permission, and which count as help.
 *
 * ## Why this file exists at all
 *
 * A `build` handoff grants something: it is the single reason a `vibe` +
 * `product_change` step may be closed by the founder's word instead of by a
 * run, and that exclusion is what stops anyone confirming away the work the
 * agent exists to do. A `verify` handoff grants nothing — its step is the
 * founder's own measurement, already theirs to close.
 *
 * The database enforces the split, and it was already tested there. This is
 * the TypeScript half, and it was written because reverting the filter here
 * broke **no test at all**: the pure functions were right, the SQL was right,
 * and one `.filter` between them could have quietly widened the gate. That is
 * the same seam `completion-call-sites.test.ts` exists for, one layer down.
 */
describe("which handoffs count towards completion", () => {
  it("keeps only the prompts issued to build", () => {
    const handoffs = new Map([
      ["step-checkout", { tool: "claude_code" as const, purpose: "build" as const }],
      ["step-verify", { tool: "cursor" as const, purpose: "verify" as const }],
    ]);

    expect([...buildHandoffKeys(handoffs)]).toEqual(["step-checkout"]);
  });

  it("returns nothing when every prompt was a check", () => {
    // The dangerous direction. A plan whose only prompts were verifications
    // must admit no product change to being confirmed by hand.
    const handoffs = new Map([
      ["step-verify", { tool: "claude_code" as const, purpose: "verify" as const }],
    ]);

    expect(buildHandoffKeys(handoffs).size).toBe(0);
  });

  it("reads the purpose back rather than assuming one", async () => {
    const db = new FakeDatabase();
    db.seed("action_plan_handoffs", {
      id: "handoff-1",
      project_id: "project-1",
      action_plan_id: "plan-1",
      action_plan_step_key: "step-verify",
      action_plan_step_order: 7,
      tool: "claude_code",
      purpose: "verify",
      issued_to_user_id: "user-1",
    });

    const handoffs = await listHandoffsForPlan(fakeSupabase(db), {
      projectId: "project-1",
      actionPlanId: "plan-1",
    });

    expect(handoffs.get("step-verify")).toEqual({ tool: "claude_code", purpose: "verify" });
    expect(buildHandoffKeys(handoffs).size).toBe(0);
  });
});
