import {
  CREDIT_RATE_CARD_SCENARIOS,
  historicalRunCostInput,
  simulateCreditRateCard,
  type CreditRateCardModel,
  type CreditRateCardScenario,
} from "./credit-rate-card";
import { HISTORICAL_RUNS } from "./historical-runs";

/**
 * Failure economics (Sprint 0052, Credit Economics v1, PART H).
 *
 * ## The number that anchors this file was re-derived, not copied
 *
 * `docs/business/ECONOMY_MODEL.md` states "two failed runs spent $0.3085 and
 * $0.6158" (model spend only) and, once sandbox cost was added, "the two
 * costly failures spent $0.3794 and $0.6842 ... plus $0.0060 for a third" —
 * three named failures. This sprint's own charter says "verify these figures
 * against the current repository state yourself; do not take them from this
 * prompt blindly," so `agent_execution_runs` was queried directly rather than
 * the prose being trusted.
 *
 * **The direct query found five failed runs, not three or two:**
 * `agent_execution_runs` held exactly 5 `failed` rows and 6 `succeeded` rows
 * — 11 total attempts, confirmed by `select status, count(*) ... group by
 * status`. Sprint 0053 re-ran the same query after run #9 and found **5
 * failed, 7 succeeded — 12 attempts**, so the rate is now 5/12 (41.7%) rather
 * than 5/11 (45.5%). Nothing here is hardcoded to either figure: every count
 * derives from `HISTORICAL_RUNS.length` and `FAILED_ATTEMPT_COSTS`, so adding
 * a delivered run moves the rate automatically and the tests catch the move. Two of the five failed runs recorded **zero** measurable cost —
 * no sandbox wall duration, no billed model call — because they failed at
 * provisioning, before anything billable happened. That is why earlier
 * sprints' prose only ever named three: the other two are real attempts that
 * genuinely cost nothing, so a tally built by listing "failures that cost
 * money" correctly never mentioned them. A tally of *attempts*, which is what
 * a failure *rate* needs, must count them.
 *
 * This is a correction to the historical record, stated once, here — not a
 * silent rewrite of the earlier sprints' own documents, which correctly
 * reported what they measured under the question they were asking.
 *
 * ## The five failed-attempt floors, in nanodollars
 *
 * Computed the same way `backfill.test.ts` computes the six delivered
 * floors — `deriveSandboxCost` plus the run's own model spend, both real,
 * both `founder_attested`-rate-card-priced. Egress bytes were not available
 * for these rows in this sprint's query, so — consistent with this whole
 * module's floor/upper-bound discipline — the outbound-network component is
 * simply absent from these floors rather than guessed, making every number
 * below a true floor, not a point estimate.
 */
export type FailedAttemptCost = {
  /** When the attempt started, for traceability back to the query — never a customer-facing label. */
  observedAt: string;
  /** Model spend alone, from `ai_usage_events`. Zero for the two attempts that died before any billable call. */
  providerCostNanoUsd: number;
  /** Sandbox floor alone, from `deriveSandboxCost`. Zero for the two attempts with no recorded wall duration. */
  infrastructureCostNanoUsd: number;
  floorNanoUsd: number;
};

export const FAILED_ATTEMPT_COSTS: readonly FailedAttemptCost[] = [
  { observedAt: "2026-08-18T21:33:12Z", providerCostNanoUsd: 0, infrastructureCostNanoUsd: 5_766_940, floorNanoUsd: 5_766_940 },
  { observedAt: "2026-08-19T00:12:36Z", providerCostNanoUsd: 0, infrastructureCostNanoUsd: 0, floorNanoUsd: 0 },
  { observedAt: "2026-08-19T08:36:05Z", providerCostNanoUsd: 0, infrastructureCostNanoUsd: 0, floorNanoUsd: 0 },
  { observedAt: "2026-08-19T08:58:15Z", providerCostNanoUsd: 308_477_800, infrastructureCostNanoUsd: 69_971_759, floorNanoUsd: 378_449_559 },
  { observedAt: "2026-08-19T09:37:23Z", providerCostNanoUsd: 615_841_700, infrastructureCostNanoUsd: 67_176_107, floorNanoUsd: 683_017_807 },
];

export type HistoricalFailureEconomics = {
  deliveredCount: number;
  failedCount: number;
  totalAttempts: number;
  /** failedCount / totalAttempts. */
  historicalFailureRate: number;
  deliveredFloorNanoUsd: number;
  failedFloorNanoUsd: number;
  totalFloorNanoUsd: number;
  /** totalFloorNanoUsd / deliveredCount — what one delivered run really costs, failures included. */
  effectiveCostPerDeliveredRunNanoUsd: number;
  /** failedFloorNanoUsd / deliveredCount — the uplift over a delivered run's own cost alone. */
  failureOverheadPerDeliveredRunNanoUsd: number;
};

