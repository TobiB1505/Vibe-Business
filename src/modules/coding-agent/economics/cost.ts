/**
 * What an agent execution cost, and what it bought.
 *
 * ## Derived, never a new column
 *
 * Every number here already exists somewhere durable: provider cost per call in
 * `ai_usage_events`, CPU and egress in `sandbox_usage_events`, the outcome in
 * `agent_execution_runs` and `prepared_changes`. A stored `total_cost_usd`
 * would be a fourth place for a number three places already determine, and the
 * first time they disagreed nobody would know which was right.
 *
 * ## What "a successful change" counts
 *
 * A **prepared change that was created**, not a run that finished.
 *
 * That distinction is the entire reason to define it carefully. Runs #1 and #2
 * both reached a terminal state, both spent real provider money — $0.31 and
 * $0.62 — and neither produced anything a person could look at. Counting them
 * as denominators would report a cost per change of about $0.47 for a product
 * that had, at that point, delivered zero changes. Counting them only in the
 * numerator reports the truth: everything spent so far bought nothing yet.
 *
 * The denominator is therefore rows in `prepared_changes` reaching `prepared`,
 * which is the first artifact a human can actually review. Validation and
 * approval come later and are separately measurable; a change that is prepared
 * and then fails validation still *was* prepared, and the money that produced
 * it bought a reviewable artifact.
 *
 * ## Sandbox cost
 *
 * Not computed. `sandbox_usage_events.provider_cost_usd` is nullable and the
 * provider does not report a per-sandbox price, so every run so far has stored
 * `null` there. The raw metering — active CPU, wall duration, egress bytes —
 * *is* stored and is returned as-is. An invented rate would produce a number
 * that looks like money and is not, which is worse than an honest gap.
 */

export type ProviderUsageRow = {
  status: string;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadInputTokens: number | null;
  cacheCreationInputTokens: number | null;
  thinkingTokens: number | null;
  providerCostUsd: number | null;
  latencyMs: number | null;
};

export type SandboxMeteringRow = {
  activeCpuMs: number | null;
  sandboxDurationMs: number | null;
  networkEgressBytes: number | null;
  networkIngressBytes: number | null;
  providerCostUsd: number | null;
};

export type ProviderEconomics = {
  calls: number;
  succeededCalls: number;
  failedCalls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  thinkingTokens: number;
  /** Cache reads as a share of all input the model was billed for reading. */
  cacheHitRatio: number | null;
  /** Mean billed input per call, cache included. Null with no calls. */
  averageInputTokensPerCall: number | null;
  /** The single largest call by total input. Null with no calls. */
  largestCallInputTokens: number | null;
  costUsd: number;
};

export type SandboxEconomics = {
  activeCpuMs: number | null;
  durationMs: number | null;
  networkEgressBytes: number | null;
  networkIngressBytes: number | null;
  /**
   * Null whenever the provider did not report one.
   *
   * Deliberately not derived from CPU time: no rate is stored anywhere in this
   * product, and inventing one would put a fabricated number next to a measured
   * one with nothing in the UI to tell them apart.
   */
  costUsd: number | null;
};

export type ExecutionEconomics = {
  provider: ProviderEconomics;
  sandbox: SandboxEconomics;
  /**
   * Provider plus sandbox, or null when the sandbox half is unknown.
   *
   * Null rather than "provider only", because a total that silently omits a
   * component is the kind of number somebody later builds a margin on.
   */
  totalCostUsd: number | null;
  /** What the run was authorized to spend on inference. */
  providerBudgetUsd: number | null;
  /** Authorized minus spent, floored at zero. Null without a budget. */
  providerBudgetRemainingUsd: number | null;
};

function sum(values: readonly (number | null)[]): number {
  return values.reduce<number>((total, value) => total + (value ?? 0), 0);
}

