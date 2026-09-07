import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const HERE = join(process.cwd(), "src", "app", "app", "projects", "[projectId]");

function read(file: string): string {
  return readFileSync(join(HERE, file), "utf8");
}

/**
 * The screen must not offer what the server will refuse (ADR 0096).
 *
 * A founder reached a step Vibe declines by policy, the plan drew the handoff,
 * they clicked, and the action answered *"this step is no longer the one
 * waiting on you"* — because the plan was stale: its product profile had moved
 * since it was written. Reloading could not help; nothing about the step had
 * changed.
 *
 * The gate came from `attestFounderActionStepAction`, and it was wrong in both
 * places for the same reason. `planStaleness` says the diagnosis behind a plan
 * moved, not that a step is wrong — and the plan screen deliberately keeps
 * showing a stale plan, because "hiding a founder's plan because the diagnosis
 * moved would be worse than saying so". Refusing every action on a plan the
 * product still displays is exactly the dead end that argument exists to
 * prevent.
 *
 * Nothing was loosened. `getLatestActionPlan` returns the latest completed
 * plan, so a replan already fails the identity check that sits beside this one,
 * and both records bind to one immutable plan/step pair.
 *
 * Asserted as source rather than behaviour because the alternative is a
 * database, a session and a stale plan — and what has to hold is one line, in
 * two files, that a future edit could quietly restore.
 */
describe("actions the plan screen offers on a stale plan", () => {
  it.each(["handoff-action.ts", "founder-action-attestation.ts"])(
    "%s does not refuse a plan the screen still shows",
    (file) => {
      expect(read(file)).not.toContain("staleness.length");
    },
  );

  it.each(["handoff-action.ts", "founder-action-attestation.ts"])(
    "%s still refuses a plan that is no longer the current one",
    (file) => {
      // The identity check is what staleness was mistaken for. It stays.
      expect(read(file)).toContain("current.plan.id !== actionPlanId");
      expect(read(file)).toContain("current.firstActionableStep?.id !== stepKey");
    },
  );

  it("keeps the gate where answering a stale question would be wrong", () => {
    /*
     * The deliberate difference. A founder input resolution writes a durable
     * business statement that later plans read, so a question from a superseded
     * diagnosis may genuinely be the wrong question — unlike an attestation,
     * which says only that one immutable step happened.
     */
    expect(read("founder-input-action.ts")).toContain("staleness.length");
  });

  it("asks the attestation gate about handoffs, not just about the step", () => {
    /*
     * The defect a founder hit within minutes of the last fix. The predicate
     * was widened and the database function was widened, and this call was
     * not — so `isFounderAttestable` fell back to its empty default, a
     * `product_change` came back false, and the founder who had just been
     * handed a prompt and done the work could not record it. The screen offered
     * it; the server refused it. Again.
     */
    const source = read("founder-action-attestation.ts");

    expect(source).toContain("handoffByStepKey");
    expect(source).not.toMatch(/isFounderAttestable\(\s*current\.firstActionableStep\s*\)/);
  });
});
