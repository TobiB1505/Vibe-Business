import { formatNanoUsd } from "@/modules/economy/cost";
import type { RepositoryContextSize } from "@/modules/economy/cost-drivers";
import type { ActualExecutionEconomics } from "@/modules/economy/intelligence/actual-economics";
import { deriveContextPressure } from "@/modules/economy/intelligence/context-pressure";
import type { PredictionSnapshot } from "@/modules/economy/intelligence/prediction-snapshot";
import type { EconomicsComparison } from "@/modules/economy/intelligence/reconciliation";
import { NO_PRIOR_EXECUTION, type RepositoryDriftSignal } from "@/modules/economy/intelligence/repository-drift";
import { explainVariance, type VarianceExplanation } from "@/modules/economy/intelligence/variance-explanation";
import type { BriefRepositoryScale } from "@/modules/execution-context/brief";
import type { ValidationDepth } from "@/modules/validation/depth";
import type { CalibrationFixture } from "./calibration";

/**
 * The two halves of a calibration run, rendered (Sprint 0055).
 *
 * ## Why the prediction is written to a file before the run
 *
 * Because a prediction that can be edited after the fact is not a prediction.
 * There is no `execution_economics_predictions` table — Sprint 0054 deliberately
 * shipped no schema — so the freezing mechanism is a committed file with a
 * commit timestamp that precedes the run's `created_at`. Git is the audit trail
 * here, and it is a better one than a row nobody constrained.
 *
 * ## Why the two halves cannot be rendered together
 *
 * `renderPrediction` takes no actuals and `renderReconciliation` takes the
 * prediction as an immutable input. A single function holding both would make
 * it one edit away from quietly re-deriving the estimate against what actually
 * happened, which is the failure Sprint 0054's source scan already guards the
 * estimator against.
 *
 * ## Everything here is deterministic
 *
 * No clock, no randomness, no model. The reports are a projection of values the
 * economy layer already computed, so re-rendering a report reproduces it byte
 * for byte.
 */

export const CALIBRATION_REPORT_VERSION = "calibration-report.v1" as const;

/** `BriefRepositoryScale` as the economy layer's own shape. One projection, in one place. */
export function repositoryContextFrom(
  scale: BriefRepositoryScale | null,
  candidatesSent: number | null,
): RepositoryContextSize | null {
  if (!scale) return null;

  return {
    treeEntries: scale.treeEntries,
    filesAnalyzed: scale.filesAnalyzed,
    bytesAnalyzed: scale.bytesAnalyzed,
    routesDetected: scale.routesDetected,
    surfacesDetected: scale.surfacesDetected,
    candidatesAvailable: scale.candidatesAvailable,
    candidatesSent,
  };
}

export type PredictionReportInput = {
  fixture: CalibrationFixture;
  snapshot: PredictionSnapshot;
  /** The commit the run will be pinned to, so the report names the tree it predicted against. */
  baseSha: string;
  projectId: string;
  stepKey: string;
};

/**
 * The frozen pre-run record.
 *
 * Deliberately states what it could *not* see as prominently as what it could.
 * Sprint 0054's backtest was 24% wrong mostly because repository context was
 * absent, and a report that only listed the inputs it had would make the same
 * omission invisible again.
 */
