import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { VERCEL_FUNCTIONS_RATES, VERCEL_SANDBOX_RATES } from "@/modules/economy/infrastructure-rates";
import { deriveActualExecutionEconomics } from "@/modules/economy/intelligence/actual-economics";
import { resolveEconomyModel } from "@/modules/economy/intelligence/model-version";
import { capturePredictionSnapshot } from "@/modules/economy/intelligence/prediction-snapshot";
import { anthropicRates } from "@/modules/economy/intelligence/provider-rates";
import { compareEstimateToActual } from "@/modules/economy/intelligence/reconciliation";
import { deriveRepositoryDrift } from "@/modules/economy/intelligence/repository-drift";
import type { SandboxUsage } from "@/modules/economy/sandbox-cost";
import { REALISTIC_STEP_WORK } from "@/modules/economy/workflow-invocation-cost";
import { calibrationFixtureForRun, type CalibrationFixture } from "./calibration";
import {
  renderPrediction,
  renderReconciliation,
  repositoryContextFrom,
} from "./calibration-report";

const AT = new Date("2026-08-21T00:00:00Z");
const MODEL = resolveEconomyModel(AT);

function requireFixture(run: number): CalibrationFixture {
  const fixture = calibrationFixtureForRun(run);
  if (!fixture) throw new Error(`calibration run ${run} is missing`);
  return fixture;
}

const FIXTURE = requireFixture(3);

const REPOSITORY = repositoryContextFrom(
  {
    treeEntries: 1_500,
    filesAnalyzed: 44,
    bytesAnalyzed: 220_000,
    routesDetected: 36,
    surfacesDetected: 7,
    candidatesAvailable: 40,
  },
  12,
);

function snapshotFor(overrides: { repositoryContext?: typeof REPOSITORY } = {}) {
  return capturePredictionSnapshot({
    at: AT,
    pricingClass: FIXTURE.expectedPricingClass,
    pricingClassReason: "single_surface",
    riskClass: FIXTURE.expectedRiskClass,
    changeKind: FIXTURE.changeKind,
    evidenceIds: FIXTURE.evidenceIds,
    surfaces: FIXTURE.expectedSurfaces,
    repositoryContext:
      overrides.repositoryContext === undefined ? REPOSITORY : overrides.repositoryContext,
    expectedValidationDepth: null,
    modelRates: anthropicRates("claude-sonnet-5", AT),
    economyModel: MODEL,
  });
}

function sandbox(overrides: Partial<SandboxUsage> = {}): SandboxUsage {
  return {
    purpose: "agent_execution",
    wallMs: 600_000,
    activeCpuMs: 120_000,
    vcpus: 4,
    vcpusBasis: "derived_from_configuration",
    creations: 1,
    outboundBytes: 0,
    snapshot: null,
    ...overrides,
  };
}

function actualFor(providerCostNanoUsd: number | null) {
  return deriveActualExecutionEconomics({
    providerCostNanoUsd,
    agentSandbox: sandbox(),
    validationSandbox: sandbox({ purpose: "change_validation", wallMs: 210_000, activeCpuMs: 60_000 }),
    validationAttempted: true,
    workflowSteps: 30,
    rates: VERCEL_SANDBOX_RATES,
    functionsRates: VERCEL_FUNCTIONS_RATES,
    stepWork: REALISTIC_STEP_WORK,
  });
}

function predictionInput() {
  return {
    fixture: FIXTURE,
    snapshot: snapshotFor(),
    baseSha: "0123456789abcdef0123456789abcdef01234567",
    projectId: "11111111-2222-3333-4444-555555555555",
    stepKey: "dogfood-fixture--calibration-3-standard-logic",
  };
}

