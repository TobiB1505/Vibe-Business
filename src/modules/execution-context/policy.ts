import {
  type CompletionBudget,
} from "./completion";
import {
  VERIFICATION_MODES,
  verificationPlanForMode,
  type AgentVerificationPlan,
} from "./verification";
import { compileCompletionBudget } from "./completion";

/**
 * Do Vibe's own policies contradict each other? (PART M)
 *
 * ## Why this exists
 *
 * Run #7's LOW verification plan required a diff review. Its completion budget
 * refused every attempt at one. Both policies were internally consistent, both
 * were doing what they were written to do, and the run was told to do something
 * the runtime would not let it do — eight times.
 *
 * Nothing detected it, because the two policies shared no vocabulary and no
 * check. Whichever ran first won, and which ran first was an accident of the
 * order they were added in.
 *
 * ## What it checks
 *
 * Only contradictions between *trusted Vibe policies*. Not whether a change is
 * safe, not whether a plan is a good idea — those are different questions
 * answered elsewhere. This asks one thing: can a run actually carry out
 * everything Vibe marked required, under the budgets Vibe also set?
 *
 * ## Why it throws
 *
 * A contradiction is a bug in Vibe's own configuration, not a customer's
 * situation, and it is the kind of bug that otherwise shows up as a paid run
 * behaving strangely. Failing loudly at compile time turns it into a failing
 * test — and `verifyPolicyMatrix` below runs every mode combination this
 * product can produce, so the failure is found before any of them ships.
 */
export class ExecutionPolicyContradiction extends Error {
  constructor(
    readonly mode: string,
    readonly detail: string,
  ) {
    super(`Execution policy contradiction (${mode}): ${detail}`);
    this.name = "ExecutionPolicyContradiction";
  }
}

/**
 * Throws when a plan asks for work its own budgets refuse.
 *
 * Deliberately narrow. It does not try to simulate a run — it asserts the
 * structural properties that make a required operation *possible*:
 *
 * 1. Nothing required is also forbidden.
 * 2. A required diff review has a non-zero per-path read allowance.
 * 3. Required command checks fit inside the verification command ceiling.
 * 4. Repair, which is what a failed required check leads to, has room.
 */
export function assertPolicyConsistency(
  plan: AgentVerificationPlan,
  budget: CompletionBudget,
): void {
  const fail = (detail: string) => {
    throw new ExecutionPolicyContradiction(plan.mode, detail);
  };

  if (plan.mode !== budget.mode) {
    fail(`the verification plan is ${plan.mode} and the completion budget is ${budget.mode}`);
  }

  for (const check of plan.requiredChecks) {
    if (plan.forbiddenChecks.includes(check)) {
      fail(`"${check}" is both required and forbidden`);
    }
  }

  if (plan.requiredChecks.includes("diff_review") && budget.maxDiffReviewReadsPerPath < 1) {
    fail("a diff review is required but no read of a changed file is allowed");
  }

  const requiredCommands = plan.requiredChecks.filter((check) => check !== "diff_review");
  if (requiredCommands.length > plan.maxVerificationCommands) {
    fail(
      `${requiredCommands.length} required check command(s) against a ceiling of ` +
        `${plan.maxVerificationCommands}`,
    );
  }

  if (budget.maxRepairCycles < 1) {
    fail("no repair is allowed, so a failing required check could never be answered");
  }

  if (budget.maxCompletionActions < 1) {
    fail("no action at all is allowed after convergence");
  }
}

/**
 * Every plan/budget pair this product can compile, checked at once.
 *
 * The profiles are a small closed matrix, so "are any of our policies mutually
 * impossible?" is answerable exhaustively rather than by example. Called from
 * the suite; cheap enough to call anywhere.
 */
export function verifyPolicyMatrix(): void {
  for (const mode of VERIFICATION_MODES) {
    assertPolicyConsistency(verificationPlanForMode(mode), compileCompletionBudget(mode));
  }
}
