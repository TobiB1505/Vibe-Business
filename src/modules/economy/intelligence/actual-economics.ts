import { type CostAmount, type CostTotal, measured, sumCosts, unknown } from "../cost";
import type { InfrastructureRateCard, VercelFunctionsRateCard } from "../infrastructure-rates";
import {
  type EconomyProvenance,
  type SandboxUsage,
  deriveSandboxCost,
  provenanceFor,
} from "../sandbox-cost";
import { type StepWorkAssumption, deriveWorkflowInvocationCost } from "../workflow-invocation-cost";
import { type ConfidenceLevel, weakestConfidence } from "./confidence";

/**
 * What a run actually cost (Sprint 0054, PART H).
 *
 * ## Why this is not `deriveRunEconomics` again
 *
 * `run-economics.ts` answers Sprint 0049's question — one flat rate applied to
 * two sandbox durations — and it is still the right answer for the historical
 * backfill it was written for. This answers a different one: the four
 * components a *prediction* is compared against, each priced from its own
 * dimensions through the rate cards Vibe actually has.
 *
 * The split matters because a variance has to be attributable. "The run cost
 * 20% more than expected" is a fact; "the model spend was 26% over and the
 * validation was on target" is a cause.
 *
 * ## Measured, estimated, and the difference that keeps this honest
 *
 * Exactly one component can be `measured`: the model spend, because the
 * provider told Vibe what it charged and `ai_usage_events` recorded it. Every
 * other component is computed from a usage quantity and a rate card, which
 * makes it `estimated` no matter how carefully.
 *
 * That distinction is enforced by a test rather than by care. A rate-derived
 * number stamped `measured` would be indistinguishable from a provider invoice
 * in every downstream reader, and the first time a rate card was wrong the
 * error would be untraceable.
 *
 * ## Why validation is usually unknown here
 *
 * The agent workflow finishes before validation is enqueued, so at the moment a
 * run completes there is no validation sandbox to price. `stage_not_run` says
 * exactly that, and `sumCosts` deliberately excludes it from `missing` — an
 * unvalidated change is not under-measured, it simply has no validation.
 */

export type ActualEconomicsComponents = {
  /** Provider-reported. The only component that may be `measured`. */
  model: CostAmount;
  agentSandbox: CostAmount;
  validation: CostAmount;
  /** Vibe's own Workflows invocations. */
  infrastructure: CostAmount;
};

export type ActualExecutionEconomics = {
  actualCost: CostTotal;
  components: ActualEconomicsComponents;
  /**
   * How much of this figure was genuinely measured rather than derived.
   *
   * `high` requires every component to have come from a provider. That is
   * **unreachable today** and saying so is the point: `sandbox_usage_events`
   * carries a null `provider_cost_usd` in every row Vibe has ever written, so
   * the sandbox and infrastructure halves are always rate-derived and the best
   * available answer is `medium`. It becomes reachable the day a provider
   * reports attributable sandbox cost, and not before.
   *
   * `none` means a component is missing entirely, so the accompanying total is
   * a floor — a floor presented at any higher confidence is a floor presented
   * as a total.
   */
  confidence: ConfidenceLevel;
  /** From the agent sandbox, whose assumptions dominate the derived half. */
  provenance: EconomyProvenance | null;
  /** Upper bound on the agent sandbox if its CPU had been fully active. Null when unknowable. */
  agentSandboxUpperBoundNanoUsd: number | null;
  validationSandboxUpperBoundNanoUsd: number | null;
};

export type ActualEconomicsInput = {
  /** Exact integer nanodollars from `ai_usage_events`. Null when nothing was billed. */
  providerCostNanoUsd: number | null;
  agentSandbox: SandboxUsage | null;
  validationSandbox: SandboxUsage | null;
  /** False when the change was never validated — which is an absence, not a zero. */
  validationAttempted: boolean;
  /** Workflow steps executed, from the step graph. Null when not counted. */
  workflowSteps: number | null;
  rates: InfrastructureRateCard;
  functionsRates: VercelFunctionsRateCard;
  stepWork?: StepWorkAssumption;
  /** Where the model figure came from, for the provenance record. */
  usageSource?: string;
};

export function deriveActualExecutionEconomics(
  input: ActualEconomicsInput,
): ActualExecutionEconomics {
  const model: CostAmount =
    input.providerCostNanoUsd === null ? unknown("not_measured") : measured(input.providerCostNanoUsd);

  const agent = input.agentSandbox ? deriveSandboxCost(input.agentSandbox, input.rates) : null;
  const validationBreakdown = input.validationSandbox
    ? deriveSandboxCost(input.validationSandbox, input.rates)
    : null;

  const agentSandbox = sandboxAmount(agent?.total ?? null, input.agentSandbox === null);

  const validation = !input.validationAttempted
    ? unknown("stage_not_run")
    : sandboxAmount(validationBreakdown?.total ?? null, input.validationSandbox === null);

  const infrastructure =
    input.workflowSteps === null
      ? unknown("not_measured")
      : totalToAmount(
          deriveWorkflowInvocationCost(input.workflowSteps, input.functionsRates, input.stepWork).total,
        );

  const components: ActualEconomicsComponents = { model, agentSandbox, validation, infrastructure };

  const actualCost = sumCosts([
    ["model", model],
    ["agentSandbox", agentSandbox],
    ["validation", validation],
    ["infrastructure", infrastructure],
  ]);

  return {
    actualCost,
    components,
    confidence: completenessConfidence(components, actualCost),
    provenance: input.agentSandbox
      ? provenanceFor(input.agentSandbox, input.rates, input.usageSource ?? "sandbox_usage_events")
      : null,
    agentSandboxUpperBoundNanoUsd: agent?.fullActiveCpuUpperBoundNanoUsd ?? null,
    validationSandboxUpperBoundNanoUsd: validationBreakdown?.fullActiveCpuUpperBoundNanoUsd ?? null,
  };
}

/**
 * A sandbox's cost as a single amount.
 *
 * An incomplete breakdown collapses to `unknown` rather than to its own floor:
 * a component that silently reports two of its five parts as though they were
 * all five is how a floor becomes a total further downstream. The floor is
 * still available on `actualCost.knownFloorNanoUsd`, where it is labelled.
 */
function sandboxAmount(total: CostTotal | null, absent: boolean): CostAmount {
  if (total === null) return unknown(absent ? "not_measured" : "no_price_available");
  return totalToAmount(total);
}

function totalToAmount(total: CostTotal): CostAmount {
  if (!total.complete) {
    const first = total.missing[0];
    return unknown(first ? (total.missingReasons[first] ?? "not_measured") : "not_measured");
  }
  // Rate-derived, therefore estimated. Never `measured`, whatever the precision.
  return { known: true, nanoUsd: total.knownFloorNanoUsd, basis: "estimated" };
}

/**
 * How much of the picture is genuinely measured.
 *
 * A stage that did not run is not a gap — an unvalidated change has no
 * validation cost to be missing — so it does not lower the answer.
 */
function completenessConfidence(
  components: ActualEconomicsComponents,
  total: CostTotal,
): ConfidenceLevel {
  const levels: ConfidenceLevel[] = Object.values(components).map((component) => {
    if (component.known) return component.basis === "measured" ? "high" : "medium";
    return component.reason === "stage_not_run" ? "high" : "none";
  });

  return total.complete ? weakestConfidence(levels) : weakestConfidence([...levels, "low"]);
}
