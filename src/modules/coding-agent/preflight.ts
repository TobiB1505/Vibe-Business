import type { ExecutionResolution } from "@/modules/execution-contract/schema";
import type { ExecutionSpec } from "@/modules/execution-contract/spec";
import { deriveAgentLimits, type AgentRuntimeLimits } from "./budget";
import { checkBudgetMatchesScope } from "./budget";
import type { AgentEconomicPolicy } from "./authorization";

/**
 * The pre-spend preflight (EXECUTION CORE-4 §43).
 *
 * > Before running a paid provider call: present internally the selected real
 * > task and explain — why it is agentic rather than deterministic, why risk ≤
 * > moderate, why existing validation can prove it, why no material user
 * > decision is missing, expected file/diff scope, maximum dogfood budget, and
 * > what "Done" means. Do not start until this preflight passes
 * > deterministically.
 *
 * ## Why it is code rather than a checklist
 *
 * A checklist is something a person remembers to run. This is a function that
 * returns refusals, and the dogfood harness will not spend a Credit or contact
 * a provider unless it returns none — so "we checked" is a property of the run
 * rather than of somebody's diligence.
 *
 * Every question below is answered from structured state: the resolution, the
 * spec, the compiled policy, the economics. None is answered from prose, and
 * none is a judgement about whether the *task* is a good idea — that is the
 * Planner's job, one layer up, and re-litigating it here would be a second
 * opinion with no evidence behind it.
 */

export const PREFLIGHT_REFUSALS = [
  /** The step did not resolve to an agentic route. */
  "not_agentic",
  /** Classified as agentic, but live state or money says not now (§29 of Core-3). */
  "not_admissible",
  /** Beyond the V1 risk ceiling. */
  "risk_too_high",
  /** No validation profile, so nothing could independently prove the result (§31). */
  "validation_unsupported",
  /** No economics authorize this project to run an agent at all (§18). */
  "not_authorized",
  /** The spec carries no budget, so there is no ceiling to stop at (§17). */
  "no_budget",
  /** The budget and the compiled write scope disagree about blast radius. */
  "budget_scope_mismatch",
  /** The compiled policy grants nothing an agent could work with. */
  "no_tool_grants",
  /** The policy grants something no execution may ever hold. */
  "forbidden_grant",
  /** A founder decision this rests on has not been made (§26). */
  "user_decision_missing",
] as const;
export type PreflightRefusal = (typeof PREFLIGHT_REFUSALS)[number];

/**
 * What the preflight established, whether or not it passed.
 *
 * Returned in both cases deliberately: a refusal that also reports the budget
 * and the scope is a report somebody can act on, and one that reports only
 * "no" is a report somebody re-runs with a print statement added.
 */
export type AgentPreflight = {
  passed: boolean;
  refusals: readonly PreflightRefusal[];

  /** Why agentic rather than deterministic — from the resolution, not from prose. */
  route: {
    mode: ExecutionResolution["mode"];
    reason: ExecutionResolution["reason"];
    /** Null for every agentic route: no registry capability matched. */
    deterministicCapability: string | null;
    riskClass: ExecutionResolution["riskClass"];
  };

  /** What independently proves the result (§31). */
  validation:
    | { supported: true; profile: string; profileVersion: string; steps: readonly string[] }
    | { supported: false; reason: string };

  /** What the run may do, and what it may never do. */
  authority: {
    allowedCapabilities: readonly string[];
    forbiddenCapabilities: readonly string[];
    network: string;
    secrets: string;
  };

  /** The ceilings, expanded into the counters the runtime will actually use. */
  limits: AgentRuntimeLimits | null;

  economics: {
    authorized: boolean;
    nonProduction: boolean;
    budgetPolicyVersion: string | null;
    disclosure: string | null;
  };

  /** What "Done" means, in the step's own recorded words. */
  doneWhen: string;
};

/**
 * Runs the preflight for one resolved step (§43).
 *
 * Deterministic and total. Given the same resolution, spec and economics it
 * returns the same answer forever — which is what makes it safe to gate a paid
 * call on, and what lets the dogfood record say *why* the run was permitted
 * rather than merely that it was.
 */
