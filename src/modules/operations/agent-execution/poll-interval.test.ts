import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Two constants that must agree and cannot be shared.
 *
 * ## The number
 *
 * `agentExecutionWorkflow` polls the harness every twenty seconds, and
 * `workflowEventCount` derives how many Workflow events a run produced by
 * dividing its measured wall clock by that same twenty seconds. The second is
 * a claim *about* the first: change the interval alone and every cost figure
 * the economy module reports becomes wrong by the ratio, silently, with the
 * whole suite green — and those figures are what `margin-guard.ts` checks a
 * price against.
 *
 * ## Why they are not one constant
 *
 * Because `economy/` may not import `operations/` and nothing outside
 * `economy/` may import `workflow-invocation-cost.ts`. Both rules are enforced
 * (`isolation.test.ts`, `sprint-0054-safety.test.ts`) and both are right: the
 * cost model must not be able to reach into the execution path, and the
 * execution path must not be able to read a number that would eventually
 * authorize something. A shared module would be a third place, readable from
 * both, which is the same hole with an extra file in it.
 *
 * So the constants stay separate and this asserts the agreement instead. It
 * reads the two files as text rather than importing them, because importing
 * either from here is exactly what the two rules above forbid — and a test that
 * had to be exempted from them would be worth less than the drift it catches.
 */

const WORKFLOW = join(process.cwd(), "src/modules/operations/agent-execution/workflow.ts");
const COST_MODEL = join(process.cwd(), "src/modules/economy/workflow-invocation-cost.ts");

/** The literal, not the expression: a computed value here would be a second model. */
function pollIntervalIn(path: string): number {
  const source = readFileSync(path, "utf8");
  const match = source.match(/AGENT_POLL_INTERVAL_MS\s*=\s*([0-9_]+)\s*;/);

  expect(match, `${path} no longer declares AGENT_POLL_INTERVAL_MS as a literal`).not.toBeNull();
  return Number(match![1]!.replaceAll("_", ""));
}

describe("the agent poll interval", () => {
  it("is the same number in the workflow and in the cost model", () => {
    expect(
      pollIntervalIn(COST_MODEL),
      "the cost model divides a run's wall clock by an interval the workflow no longer uses",
    ).toBe(pollIntervalIn(WORKFLOW));
  });

  /**
   * Not an assertion about the right value — twenty seconds is a judgement the
   * workflow's own docblock argues. It is a guard against a unit slip: a
   * plausible-looking `20` or `20_000_000` would keep the equality above true
   * on both sides and make every event count absurd.
   */
  it("is still measured in whole seconds of milliseconds", () => {
    const interval = pollIntervalIn(WORKFLOW);

    expect(interval).toBeGreaterThanOrEqual(1_000);
    expect(interval).toBeLessThanOrEqual(120_000);
    expect(interval % 1_000).toBe(0);
  });
});
