import { describe, expect, it } from "vitest";
import {
  classifyCompletionActivity,
  compileCompletionBudget,
  evaluateCompletionAction,
  initialCompletionState,
  observeToolFailure,
  toSandboxCompletionPolicy,
  type CompletionActionInput,
  type CompletionState,
} from "./completion";
import { completionBudgetFor } from "./service";
import { compileAgentVerificationPlan, verificationPlanForMode } from "./verification";

/**
 * The completion lifecycle, driven through the same pure function the harness
 * mirrors.
 *
 * The canaries prove the SDK actually reaches this decision; these prove the
 * decision is right. Both are needed, and the `allowedTools` bug is why: a
 * correct decision on a path nothing takes is worth exactly nothing.
 */

const BUDGET = compileCompletionBudget("low");
const LOW_PLAN = verificationPlanForMode("low");
const BRIEF = new Set(["src/app/layout.tsx", "src/app/app/layout.tsx"]);

/** One run, driven action by action, exactly as the harness drives it. */
class Run {
  state: CompletionState = initialCompletionState();
  clock = 0;

  act(toolName: string, path: string | null, options: { advanceMs?: number; commandCheck?: CompletionActionInput["commandCheck"] } = {}) {
    this.clock += options.advanceMs ?? 0;
    const outcome = evaluateCompletionAction(this.state, {
      toolName,
      path,
      briefPaths: BRIEF,
      requiredChecks: LOW_PLAN.requiredChecks,
      commandCheck: options.commandCheck ?? null,
      budget: BUDGET,
      now: this.clock,
    });
    this.state = outcome.state;
    return outcome.decision;
  }

  fail(toolName: string) {
    this.state = observeToolFailure(this.state, toolName);
  }
}

describe("before the first edit, nothing is scarce", () => {
  it("permits reading far outside the brief", () => {
    const run = new Run();
    const decision = run.act("Read", "src/modules/anything.ts");

    expect(decision.allowed).toBe(true);
    expect(decision.activity).toBe("orientation");
  });

  it("permits it indefinitely, because no budget has started", () => {
    const run = new Run();
    for (let index = 0; index < 30; index += 1) {
      expect(run.act("Grep", null).allowed).toBe(true);
    }
  });
});

describe("implementation breadth is free (PART F)", () => {
  /*
   * Run #7's shape, exactly: eight files that all legitimately need the same
   * change, each preceded by the read that makes writing it possible.
   *
   * Under the counter this replaces, the eight edits produced seven completion
   * windows against a ceiling of four, and every action after the fifth edit
   * was refused.
   */
  const PAGES = [
    "src/app/page.tsx",
    "src/app/login/page.tsx",
    "src/app/signup/page.tsx",
    "src/app/forgot-password/page.tsx",
    "src/app/reset-password/page.tsx",
    "src/app/privacy/page.tsx",
    "src/app/terms/page.tsx",
    "src/app/layout.tsx",
  ];

  function eightFileRun() {
    const run = new Run();
    for (const page of PAGES) {
      expect(run.act("Read", page).allowed).toBe(true);
      expect(run.act("Edit", page).allowed).toBe(true);
    }
    return run;
  }

  it("charges eight legitimate edits nothing at all", () => {
    const run = eightFileRun();

    expect(run.state.implementationMutations).toBe(8);
    expect(run.state.convergenceMutations).toBe(0);
    expect(run.state.repairCycles).toBe(0);
  });

  it("refuses none of them, and none of the reads between them", () => {
    const run = new Run();
    const refusals: string[] = [];

    for (const page of PAGES) {
      const read = run.act("Read", page);
      if (!read.allowed) refusals.push(read.reason);
      const edit = run.act("Edit", page);
      if (!edit.allowed) refusals.push(edit.reason);
    }

    expect(refusals).toEqual([]);
  });

  it("keeps the run in the implementing phase throughout", () => {
    expect(eightFileRun().state.phase).toBe("implementing");
  });

  it("records every changed path, because that is what scopes the diff review", () => {
    expect([...eightFileRun().state.mutatedPaths].sort()).toEqual([...PAGES].sort());
  });
});