describe("the prediction report is a frozen pre-run record", () => {
  it("names the run, the fixture and the commit it predicted against", () => {
    const report = renderPrediction(predictionInput());

    expect(report).toContain("# Calibration Run 3 — Prediction");
    expect(report).toContain("calibration-3-standard-logic");
    expect(report).toContain("0123456789abcdef0123456789abcdef01234567");
    expect(report).toContain("Frozen before execution");
  });

  it("states the versions the estimate was made under", () => {
    const report = renderPrediction(predictionInput());

    expect(report).toContain("economy-model.v1");
    expect(report).toContain("claude-sonnet-5-introductory-2026");
  });

  /**
   * A cost without its confidence is a promise. The report carries the level
   * and the count behind it, so the number can be read as an observation.
   */
  it("never states a cost without its confidence and sample size", () => {
    const report = renderPrediction(predictionInput());

    expect(report).toMatch(/Confidence \| \*\*(none|low|medium|high)\*\*, from \d+ comparable run\(s\)/);
  });

  it("lists the matched historical runs, not just their mean", () => {
    const report = renderPrediction(predictionInput());

    expect(report).toContain("| Run | Similarity | Matched on | Floor |");
    expect(report).toMatch(/\| #\d+ \|/);
  });

  /**
   * Sprint 0054's backtest was 24% wrong mostly because repository context was
   * absent. A report that listed only the inputs it had would make the same
   * omission invisible the second time.
   */
  it("states what it could not see as prominently as what it could", () => {
    const report = renderPrediction(predictionInput());

    expect(report).toContain("## What this prediction could not see");
    expect(report).toContain("Validation depth is unresolved");
  });

  it("says so plainly when the repository was never measured", () => {
    const report = renderPrediction({ ...predictionInput(), snapshot: snapshotFor({ repositoryContext: null }) });

    expect(report).toContain("Repository size was not measured at this commit.");
    expect(report).toContain("Not measured — the estimate carries no repository term.");
  });

  it("reports context pressure when the repository was measured", () => {
    const report = renderPrediction(predictionInput());

    expect(report).toContain("12 sent of 40 available");
    expect(report).toContain("Context pressure: **severe**");
  });

  it("renders the same bytes every time", () => {
    expect(renderPrediction(predictionInput())).toBe(renderPrediction(predictionInput()));
  });
});

describe("the reconciliation report explains the run without rewriting the prediction", () => {
  function reconciliationInput(providerCost: number | null = 500_000_000) {
    const snapshot = snapshotFor();
    const actual = actualFor(providerCost);

    return {
      fixture: FIXTURE,
      snapshot,
      actual,
      comparison: compareEstimateToActual(snapshot.estimate, actual),
      agentRunId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      runStatus: "succeeded",
      validationStatus: "passed",
      actualValidationDepth: "standard" as const,
      repositoryContextAtExecution: REPOSITORY,
      actualProviderPricingVersion: "claude-sonnet-5-introductory-2026",
    };
  }

  it("splits the actual cost by component and marks each one's basis", () => {
    const report = renderReconciliation(reconciliationInput());

    expect(report).toContain("| Model |");
    expect(report).toContain("| Agent sandbox |");
    expect(report).toContain("measured");
    expect(report).toContain("estimated");
  });

  it("shows the predicted and actual figures side by side", () => {
    const report = renderReconciliation(reconciliationInput());

    expect(report).toContain("## Prediction vs reality");
    expect(report).toMatch(/Relative error \| -?\d+\.\d%/);
  });

  /**
   * The prediction is an input here, never recomputed. If this report could
   * re-derive the estimate against what happened, every run would look accurate.
   */
  it("reports the prediction the snapshot carries, not a fresh one", () => {
    const input = reconciliationInput();
    const report = renderReconciliation(input);
    const predicted = input.snapshot.estimate.estimatedCost;

    if (!predicted.known) throw new Error("expected a priced prediction");
    expect(report).toContain(`$${(predicted.nanoUsd / 1e9).toFixed(4)}`);
  });

  it("names a floor as a floor when a component is missing", () => {
    const report = renderReconciliation(reconciliationInput(null));

    expect(report).toContain("incomplete. Missing: model");
    expect(report).toContain("`actual_incomplete`");
  });

  /**
   * The variance layer only cites signals that moved with the variance. A run
   * that came in over against a repository that did not move has no explanation
   * in these signals, and saying "unexplained" is the honest output.
   */
  it("declares an unexplainable variance unexplained rather than guessing", () => {
    const report = renderReconciliation(reconciliationInput());

    expect(report).toContain("## Variance explanation");
    expect(report).toContain("**Unexplained.**");
  });

  it("cites repository growth when the repository actually moved", () => {
    const drift = deriveRepositoryDrift(
      repositoryContextFrom(
        { treeEntries: 1_200, filesAnalyzed: 30, bytesAnalyzed: 150_000, routesDetected: 30, surfacesDetected: 6, candidatesAvailable: 6 },
        6,
      ),
      REPOSITORY,
    );

    const report = renderReconciliation({ ...reconciliationInput(), drift });

    expect(report).toContain("repository_grew");
    expect(report).toContain("Drift level: **high_change**");
  });

  it("says nothing about movement it could not measure", () => {
    const report = renderReconciliation(reconciliationInput());

    expect(report).toContain("no axis had a value on both sides, so nothing is claimed");
  });

  /**
   * "The prediction was 40% low" reads like a call to action. One observation
   * against a sample floor of twenty is not one.
   */
  it("refuses to let one run move a future estimate", () => {
    const report = renderReconciliation(reconciliationInput());

    expect(report).toContain("**Not yet.**");
    expect(report).toContain("requires 20 comparable observations");
  });

  it("excludes an incomparable run from the dataset rather than scoring it zero", () => {
    const report = renderReconciliation(reconciliationInput(null));

    expect(report).toContain("contributes nothing to the learning dataset — not even a zero");
  });

  it("renders the same bytes every time", () => {
    expect(renderReconciliation(reconciliationInput())).toBe(
      renderReconciliation(reconciliationInput()),
    );
  });
});

/**
 * The structural half of "a prediction may not be re-derived from actuals".
 * The estimator's own guard covers the estimator; this covers the reporter that
 * sits next to it and takes both halves as arguments.
 */
describe("the prediction renderer cannot see what a run cost", () => {
  it("takes no actuals and reads no actual-cost module", () => {
    const source = readFileSync(
      join(process.cwd(), "src/modules/coding-agent/dogfood/calibration-report.ts"),
      "utf8",
    );
    const renderer = source.slice(
      source.indexOf("export function renderPrediction"),
      source.indexOf("export type ReconciliationReportInput"),
    );
    const code = renderer.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

    // Identifiers, not the substring "actual" — the report body legitimately
    // names the file the reconciliation is appended to, and a guard that fired
    // on prose would get relaxed the first time it cried wolf.
    for (const forbidden of [
      "ActualExecutionEconomics",
      "EconomicsComparison",
      "actualCost",
      "actualFloorNanoUsd",
      "relativeError",
      "input.actual",
      "input.comparison",
    ]) {
      expect(code, `renderPrediction references ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("keeps the two reports as separate functions", () => {
    const source = readFileSync(
      join(process.cwd(), "src/modules/coding-agent/dogfood/calibration-report.ts"),
      "utf8",
    );

    expect(source).toContain("export function renderPrediction");
    expect(source).toContain("export function renderReconciliation");
  });
});