export function runAgentPreflight(input: {
  resolution: ExecutionResolution;
  spec: ExecutionSpec;
  economics: AgentEconomicPolicy | null;
}): AgentPreflight {
  const { resolution, spec, economics } = input;
  const refusals: PreflightRefusal[] = [];

  if (resolution.mode !== "agentic") refusals.push("not_agentic");
  if (!resolution.admission.admissible) refusals.push("not_admissible");
  if (resolution.riskClass === "high" || resolution.riskClass === "prohibited") {
    refusals.push("risk_too_high");
  }
  if (resolution.requiresUserInput) refusals.push("user_decision_missing");
  if (!spec.validation.supported) refusals.push("validation_unsupported");

  if (!economics) refusals.push("not_authorized");

  if (!spec.budget) {
    refusals.push("no_budget");
  } else if (checkBudgetMatchesScope({ budget: spec.budget, policy: spec.policy }).length > 0) {
    refusals.push("budget_scope_mismatch");
  }

  if (spec.policy.allowedCapabilities.length === 0) refusals.push("no_tool_grants");

  // Stated again here even though `compileExecutionPolicy` subtracts the
  // forbidden set. This is the last check before money is spent, and a policy
  // read back from a database has not been through that compiler.
  const forbidden = new Set(spec.policy.forbiddenCapabilities as readonly string[]);
  if (spec.policy.allowedCapabilities.some((capability) => forbidden.has(capability))) {
    refusals.push("forbidden_grant");
  }

  return {
    passed: refusals.length === 0,
    refusals,

    route: {
      mode: resolution.mode,
      reason: resolution.reason,
      deterministicCapability: resolution.capability,
      riskClass: resolution.riskClass,
    },

    validation: spec.validation.supported
      ? {
          supported: true,
          profile: spec.validation.profile,
          profileVersion: spec.validation.profileVersion,
          steps: spec.validation.sandboxSteps,
        }
      : { supported: false, reason: spec.validation.reason },

    authority: {
      allowedCapabilities: spec.policy.allowedCapabilities,
      forbiddenCapabilities: spec.policy.forbiddenCapabilities,
      network: spec.policy.network.mode,
      secrets: spec.policy.secrets.mode,
    },

    limits: spec.budget ? deriveAgentLimits({ budget: spec.budget, policy: spec.policy }) : null,

    economics: {
      authorized: economics !== null,
      nonProduction: economics?.nonProduction ?? false,
      budgetPolicyVersion: economics?.budget.budgetPolicyVersion ?? null,
      disclosure: economics?.disclosure ?? null,
    },

    doneWhen: spec.objective.doneWhen,
  };
}

/**
 * The §43 report, as text.
 *
 * Rendered rather than logged as an object because a human reads it before
 * approving the first paid run, and a nested object printed by a probe is not
 * a thing anyone reads carefully.
 */
export function renderAgentPreflight(preflight: AgentPreflight): string {
  const lines: string[] = [];

  lines.push(preflight.passed ? "PREFLIGHT: PASS" : "PREFLIGHT: REFUSED");
  if (!preflight.passed) lines.push(`  refusals: ${preflight.refusals.join(", ")}`);
  lines.push("");

  lines.push("Route");
  lines.push(`  mode                 ${preflight.route.mode}`);
  lines.push(`  reason               ${preflight.route.reason}`);
  lines.push(
    `  deterministic route  ${preflight.route.deterministicCapability ?? "none — no registry capability matches"}`,
  );
  lines.push(`  risk                 ${preflight.route.riskClass}`);
  lines.push("");

  lines.push("What independently proves it");
  if (preflight.validation.supported) {
    lines.push(`  profile              ${preflight.validation.profile} (${preflight.validation.profileVersion})`);
    lines.push(`  steps                ${preflight.validation.steps.join(", ")}`);
  } else {
    lines.push(`  unsupported          ${preflight.validation.reason}`);
  }
  lines.push("");

  lines.push("Authority");
  lines.push(`  allowed              ${preflight.authority.allowedCapabilities.join(", ") || "(none)"}`);
  lines.push(`  never granted        ${preflight.authority.forbiddenCapabilities.join(", ")}`);
  lines.push(`  network              ${preflight.authority.network}`);
  lines.push(`  secrets              ${preflight.authority.secrets}`);
  lines.push("");

  lines.push("Ceilings");
  if (preflight.limits) {
    const limits = preflight.limits;
    lines.push(`  budget policy        ${limits.budgetPolicyVersion}`);
    lines.push(`  turns                ${limits.maxTurns}`);
    lines.push(`  check runs           ${limits.maxCheckRuns} (${limits.maxRepairAttempts} repairs)`);
    lines.push(`  files read           ${limits.maxFilesRead} × ${limits.maxBytesPerFile} bytes`);
    lines.push(`  files changed        ${limits.maxChangedFiles}`);
    lines.push(`  bytes changed        ${limits.maxChangedBytes}`);
    lines.push(`  wall clock           ${Math.round(limits.maxWallClockMs / 1000)}s`);
    lines.push(`  sandbox              ${Math.round(limits.maxSandboxMs / 1000)}s`);
    lines.push(`  provider spend       $${limits.maxProviderSpendUsd.toFixed(2)}`);
    lines.push(`  network requests     ${limits.maxNetworkRequests}`);
  } else {
    lines.push("  (no budget — nothing may run)");
  }
  lines.push("");

  lines.push("Economics");
  lines.push(`  authorized           ${preflight.economics.authorized ? "yes" : "no"}`);
  lines.push(`  production price     NOT ACTIVATED`);
  lines.push(`  policy               ${preflight.economics.budgetPolicyVersion ?? "none"}`);
  if (preflight.economics.disclosure) lines.push(`  note                 ${preflight.economics.disclosure}`);
  lines.push("");

  lines.push("Done when");
  lines.push(`  ${preflight.doneWhen}`);

  return lines.join("\n");
}
