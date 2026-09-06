import { resolvePricing } from "@/modules/ai/pricing";
import type { ExecutionBudget } from "@/modules/execution-contract/budget";
import type { ExecutionPolicy } from "@/modules/execution-contract/policy";
import { AGENT_BUDGET_POLICY_VERSION } from "./schema";

/**
 * The runtime limits one agent execution is bounded by (EXECUTION CORE-4 §17).
 *
 * ## Derived, never declared
 *
 * Every number here is read off the ExecutionSpec — from its `budget` and from
 * its compiled `policy.writeScope`. Nothing in this file invents a limit, and
 * that is the point: §15 says the spec is authority, so a runtime that carried
 * its own ceilings would be a second, unversioned policy quietly competing with
 * the first.
 *
 * The one thing this file adds is *shape*. A spec expresses budget in the terms
 * a customer authorized (Credits, turns, wall clock); a gateway needs counters
 * it can decrement per tool call. `deriveAgentLimits` is that translation, and
 * it is a pure function so the translation itself is testable.
 *
 * ## Why check runs are `maxRepairAttempts + 1`
 *
 * A repair loop is "run the check, see it fail, fix it, run it again". Three
 * repair attempts therefore means four check runs: one to learn the state, then
 * one after each fix. Setting the command budget to `maxRepairAttempts` would
 * silently buy one fewer repair than the spec authorized, and setting it to
 * something unrelated would make the two numbers drift.
 */
export type AgentRuntimeLimits = {
  budgetPolicyVersion: string;

  /** Turns of the agent loop (§16). */
  maxTurns: number;
  /** Check runs — the whole repair budget, expressed as commands (§17). */
  maxCheckRuns: number;
  /** Repair attempts the spec authorized. Recorded so a report can say so. */
  maxRepairAttempts: number;

  /** Bounded discovery (§10). */
  maxFilesRead: number;
  maxBytesPerFile: number;

  /** Blast radius (§28). */
  maxChangedFiles: number;
  maxChangedBytes: number;

  maxWallClockMs: number;
  maxSandboxMs: number;

  /** Handed to the provider's own loop as a hard stop (§18). */
  maxProviderSpendUsd: number;

  /**
   * Outbound network requests the agent may cause.
   *
   * Zero under the V1 `none` network policy, and the gateway has no tool that
   * could make one — the field exists so that widening it later is a visible
   * change to a stored number rather than a silent capability (§12).
   */
  maxNetworkRequests: number;
};

export function deriveAgentLimits(input: {
  budget: ExecutionBudget;
  policy: ExecutionPolicy;
}): AgentRuntimeLimits {
  const { budget, policy } = input;

  return {
    budgetPolicyVersion: budget.budgetPolicyVersion,

    maxTurns: budget.maxAgentTurns,
    maxCheckRuns: budget.maxRepairAttempts + 1,
    maxRepairAttempts: budget.maxRepairAttempts,

    maxFilesRead: policy.writeScope.discovery.maxFilesRead,
    maxBytesPerFile: policy.writeScope.discovery.maxBytesPerFile,

    // Taken from the *policy's* write scope rather than the budget's mirror of
    // it. They are required to agree (`assertBudgetMatchesScope`), and when they
    // do not, the compiled policy is the one that was enforced against the
    // produced diff — so it is the one a runtime counter must track.
    maxChangedFiles: policy.writeScope.mutation.maxChangedFiles,
    maxChangedBytes: policy.writeScope.mutation.maxChangedBytes,

    maxWallClockMs: budget.maxWallClockMs,
    maxSandboxMs: budget.maxSandboxMs,

    maxProviderSpendUsd: budget.maxProviderSpendUsd,
    maxNetworkRequests: budget.maxNetworkRequests,
  };
}

/**
 * How long an agent's sandbox may live (ADR 0029, A1).
 *
 * ## Why this is not `SANDBOX_BUDGETS.totalLifetimeMs`
 *
 * Because validation's fifteen minutes were sized for validation: a pipeline of
 * installs and checks whose whole job finishes well inside it. An agent run is
 * authorized for twenty minutes of wall clock, so reusing that constant put the
 * VM's death *before* the budget's — the sandbox would have been reclaimed with
 * the harness still working and the run still paid for.
 *
 * It is also the leak bound. That was the argument for keeping it tight, and it
 * is weaker now than it was: with the harness detached, no step holds a
 * connection for more than a few seconds, so the workflow reaches its cleanup
 * step instead of being killed before it. The looser bound buys back a run that
 * uses the budget it was sold.
 *
 * Deliberately far below the provider's 45-minute maximum. A run that needs
 * longer than this is telling us something about the repository, and the honest
 * answer in V0.1 is still to stop and say so.
 */
export const AGENT_SANDBOX_LIFETIME_MS = 30 * 60 * 1000;