export function renderPrediction(input: PredictionReportInput): string {
  const { fixture, snapshot } = input;
  const estimate = snapshot.estimate;
  const cost = estimate.estimatedCost;

  const lines: string[] = [
    `# Calibration Run ${fixture.calibrationRun} — Prediction`,
    "",
    `**Frozen before execution.** Nothing below may be edited after the run; the reconciliation`,
    `is appended to \`run-${fixture.calibrationRun}-actual.md\` instead.`,
    "",
    `- Fixture: \`${fixture.id}\``,
    `- Step key: \`${input.stepKey}\``,
    `- Project: \`${input.projectId}\``,
    `- Base commit: \`${input.baseSha}\``,
    `- Economy model: \`${snapshot.economyModelVersion}\``,
    `- Provider pricing: \`${snapshot.providerPricingVersion ?? "none"}\``,
    `- Report version: \`${CALIBRATION_REPORT_VERSION}\``,
    "",
    "## What this run is for",
    "",
    fixture.calibrationIntent,
    "",
    "## Prediction",
    "",
    `| | |`,
    `|---|---|`,
    `| Estimated cost | ${cost.known ? formatNanoUsd(cost.nanoUsd) : `unknown (${cost.reason})`} |`,
    `| Upper bound | ${estimate.estimatedCostUpperNanoUsd === null ? "unknown" : formatNanoUsd(estimate.estimatedCostUpperNanoUsd)} |`,
    `| Protected cost | ${snapshot.safetyMargin.protectedCostNanoUsd === null ? "unknown" : formatNanoUsd(snapshot.safetyMargin.protectedCostNanoUsd)} (buffer ${Math.round(snapshot.safetyMargin.riskBufferFraction * 100)}%) |`,
    `| Pricing class | \`${estimate.pricingClass ?? "none"}\` (${estimate.pricingClassReason}) |`,
    `| Confidence | **${snapshot.confidence.overall}**, from ${snapshot.confidence.sampleSize} comparable run(s) |`,
    "",
    "### Confidence, by axis",
    "",
    `- Historical data: ${snapshot.confidence.historicalData}`,
    `- Repository signal: ${snapshot.confidence.repositorySignal}`,
    `- Provider pricing: ${snapshot.confidence.providerPricing}`,
    "",
    "## Historical basis",
    "",
    `Basis: \`${snapshot.historicalExpectation.basis}\`, ${snapshot.historicalExpectation.sampleSize} matched run(s).`,
    "",
  ];

  if (snapshot.historicalExpectation.matches.length > 0) {
    lines.push("| Run | Similarity | Matched on | Floor |", "|---|---|---|---|");
    for (const match of snapshot.historicalExpectation.matches) {
      lines.push(
        `| #${match.run} | ${match.similarity.toFixed(2)} | ${match.matched.join(", ")} | ${formatNanoUsd(match.floorNanoUsd)} |`,
      );
    }
    lines.push("");
  } else {
    lines.push("No comparable run exists. The estimate is `unknown` rather than a number.", "");
  }

  lines.push("## Cost drivers", "");
  for (const driver of estimate.costDrivers) {
    lines.push(`- **${driver.driver}** (${driver.effect}) — ${driver.detail}`);
  }

  lines.push(
    "",
    "## What this prediction could not see",
    "",
    ...absences(snapshot),
    "",
    "## Repository context at the pinned commit",
    "",
    ...repositoryLines(snapshot.inputs.repositoryContext),
    "",
  );

  return lines.join("\n");
}

function absences(snapshot: PredictionSnapshot): string[] {
  const missing: string[] = [];
  const p = snapshot.estimate.provenance;

  if (!p.hadHistoricalNeighbours) missing.push("- No comparable historical run.");
  if (!p.hadRepositoryContext) missing.push("- Repository size was not measured at this commit.");
  if (!p.hadRepositoryDrift) {
    missing.push("- No prior execution to measure repository movement against.");
  }
  if (!p.hadValidationDepth) {
    missing.push(
      "- Validation depth is unresolved before a Prepared Change exists, so the validation term is 1.",
    );
  }
  if (!p.hadModelRates) missing.push("- No provider rate resolved for the execution model.");

  return missing.length === 0 ? ["Every input the estimator takes was present."] : missing;
}

function repositoryLines(context: RepositoryContextSize | null): string[] {
  if (!context) return ["Not measured — the estimate carries no repository term."];

  const pressure = deriveContextPressure(context);

  return [
    `- Tree entries: ${context.treeEntries ?? "not measured"}`,
    `- Files analyzed: ${context.filesAnalyzed ?? "not measured"}`,
    `- Routes detected: ${context.routesDetected ?? "not measured"}`,
    `- Surfaces detected: ${context.surfacesDetected ?? "not measured"}`,
    `- Context candidates: ${context.candidatesSent ?? "?"} sent of ${context.candidatesAvailable ?? "?"} available`,
    `- Context pressure: **${pressure.signal}**${pressure.candidatePressure === null ? "" : ` (${pressure.candidatePressure.toFixed(2)}x)`}`,
  ];
}

export type ReconciliationReportInput = {
  fixture: CalibrationFixture;
  /** Read back from the frozen file, never recomputed. */
  snapshot: PredictionSnapshot;
  actual: ActualExecutionEconomics;
  comparison: EconomicsComparison;
  agentRunId: string;
  runStatus: string;
  validationStatus: string | null;
  actualValidationDepth: ValidationDepth | null;
  /** Repository movement between the previous calibration run and this one. */
  drift?: RepositoryDriftSignal;
  repositoryContextAtExecution: RepositoryContextSize | null;
  actualProviderPricingVersion: string | null;
};