export function summarizeProviderEconomics(
  rows: readonly ProviderUsageRow[],
): ProviderEconomics {
  const inputTokens = sum(rows.map((row) => row.inputTokens));
  const cacheRead = sum(rows.map((row) => row.cacheReadInputTokens));
  const cacheCreation = sum(rows.map((row) => row.cacheCreationInputTokens));

  // Everything the model was billed for reading, however it was priced. Cache
  // reads are the cheap third of it and the ratio is what says whether caching
  // is working at all.
  const billedInput = inputTokens + cacheRead + cacheCreation;

  const perCallInput = rows.map(
    (row) =>
      (row.inputTokens ?? 0) +
      (row.cacheReadInputTokens ?? 0) +
      (row.cacheCreationInputTokens ?? 0),
  );

  return {
    calls: rows.length,
    succeededCalls: rows.filter((row) => row.status === "succeeded").length,
    failedCalls: rows.filter((row) => row.status !== "succeeded").length,
    inputTokens,
    outputTokens: sum(rows.map((row) => row.outputTokens)),
    cacheReadInputTokens: cacheRead,
    cacheCreationInputTokens: cacheCreation,
    thinkingTokens: sum(rows.map((row) => row.thinkingTokens)),
    cacheHitRatio: billedInput > 0 ? cacheRead / billedInput : null,
    averageInputTokensPerCall: rows.length > 0 ? billedInput / rows.length : null,
    largestCallInputTokens: perCallInput.length > 0 ? Math.max(...perCallInput) : null,
    costUsd: sum(rows.map((row) => row.providerCostUsd)),
  };
}

export function summarizeSandboxEconomics(row: SandboxMeteringRow | null): SandboxEconomics {
  return {
    activeCpuMs: row?.activeCpuMs ?? null,
    durationMs: row?.sandboxDurationMs ?? null,
    networkEgressBytes: row?.networkEgressBytes ?? null,
    networkIngressBytes: row?.networkIngressBytes ?? null,
    costUsd: row?.providerCostUsd ?? null,
  };
}

export function summarizeExecutionEconomics(input: {
  usage: readonly ProviderUsageRow[];
  sandbox: SandboxMeteringRow | null;
  providerBudgetUsd?: number | null;
}): ExecutionEconomics {
  const provider = summarizeProviderEconomics(input.usage);
  const sandbox = summarizeSandboxEconomics(input.sandbox);

  const budget = input.providerBudgetUsd ?? null;

  return {
    provider,
    sandbox,
    totalCostUsd: sandbox.costUsd === null ? null : provider.costUsd + sandbox.costUsd,
    providerBudgetUsd: budget,
    providerBudgetRemainingUsd: budget === null ? null : Math.max(0, budget - provider.costUsd),
  };
}

/* ---------------------------------------------------------------------------
 * Across runs
 * ------------------------------------------------------------------------ */

export type RunCostRow = {
  runId: string;
  providerCostUsd: number;
  sandboxCostUsd: number | null;
  /** Whether this run produced a prepared change a person could review. */
  producedPreparedChange: boolean;
};

export type ChangeEconomics = {
  runs: number;
  successfulChanges: number;
  /** Money spent by every run, successful or not. */
  totalProviderCostUsd: number;
  /** Money spent by runs that produced nothing reviewable. */
  rejectedRunCostUsd: number;
  /**
   * The headline metric.
   *
   * Null when nothing has been prepared yet — which is the honest answer, and
   * not zero and not infinity. A product that has spent money and delivered no
   * change has an undefined cost per change, and saying so is more useful than
   * a number that hides the denominator.
   */
  costPerSuccessfulChangeUsd: number | null;
};

export function summarizeChangeEconomics(rows: readonly RunCostRow[]): ChangeEconomics {
  const successful = rows.filter((row) => row.producedPreparedChange);

  // Sandbox cost is deliberately excluded from the aggregate while the provider
  // reports none: mixing a measured half with an absent half would understate
  // the total silently. `sandboxCostUsd` is carried per run so the aggregate
  // can include it the moment there is one to include.
  const totalProvider = rows.reduce((total, row) => total + row.providerCostUsd, 0);
  const rejected = rows
    .filter((row) => !row.producedPreparedChange)
    .reduce((total, row) => total + row.providerCostUsd, 0);

  return {
    runs: rows.length,
    successfulChanges: successful.length,
    totalProviderCostUsd: totalProvider,
    rejectedRunCostUsd: rejected,
    costPerSuccessfulChangeUsd: successful.length === 0 ? null : totalProvider / successful.length,
  };
}
