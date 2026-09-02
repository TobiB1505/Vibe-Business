import {
  estimated,
  measured,
  sumCosts,
  unknown,
  type CostAmount,
  type CostTotal,
} from "./cost";

/**
 * What one agent run actually cost Vibe (Sprint 0049).
 *
 * ## Read-only, and no rate of its own
 *
 * This module derives. It writes nothing, prices nothing on its own authority,
 * and is not wired into billing, credits, quoting or settlement. Vibe's Credit
 * rate card (`credits/rating.ts`) is deliberately empty and stays empty; this is
 * the analysis that would inform filling it, not the filling.
 *
 * ## Why a sandbox rate must be passed in
 *
 * Because this module is a scenario harness and must not adopt one silently.
 * `sandbox_usage_events.provider_cost_usd` is null in every row ever written —
 * Vercel reports no attributable per-sandbox amount — and this file is where an
 * operator runs *what-if* analyses, which is precisely the place a defaulted
 * rate would turn an assumption into a quoted figure.
 *
 * *(2026-09-02, ADR 0073: "no sandbox price exists anywhere in the codebase" was
 * true when written and is not now. `VERCEL_SANDBOX_RATES` has been
 * founder-attested since 2026-08-20 and the ledger records a derived
 * `estimated_cost_nano_usd` beside each row. This parameter stays required
 * anyway: a scenario is asked under a rate the operator chose, and reaching for
 * the current card here would silently answer a different question.)*
 *
 * A default rate here would be a number invented in a module and then quoted
 * back as though it were evidence. So the parameter is optional and its absence
 * produces `no_price_available`, which is the true state of Vibe's knowledge.
 * A caller running a scenario supplies a rate explicitly, and the result is
 * marked `estimated` so the assumption travels with the answer.
 */

/**
 * An operator-supplied sandbox price, for scenario analysis only.
 *
 * `label` is required and not decorative: an estimate whose assumption cannot be
 * named is indistinguishable from a measurement once it has been pasted into a
 * spreadsheet.
 */
export type SandboxRateAssumption = {
  /** Where the number came from, in the operator's own words. */
  label: string;
  /** Nanodollars per wall-clock millisecond of sandbox lifetime. */
  nanoUsdPerMs: number;
};

export type RunEconomicsInput = {
  /**
   * The agent run's model spend, summed from `ai_usage_events`.
   *
   * Null when the run made no billable call — a run that died before its first
   * request genuinely cost nothing, which is different from not knowing.
   */
  providerCostNanoUsd: number | null;
  /** Wall-clock lifetime of the microVM the harness ran in, from its usage row. */
  agentSandboxMs: number | null;
  /**
   * Wall-clock lifetime of the validation microVM.
   *
   * Null means no validation row exists for this run — which for an agent run
   * that produced no prepared change is correct rather than missing.
   */
  validationSandboxMs: number | null;
  /** Whether validation ran at all. Distinguishes "not yet" from "not measured". */
  validationAttempted: boolean;
  assumption?: SandboxRateAssumption;
};

export type RunEconomics = {
  /** Everything the execution itself consumed. Today: the model spend. */
  executionCost: CostAmount;
  /** The model spend alone, stated separately so the two can diverge later. */
  providerCost: CostAmount;
  /** The validation sandbox. */
  validationCostEstimate: CostAmount;
  /** The agent's own sandbox — the microVM the harness ran inside. */
  infrastructureCostEstimate: CostAmount;
  totalEstimatedCost: CostTotal;
};

function sandboxCost(
  durationMs: number | null,
  attempted: boolean,
  assumption: SandboxRateAssumption | undefined,
): CostAmount {
  if (!attempted) return unknown("stage_not_run");
  if (durationMs === null) return unknown("not_measured");
  if (!assumption) return unknown("no_price_available");

  return estimated(Math.round(durationMs * assumption.nanoUsdPerMs));
}

export function deriveRunEconomics(input: RunEconomicsInput): RunEconomics {
  const providerCost: CostAmount =
    input.providerCostNanoUsd === null ? unknown("not_measured") : measured(input.providerCostNanoUsd);

  /*
   * Identical to `providerCost` today, and kept as its own field on purpose.
   *
   * "What the execution consumed" and "what the model provider charged" are the
   * same number only because inference is currently the only metered thing
   * inside an execution. The moment a second one exists — a paid tool, a
   * retrieval service — they diverge, and a caller that had been reading
   * `providerCost` as the execution total would understate it silently.
   */
  const executionCost = providerCost;

  const validationCostEstimate = sandboxCost(
    input.validationSandboxMs,
    input.validationAttempted,
    input.assumption,
  );

  // The agent's microVM is always attempted: a run that reached the point of
  // having economics at all was provisioned one.
  const infrastructureCostEstimate = sandboxCost(input.agentSandboxMs, true, input.assumption);

  return {
    executionCost,
    providerCost,
    validationCostEstimate,
    infrastructureCostEstimate,
    // `executionCost` is deliberately absent: it is `providerCost` today, and
    // adding both would double the model spend in every total.
    totalEstimatedCost: sumCosts([
      ["providerCost", providerCost],
      ["validationCostEstimate", validationCostEstimate],
      ["infrastructureCostEstimate", infrastructureCostEstimate],
    ]),
  };
}

/* ---------------------------------------------------------------------------
 * Credit scenarios (PART E) — analysis, never policy
 * ------------------------------------------------------------------------ */

/**
 * A candidate commercial model, evaluated against a real cost.
 *
 * Nothing here reaches `CREDIT_RATE_CARDS`, which stays empty. This exists so a
 * scenario can be computed the same way twice rather than in a spreadsheet
 * somebody rebuilds from memory.
 */
export type CreditScenario =
  | { kind: "cost_value"; label: string; usdPerCredit: number }
  | { kind: "gross_margin"; label: string; targetMargin: number; usdPerCredit: number };

export type ScenarioResult = {
  label: string;
  /** Retail price implied by the scenario, in nanodollars. */
  retailNanoUsd: number;
  /** Credits a customer would be charged, rounded up to a whole credit. */
  credits: number;
  /** Realised margin after rounding, or null when the cost floor is zero. */
  realisedMargin: number | null;
};

/**
 * What a scenario would charge for a given cost.
 *
 * Takes a **floor**, not a total, and the name is the warning: every sandbox
 * second in Vibe's history is unpriced, so a margin computed here is an upper
 * bound on the real one. A "80% margin" over a floor that excludes ten minutes
 * of microVM is not an 80% margin.
 */
export function applyScenario(scenario: CreditScenario, costFloorNanoUsd: number): ScenarioResult {
  const retailNanoUsd =
    scenario.kind === "cost_value"
      ? costFloorNanoUsd
      : Math.round(costFloorNanoUsd / (1 - scenario.targetMargin));

  const nanoUsdPerCredit = Math.round(scenario.usdPerCredit * 1e9);
  const credits = Math.max(1, Math.ceil(retailNanoUsd / nanoUsdPerCredit));
  const charged = credits * nanoUsdPerCredit;

  return {
    label: scenario.label,
    retailNanoUsd,
    credits,
    realisedMargin: charged > 0 ? (charged - costFloorNanoUsd) / charged : null,
  };
}