/** The post-run record: what it cost, how wrong the prediction was, and why. */
export function renderReconciliation(input: ReconciliationReportInput): string {
  const { fixture, snapshot, actual, comparison } = input;
  const drift = input.drift ?? NO_PRIOR_EXECUTION;
  const explanation = explainCalibrationVariance(input, drift);

  const lines: string[] = [
    `# Calibration Run ${fixture.calibrationRun} — Actual`,
    "",
    `- Fixture: \`${fixture.id}\``,
    `- Agent run: \`${input.agentRunId}\``,
    `- Run status: \`${input.runStatus}\``,
    `- Validation: \`${input.validationStatus ?? "not run"}\`${input.actualValidationDepth ? ` (${input.actualValidationDepth})` : ""}`,
    `- Economy model: \`${snapshot.economyModelVersion}\``,
    "",
    "## Actual economics",
    "",
    "| Component | Cost | Basis |",
    "|---|---|---|",
    componentRow("Model", actual.components.model),
    componentRow("Agent sandbox", actual.components.agentSandbox),
    componentRow("Validation", actual.components.validation),
    componentRow("Infrastructure", actual.components.infrastructure),
    "",
    `**Known floor: ${formatNanoUsd(actual.actualCost.knownFloorNanoUsd)}**` +
      (actual.actualCost.complete
        ? " — every component resolved."
        : ` — incomplete. Missing: ${actual.actualCost.missing.join(", ")}.`),
    "",
    `Measurement confidence: **${actual.confidence}**.`,
    "",
    "## Prediction vs reality",
    "",
    "| | |",
    "|---|---|",
    `| Predicted | ${comparison.predictedNanoUsd === null ? "unknown" : formatNanoUsd(comparison.predictedNanoUsd)} |`,
    `| Actual (floor) | ${comparison.actualFloorNanoUsd === null ? "unknown" : formatNanoUsd(comparison.actualFloorNanoUsd)} |`,
    `| Difference | ${comparison.differenceNanoUsd === null ? "n/a" : formatNanoUsd(comparison.differenceNanoUsd)} |`,
    `| Relative error | ${comparison.relativeError === null ? "n/a" : `${(comparison.relativeError * 100).toFixed(1)}%`} |`,
    `| Comparable | ${comparison.comparable ? "yes" : `no — \`${comparison.incomparableReason}\``} |`,
    "",
    "## Variance explanation",
    "",
  ];

  if (explanation.reasons.length === 0) {
    lines.push(
      explanation.direction === "on_target"
        ? "The prediction was on target. Nothing to explain."
        : "**Unexplained.** None of the measured signals moved in the direction of this variance. " +
            "Attributing it to the nearest-looking cause would be a guess.",
    );
  } else {
    for (const reason of explanation.reasons) {
      lines.push(`- **${reason.reason}** (${reason.confidence}) — ${reason.evidence}`);
    }
  }

  if (explanation.unexplainedShare !== null) {
    lines.push("", `Unexplained share: **${Math.round(explanation.unexplainedShare * 100)}%**.`);
  }

  lines.push(
    "",
    "## Repository movement since the previous calibration run",
    "",
    `Drift level: **${drift.driftLevel}**` +
      (drift.measurable.length === 0
        ? " — no axis had a value on both sides, so nothing is claimed."
        : ` (measured on: ${drift.measurable.join(", ")})`),
    "",
    "## Economy learning",
    "",
    ...learningLines(comparison),
    "",
  );

  return lines.join("\n");
}

function explainCalibrationVariance(
  input: ReconciliationReportInput,
  drift: RepositoryDriftSignal,
): VarianceExplanation {
  return explainVariance({
    comparison: input.comparison,
    drift,
    pressureAtPrediction: deriveContextPressure(input.snapshot.inputs.repositoryContext),
    pressureAtExecution: deriveContextPressure(input.repositoryContextAtExecution),
    // No cohort clears the sample floor yet, so there is no bias to cite.
    bias: null,
    expectedValidationDepth: input.snapshot.inputs.expectedValidationDepth,
    actualValidationDepth: input.actualValidationDepth,
    predictedPricingVersion: input.snapshot.providerPricingVersion,
    actualPricingVersion: input.actualProviderPricingVersion,
    predictionHadNoHistory: !input.snapshot.estimate.provenance.hadHistoricalNeighbours,
  });
}

function componentRow(label: string, cost: ActualExecutionEconomics["components"]["model"]): string {
  return cost.known
    ? `| ${label} | ${formatNanoUsd(cost.nanoUsd)} | ${cost.basis} |`
    : `| ${label} | unknown | ${cost.reason} |`;
}

/**
 * Whether this run should move a future estimate.
 *
 * One run never should. The adjustment policy's sample floor is 20, and a
 * correction fitted to one observation is the loop teaching itself noise. The
 * report says so explicitly rather than leaving the reader to infer it, because
 * "the prediction was 40% low" reads like a call to action.
 */
function learningLines(comparison: EconomicsComparison): string[] {
  if (!comparison.comparable) {
    return [
      `**No.** This run is not comparable (\`${comparison.incomparableReason}\`), so it contributes ` +
        "nothing to the learning dataset — not even a zero.",
    ];
  }

  return [
    "**Not yet.** This run joins the learning dataset, but the adjustment policy requires 20 " +
      "comparable observations before any correction is proposed. One run moving a future estimate " +
      "would be the loop fitting itself to noise.",
    "",
    `Recorded for the cohort: relative error ${((comparison.relativeError ?? 0) * 100).toFixed(1)}%.`,
  ];
}
