import { describe, expect, it } from "vitest";
import {
  ExecutionPolicyContradiction,
  assertPolicyConsistency,
  verifyPolicyMatrix,
} from "./policy";
import { compileCompletionBudget } from "./completion";
import { VERIFICATION_MODES, verificationPlanForMode } from "./verification";

/**
 * Two trusted Vibe policies must not quietly contradict each other (PART M).
 *
 * Run #7's LOW verification plan required a diff review; its LOW completion
 * budget refused every attempt at one. Both were internally consistent. Nothing
 * compared them, so whichever check happened to run first won — and the run was
 * told to do something the runtime would not permit, eight times.
 */

describe("every profile this product can compile is self-consistent", () => {
  it("passes the whole matrix", () => {
    expect(() => verifyPolicyMatrix()).not.toThrow();
  });

  it.each(VERIFICATION_MODES)("keeps %s's required checks reachable", (mode) => {
    expect(() =>
      assertPolicyConsistency(verificationPlanForMode(mode), compileCompletionBudget(mode)),
    ).not.toThrow();
  });
});

describe("a contradiction is refused rather than silently resolved", () => {
  it("catches a required diff review with no read of a changed file allowed", () => {
    const plan = verificationPlanForMode("low");
    const budget = { ...compileCompletionBudget("low"), maxDiffReviewReadsPerPath: 0 };

    expect(() => assertPolicyConsistency(plan, budget)).toThrow(ExecutionPolicyContradiction);
  });

  it("catches a check that is both required and forbidden", () => {
    const plan = { ...verificationPlanForMode("low"), requiredChecks: ["build"] as const };

    expect(() => assertPolicyConsistency(plan, compileCompletionBudget("low"))).toThrow(
      /both required and forbidden/,
    );
  });

  it("catches more required commands than the command ceiling allows", () => {
    const plan = {
      ...verificationPlanForMode("high"),
      requiredChecks: ["typecheck", "build", "lint", "full_test"] as const,
      maxVerificationCommands: 2,
    };

    expect(() => assertPolicyConsistency(plan, compileCompletionBudget("high"))).toThrow(
      /required check command/,
    );
  });

  it("catches a budget that would make a failing required check unanswerable", () => {
    const budget = { ...compileCompletionBudget("low"), maxRepairCycles: 0 };

    expect(() => assertPolicyConsistency(verificationPlanForMode("low"), budget)).toThrow(
      /no repair is allowed/,
    );
  });

  it("catches a plan and a budget compiled for different modes", () => {
    expect(() =>
      assertPolicyConsistency(verificationPlanForMode("low"), compileCompletionBudget("high")),
    ).toThrow(/low.*high|high.*low/);
  });

  it("names the mode, so a failure says which profile is wrong", () => {
    try {
      assertPolicyConsistency(verificationPlanForMode("low"), {
        ...compileCompletionBudget("low"),
        maxCompletionActions: 0,
      });
      expect.unreachable();
    } catch (error) {
      expect((error as ExecutionPolicyContradiction).mode).toBe("low");
    }
  });
});
