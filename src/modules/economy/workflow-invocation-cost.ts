import { estimated, sumCosts, unknown, type CostAmount, type CostTotal } from "./cost";
import type { VercelFunctionsRateCard } from "./infrastructure-rates";

/**
 * What Vibe's own two workflows cost to run, now that the rate is real
 * (Sprint 0051, PART H re-opened).
 *
 * ## What changed, and what did not
 *
 * Sprint 0051's PART H reasoned about this cost with **no real price** — every
 * dollar figure in it was a labelled, deliberately-bounded guess ("realistic"
 * vs "deliberately generous"), because Vercel Functions/Workflows pricing was
 * as unreachable from this environment as the sandbox rate had been. The
 * founder's second attestation replaced three of those guesses with real
 * prices. It did not, and could not, replace the fourth: **how long each step
 * actually runs and how much memory it uses is not something a price list can
 * tell you.** That is a measurement Vibe has never taken, and this file keeps
 * it exactly as unknown as before — the honest gain here is precision on the
 * price per unit, not a new claim about the units themselves.
 *
 * ## The step count is the one fully solid number
 *
 * Not reasoned, not attested — read directly from the code. Every `"use
 * step"` call site in `operations/agent-execution/workflow.ts` and
 * `operations/change-validation/workflow.ts` is a Workflow event; the agent
 * workflow's `pollAgent` step recurs once per `AGENT_POLL_INTERVAL_MS` (20s)
 * until the run finishes, so its count is computed from each historical run's
 * own measured wall-clock duration, not assumed.
 */

/** Fixed, non-polling steps in `agentExecutionWorkflow`. */
export const AGENT_WORKFLOW_FIXED_STEPS = 8; // provision, startAgent, collectAgent, extractChange, writeBranch, cleanupWorkspace, finish, enqueueValidation
export const AGENT_POLL_INTERVAL_MS = 20_000;
/** `"use step"` call sites in `changeValidationWorkflow`. */
export const VALIDATION_WORKFLOW_STEPS = 11;

/** Total Workflow events one full run (agent + validation) produced. */
export function workflowEventCount(agentWallMs: number): number {
  const polls = Math.ceil(agentWallMs / AGENT_POLL_INTERVAL_MS);
  return AGENT_WORKFLOW_FIXED_STEPS + polls + VALIDATION_WORKFLOW_STEPS;
}

/**
 * A reasoned, explicitly-labelled assumption about what one step does.
 *
 * The one thing this file cannot get from an attestation. A caller who wants
 * a number supplies this; a caller who does not gets `unknown` for the
 * CPU/memory components, same as `sandbox-cost.ts` demands a
 * `SandboxRateAssumption` before it will estimate active CPU.
 */
export type StepWorkAssumption = {
  label: string;
  durationMs: number;
  memoryGb: number;
};

export type WorkflowInvocationCost = {
  /** Known exactly: step count × the founder-attested per-event rate. */
  eventCost: CostAmount;
  /** Unknown unless a `StepWorkAssumption` is supplied. */
  cpuCost: CostAmount;
  memoryCost: CostAmount;
  total: CostTotal;
};

export function deriveWorkflowInvocationCost(
  stepCount: number,
  rates: VercelFunctionsRateCard,
  assumption?: StepWorkAssumption,
): WorkflowInvocationCost {
  const eventCost = estimated(stepCount * rates.workflowEventNanoUsd);

  const cpuCost: CostAmount = assumption
    ? estimated(
        Math.round(stepCount * (assumption.durationMs / 3_600_000) * rates.activeCpuNanoUsdPerCpuHour),
      )
    : unknown("not_measured");

  const memoryCost: CostAmount = assumption
    ? estimated(
        Math.round(
          stepCount *
            (assumption.durationMs / 3_600_000) *
            assumption.memoryGb *
            rates.memoryNanoUsdPerGbHour,
        ),
      )
    : unknown("not_measured");

  return {
    eventCost,
    cpuCost,
    memoryCost,
    total: sumCosts([
      ["eventCost", eventCost],
      ["cpuCost", cpuCost],
      ["memoryCost", memoryCost],
    ]),
  };
}

/**
 * Two named, bounding assumptions — not a claim about which is true.
 *
 * `REALISTIC` matches what these steps actually do: a database read or write,
 * no computation. `GENEROUS` is a deliberately pessimistic upper bound, kept
 * to show the materiality conclusion survives being wrong in the expensive
 * direction, not because it is believed.
 */
export const REALISTIC_STEP_WORK: StepWorkAssumption = {
  label: "realistic — a DB read/write, no computation",
  durationMs: 500,
  memoryGb: 0.25,
};

export const GENEROUS_STEP_WORK: StepWorkAssumption = {
  label: "deliberately generous upper bound",
  durationMs: 2000,
  memoryGb: 1,
};