describe("required verification outranks the completion budget (PART H)", () => {
  /**
   * The exact contradiction run #7 hit: the LOW plan requires a diff review,
   * and the completion budget had refused all eight attempts at one.
   */
  function convergedRunWithSpentBudget() {
    const run = new Run();
    run.act("Edit", "src/app/page.tsx");
    run.act("Edit", "src/app/terms/page.tsx");

    // Converge, then spend the whole optional allowance.
    for (let index = 0; index < BUDGET.maxCompletionActions + 4; index += 1) {
      run.act("Grep", null);
    }
    return run;
  }

  it("allows re-reading a file this run changed, with the budget exhausted", () => {
    const run = convergedRunWithSpentBudget();

    const decision = run.act("Read", "src/app/page.tsx");

    expect(decision.allowed).toBe(true);
    expect(decision.activity).toBe("required_diff_review");
  });

  it("still refuses an unrelated read at the same moment", () => {
    const run = convergedRunWithSpentBudget();

    const decision = run.act("Read", "src/lib/unrelated-config.ts");

    expect(decision.allowed).toBe(false);
    expect(decision.activity).toBe("outside_brief_read");
  });

  it("counts the override, so a contradiction is visible rather than silent", () => {
    const run = convergedRunWithSpentBudget();
    run.act("Read", "src/app/page.tsx");
    run.act("Read", "src/app/terms/page.tsx");

    expect(run.state.requiredVerificationActions).toBe(2);
    expect(run.state.requiredVerificationOverrides).toBe(2);
  });

  it("records no override when the budget would have allowed it anyway", () => {
    const run = new Run();
    run.act("Edit", "src/app/page.tsx");
    run.act("Read", "src/app/page.tsx");

    expect(run.state.requiredVerificationActions).toBe(1);
    expect(run.state.requiredVerificationOverrides).toBe(0);
  });

  it("does not treat a read of an unchanged file as a diff review", () => {
    const run = new Run();
    run.act("Edit", "src/app/page.tsx");

    expect(run.act("Read", "src/app/layout.tsx").activity).toBe("brief_read");
  });

  it("allows a required check command past an exhausted completion budget", () => {
    const run = convergedRunWithSpentBudget();

    const decision = run.act("Bash", null, { commandCheck: "diff_review" });

    // `diff_review` is the LOW plan's required check; a command mapping to it is
    // treated as required work rather than as optional exploration.
    expect(decision.allowed).toBe(true);
    expect(decision.activity).toBe("required_check");
  });
});

describe("diff review is scoped, not a licence (PART I)", () => {
  it("bounds how many times one changed file may be re-read", () => {
    const run = new Run();
    run.act("Edit", "src/app/page.tsx");

    for (let index = 0; index < BUDGET.maxDiffReviewReadsPerPath; index += 1) {
      expect(run.act("Read", "src/app/page.tsx").allowed).toBe(true);
    }

    const decision = run.act("Read", "src/app/page.tsx");
    expect(decision.allowed).toBe(false);
    expect(decision).toMatchObject({ reason: "diff_review_scope_exhausted" });
  });

  it("cannot be turned into unrestricted reading by editing one more file", () => {
    const run = new Run();
    run.act("Edit", "src/app/page.tsx");

    // The set of reviewable paths only ever grows by the run mutating a file,
    // and mutating a file is itself observed and counted. A path the run never
    // wrote is never reviewable.
    expect(
      classifyCompletionActivity({
        toolName: "Read",
        path: "src/lib/secrets.ts",
        briefPaths: BRIEF,
        requiredChecks: LOW_PLAN.requiredChecks,
        commandCheck: null,
        state: run.state,
      }),
    ).toBe("outside_brief_read");
  });

  it("does not apply at all when the plan does not require a diff review", () => {
    const run = new Run();
    run.act("Edit", "src/app/page.tsx");

    expect(
      classifyCompletionActivity({
        toolName: "Read",
        path: "src/app/page.tsx",
        briefPaths: BRIEF,
        requiredChecks: [],
        commandCheck: null,
        state: run.state,
      }),
    ).toBe("outside_brief_read");
  });
});

describe("optional exploration is still bounded after convergence (PART J)", () => {
  function converged() {
    const run = new Run();
    run.act("Edit", "src/app/page.tsx");
    for (let index = 0; index < BUDGET.implementationStabilisationCalls; index += 1) {
      run.act("Grep", null);
    }
    return run;
  }

  it("enters the completing phase by observation alone", () => {
    const run = converged();
    run.act("Grep", null);

    expect(run.state.phase).toBe("completing");
  });

  it("runs out of optional actions", () => {
    const run = converged();
    let refusal: string | null = null;

    for (let index = 0; index < 20 && refusal === null; index += 1) {
      const decision = run.act("Grep", null);
      if (!decision.allowed) refusal = decision.reason;
    }

    expect(refusal).toBe("completion_budget_exhausted");
  });

  it("runs out of outside-brief reads sooner than of actions", () => {
    const run = converged();

    for (let index = 0; index < BUDGET.maxOutsideBriefReads; index += 1) {
      expect(run.act("Read", `src/lib/other-${index}.ts`).allowed).toBe(true);
    }

    expect(run.act("Read", "src/lib/one-more.ts")).toMatchObject({
      allowed: false,
      reason: "outside_brief_budget_exhausted",
    });
  });

  it("runs out of wall clock", () => {
    const run = converged();

    expect(
      run.act("Grep", null, { advanceMs: BUDGET.maxCompletionWallClockMs }),
    ).toMatchObject({ allowed: false, reason: "completion_wall_clock_exhausted" });
  });

  it("bounds converge-edit-converge churn", () => {
    const run = new Run();
    run.act("Edit", "src/app/page.tsx");

    for (let cycle = 0; cycle < BUDGET.maxConvergenceWindows; cycle += 1) {
      for (let index = 0; index <= BUDGET.implementationStabilisationCalls; index += 1) {
        run.act("Grep", null);
      }
      run.act("Edit", "src/app/page.tsx");
    }

    expect(run.state.convergenceMutations).toBe(BUDGET.maxConvergenceWindows);

    for (let index = 0; index <= BUDGET.implementationStabilisationCalls; index += 1) {
      run.act("Grep", null);
    }
    expect(run.act("Grep", null)).toMatchObject({
      allowed: false,
      reason: "convergence_windows_exhausted",
    });
  });

  it("never refuses the mutation itself", () => {
    const run = new Run();
    run.act("Edit", "src/app/page.tsx");

    for (let cycle = 0; cycle < BUDGET.maxConvergenceWindows + 5; cycle += 1) {
      for (let index = 0; index <= BUDGET.implementationStabilisationCalls; index += 1) {
        run.act("Grep", null);
      }
      expect(run.act("Edit", "src/app/page.tsx").allowed).toBe(true);
    }
  });
});