/**
 * The historical failure economics, computed fresh from the six delivered
 * floors (`historical-runs.ts`, itself pinned against `backfill.test.ts`)
 * and the five failed-attempt floors above. No cached total; every call
 * re-sums, so this can never drift from the two inputs it depends on.
 */
export function computeHistoricalFailureEconomics(): HistoricalFailureEconomics {
  const deliveredFloorNanoUsd = HISTORICAL_RUNS.reduce(
    (sum, run) => sum + run.economicCostFloorNanoUsd,
    0,
  );
  const failedFloorNanoUsd = FAILED_ATTEMPT_COSTS.reduce((sum, f) => sum + f.floorNanoUsd, 0);

  const deliveredCount = HISTORICAL_RUNS.length;
  const failedCount = FAILED_ATTEMPT_COSTS.length;
  const totalAttempts = deliveredCount + failedCount;
  const totalFloorNanoUsd = deliveredFloorNanoUsd + failedFloorNanoUsd;

  return {
    deliveredCount,
    failedCount,
    totalAttempts,
    historicalFailureRate: failedCount / totalAttempts,
    deliveredFloorNanoUsd,
    failedFloorNanoUsd,
    totalFloorNanoUsd,
    effectiveCostPerDeliveredRunNanoUsd: Math.round(totalFloorNanoUsd / deliveredCount),
    failureOverheadPerDeliveredRunNanoUsd: Math.round(failedFloorNanoUsd / deliveredCount),
  };
}

export type DeliveredRunMarginResult = {
  model: CreditRateCardModel;
  /** Sum of what this scenario would have charged across all six delivered runs. */
  totalRevenueNanoUsd: number;
  /** totalRevenueNanoUsd / 6 — the average Credit charge realised per delivered run. */
  averageRevenuePerDeliveredRunNanoUsd: number;
  /** The failure-adjusted cost of one delivered run — includes every failed attempt's spend. */
  effectiveCostPerDeliveredRunNanoUsd: number;
  grossProfitPerDeliveredRunNanoUsd: number;
  /** grossProfit / averageRevenue. Can be negative — a rate card that does not clear its own failure overhead. */
  grossMargin: number;
  coversFailureOverhead: boolean;
};

/**
 * What one rate-card scenario actually nets per delivered run, once every
 * failed attempt's real spend is charged against it (PART H).
 *
 * This is the number PART E's simulated per-run margin cannot show on its
 * own: `simulateCreditRateCard` compares one run's revenue to *that run's*
 * cost, which is silent about the failed attempts that happened around it. A
 * rate card can look profitable on every individual delivered run and still
 * lose money once failures are priced in — that is exactly the gap this
 * function closes, using `computeHistoricalFailureEconomics`'s
 * failure-adjusted effective cost instead of any single run's own floor.
 */
export function calculateDeliveredRunMargin(scenario: CreditRateCardScenario): DeliveredRunMarginResult {
  const failureEconomics = computeHistoricalFailureEconomics();

  const rows = HISTORICAL_RUNS.map((run) =>
    simulateCreditRateCard(scenario, historicalRunCostInput(run)),
  );
  const totalRevenueNanoUsd = rows.reduce((sum, row) => sum + row.retailRevenueNanoUsd, 0);
  const averageRevenuePerDeliveredRunNanoUsd = Math.round(totalRevenueNanoUsd / rows.length);

  const grossProfitPerDeliveredRunNanoUsd =
    averageRevenuePerDeliveredRunNanoUsd - failureEconomics.effectiveCostPerDeliveredRunNanoUsd;

  return {
    model: scenario.model,
    totalRevenueNanoUsd,
    averageRevenuePerDeliveredRunNanoUsd,
    effectiveCostPerDeliveredRunNanoUsd: failureEconomics.effectiveCostPerDeliveredRunNanoUsd,
    grossProfitPerDeliveredRunNanoUsd,
    grossMargin: grossProfitPerDeliveredRunNanoUsd / averageRevenuePerDeliveredRunNanoUsd,
    coversFailureOverhead: grossProfitPerDeliveredRunNanoUsd > 0,
  };
}

/** Every scenario's failure-adjusted margin, for the report table. */
export function calculateAllDeliveredRunMargins(): readonly DeliveredRunMarginResult[] {
  return CREDIT_RATE_CARD_SCENARIOS.map(calculateDeliveredRunMargin);
}