/**
 * Room for everything that happens before the first turn.
 *
 * Cloning a repository, installing its dependencies and installing the harness
 * all happen inside the sandbox's lifetime and before the agent's own clock
 * starts. Ten minutes is generous for that on purpose: the failure it prevents
 * is a slow install stealing time a customer paid for as agent work.
 */
export const AGENT_PROVISION_HEADROOM_MS = 10 * 60 * 1000;

/**
 * The ceilings the Agent Gateway enforces for one run.
 *
 * ## Why these are not the budget
 *
 * The budget is the authority on what a customer authorized, and the harness's
 * own `maxBudgetUsd` and `maxTurns` are what stop a run at it. These are a
 * *containment* bound on a different question: what a token found inside a
 * sandbox can do if the harness stops honouring anything.
 *
 * So they are deliberately loose. A containment bound that cut a legitimate run
 * short would be a bug that looks exactly like a provider outage, and the
 * budget already stopped the run long before these are reached.
 *
 * The token ceiling is derived from the authorized provider spend at the
 * model's *output* rate — the most expensive per-token rate there is — so it
 * cannot be tighter than the spend the budget already permits.
 */
export type AgentGatewayCeilings = {
  maxOutputTokens: number;
  maxRequests: number;
};

/**
 * Requests each authorized turn may cost at the gateway.
 *
 * A turn is not one request: the harness re-sends a growing transcript, retries
 * transport failures, and compacts context. Four is a ceiling on that ratio
 * rather than a measurement of it, and the flat addition covers a short run
 * whose per-turn overhead has nothing to amortise against.
 */
const GATEWAY_REQUESTS_PER_TURN = 4;
const GATEWAY_REQUEST_FLOOR = 20;

export function deriveGatewayCeilings(input: {
  limits: AgentRuntimeLimits;
  model: string;
  at?: Date;
}): AgentGatewayCeilings {
  const pricing = resolvePricing(input.model, input.at ?? new Date());

  return {
    maxOutputTokens: Math.ceil(
      (input.limits.maxProviderSpendUsd * 1e9) / pricing.outputNanoUsdPerToken,
    ),
    maxRequests: input.limits.maxTurns * GATEWAY_REQUESTS_PER_TURN + GATEWAY_REQUEST_FLOOR,
  };
}

/**
 * Whether a budget and a compiled write scope describe the same blast radius.
 *
 * Two places state the mutation ceiling — the budget so a run can stop before
 * producing an illegal diff, and the write scope so `checkWriteScope` can
 * refuse one that was produced anyway. They must agree, and a mismatch is a
 * configuration bug rather than something to reconcile at runtime: if the
 * budget were the looser of the two, a run would sail past the ceiling it was
 * meant to stop at and be rejected only after spending the whole provider bill.
 *
 * Returns the disagreements rather than throwing, so the caller can fail the
 * execution with a typed code instead of a stack trace.
 */
export function checkBudgetMatchesScope(input: {
  budget: ExecutionBudget;
  policy: ExecutionPolicy;
}): readonly string[] {
  const problems: string[] = [];
  const scope = input.policy.writeScope.mutation;

  if (input.budget.maxChangedFiles !== scope.maxChangedFiles) {
    problems.push(
      `maxChangedFiles: budget ${input.budget.maxChangedFiles} vs scope ${scope.maxChangedFiles}`,
    );
  }
  if (input.budget.maxChangedBytes !== scope.maxChangedBytes) {
    problems.push(
      `maxChangedBytes: budget ${input.budget.maxChangedBytes} vs scope ${scope.maxChangedBytes}`,
    );
  }

  return problems;
}

/**
 * The write scope an agent policy compiles (§17).
 *
 * Core-3 left `writeScope` as a constructor argument with fixture values,
 * because no approved budget existed to derive one from. This is that
 * derivation: the mutation half mirrors the run's own budget exactly (so
 * `checkBudgetMatchesScope` passes by construction), and the discovery half is
 * generous within a bound for the reason `policy.ts` documents — an agent
 * cannot know which files it must change before it has looked.
 */
export const AGENT_DISCOVERY_SCOPE = {
  /**
   * 300 file reads.
   *
   * This repository's own snapshot reports ~40 source files at analysis
   * budget; a real Next.js application is larger. 300 is comfortably above
   * what one bounded step needs and far below "read the whole repository",
   * which Rule 9 forbids independently of any budget.
   */
  maxFilesRead: 300,
  /** 256 KB, matching `SANDBOX_BUDGETS.maxIntegrityFileBytes`. */
  maxBytesPerFile: 256 * 1024,
} as const;

export const AGENT_DOGFOOD_BUDGET_POLICY_VERSION = AGENT_BUDGET_POLICY_VERSION;