describe("repair means a failure was answered (PART K)", () => {
  it("does not call an ordinary second implementation edit a repair", () => {
    const run = new Run();
    run.act("Edit", "src/app/layout.tsx");
    run.act("Edit", "src/app/app/layout.tsx");

    // This is run #6's shape, which recorded `repair_cycles: 1` with nothing
    // failing, because one counter meant both things.
    expect(run.state.repairCycles).toBe(0);
    expect(run.state.implementationMutations).toBe(2);
  });

  it("counts a mutation that answered an observed failure", () => {
    const run = new Run();
    run.act("Edit", "src/app/page.tsx");
    run.fail("Bash");
    run.act("Edit", "src/app/page.tsx");

    expect(run.state.repairCycles).toBe(1);
  });

  it("unlocks diagnosis while a failure is outstanding, past the optional budget", () => {
    const run = new Run();
    run.act("Edit", "src/app/page.tsx");
    for (let index = 0; index < 20; index += 1) run.act("Grep", null);
    run.fail("Bash");

    const decision = run.act("Read", "src/lib/anything.ts");
    expect(decision.allowed).toBe(true);
    expect(decision.activity).toBe("repair");
  });

  it("bounds repair too", () => {
    const run = new Run();
    run.act("Edit", "src/app/page.tsx");

    for (let cycle = 0; cycle < BUDGET.maxRepairCycles; cycle += 1) {
      run.fail("Bash");
      run.act("Edit", "src/app/page.tsx");
    }

    run.fail("Bash");
    expect(run.act("Read", "src/lib/anything.ts")).toMatchObject({
      allowed: false,
      reason: "repair_cycles_exhausted",
    });
  });

  it("does not treat a failed read as evidence the implementation is wrong", () => {
    const run = new Run();
    run.act("Edit", "src/app/page.tsx");
    run.fail("Read");

    expect(run.state.unresolvedFailure).toBe(false);
  });
});

describe("what crosses into the sandbox", () => {
  it("carries the required checks, because the harness has to know them", () => {
    const policy = toSandboxCompletionPolicy({
      budget: BUDGET,
      briefPaths: ["src/app/layout.tsx"],
      requiredChecks: LOW_PLAN.requiredChecks,
    });

    expect(policy.requiredChecks).toContain("diff_review");
  });

  it("carries no mode and no version — those are Vibe's records, not rules", () => {
    const policy = toSandboxCompletionPolicy({
      budget: BUDGET,
      briefPaths: [],
      requiredChecks: [],
    });

    expect(policy.budget).not.toHaveProperty("mode");
    expect(policy.budget).not.toHaveProperty("budgetVersion");
  });

  it("carries a message for every refusal reason", () => {
    const policy = toSandboxCompletionPolicy({ budget: BUDGET, briefPaths: [], requiredChecks: [] });

    for (const reason of Object.keys(policy.messages)) {
      expect(policy.messages[reason as keyof typeof policy.messages].length).toBeGreaterThan(20);
    }
  });
});

describe("the budget follows the verification mode", () => {
  it("is null when there is no plan", () => {
    expect(completionBudgetFor(null)).toBeNull();
  });

  it("matches the plan's mode", () => {
    const plan = compileAgentVerificationPlan({
      changeKind: "product_change",
      evidenceIds: ["live.seo.canonical_missing"],
      riskClass: "low",
    });

    expect(completionBudgetFor(plan)?.mode).toBe(plan.mode);
  });

  it("gives a higher mode more room in every dimension", () => {
    const low = compileCompletionBudget("low");
    const high = compileCompletionBudget("high");

    expect(high.maxCompletionActions).toBeGreaterThan(low.maxCompletionActions);
    expect(high.maxOutsideBriefReads).toBeGreaterThan(low.maxOutsideBriefReads);
    expect(high.maxConvergenceWindows).toBeGreaterThan(low.maxConvergenceWindows);
    expect(high.maxRepairCycles).toBeGreaterThan(low.maxRepairCycles);
  });
});
