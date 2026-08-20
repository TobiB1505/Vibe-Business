import { describe, expect, it } from "vitest";
import type { OperationView } from "@/modules/operations/view";
import { validationStillSettling, type ValidationState } from "./poll";

/**
 * When the run screen still has something to wait for (Sprint 0053).
 *
 * ## The defect these pin
 *
 * The dogfood page polled on the *agent* operation's phase alone and stopped
 * the moment it went terminal. Since Sprint 0048 the agent's success enqueues a
 * validation automatically — in production run `5ea8a9a0` six seconds later —
 * so the last reading the page ever took showed `not_started`, and it never
 * asked again. A six-minute validation ran and passed while the screen said
 * nothing had started.
 *
 * Both halves are asserted here rather than in the browser, because the failure
 * was a *decision* about when to stop, and a decision is worth a unit test even
 * when its symptom is visual.
 */

function operation(overrides: Partial<OperationView> = {}): OperationView {
  return {
    operationId: "op-1",
    status: "completed",
    stage: "persisting",
    startedAt: null,
    completedAt: null,
    failureCode: null,
    resultId: "prepared-1",
    shouldPoll: false,
    retryAllowed: false,
    stalled: false,
    ...overrides,
  } as OperationView;
}

function model(validation: ValidationState, overrides: Partial<OperationView> = {}) {
  return { operation: operation(overrides), validation };
}

describe("a validation that has not answered yet is still worth waiting for", () => {
  it.each<ValidationState>(["not_started", "queued", "running"])(
    "keeps watching while validation is %s",
    (validation) => {
      expect(validationStillSettling(model(validation))).toBe(true);
    },
  );

  /**
   * The exact six-second window that produced the bug. The agent operation is
   * already terminal — so the old condition had stopped — and the validation
   * has not been created yet.
   */
  it("keeps watching in the gap between the agent finishing and validation starting", () => {
    expect(validationStillSettling(model("not_started", { status: "completed" }))).toBe(true);
  });
});

describe("a settled validation ends the wait", () => {
  it.each<ValidationState>(["passed", "failed"])("stops once validation is %s", (validation) => {
    expect(validationStillSettling(model(validation))).toBe(false);
  });
});

/**
 * The opposite failure, and the reason this is not simply "poll until
 * validation settles".
 *
 * `not_started` is also the permanent, correct answer for a run that never
 * produced a prepared change — nothing will ever enqueue a validation for it.
 * Watching on the validation state alone would spin forever on exactly the runs
 * that failed.
 */
describe("a run with nothing to validate never waits forever", () => {
  it("stops for a failed run", () => {
    expect(
      validationStillSettling(model("not_started", { status: "failed", resultId: null })),
    ).toBe(false);
  });

  it("stops for a completed run that produced no prepared change", () => {
    expect(validationStillSettling(model("not_started", { resultId: null }))).toBe(false);
  });

  it("stops for a run that is still going — the agent's own phase covers that", () => {
    expect(
      validationStillSettling(model("not_started", { status: "running", resultId: null })),
    ).toBe(false);
  });
});
