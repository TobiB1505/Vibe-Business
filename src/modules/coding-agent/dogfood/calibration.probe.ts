import { readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { storedCostToNanoUsd } from "@/modules/credits/projection";
import type { RepositoryContextSize } from "@/modules/economy/cost-drivers";
import { VERCEL_FUNCTIONS_RATES, VERCEL_SANDBOX_RATES } from "@/modules/economy/infrastructure-rates";
import { deriveActualExecutionEconomics } from "@/modules/economy/intelligence/actual-economics";
import { resolveEconomyModel } from "@/modules/economy/intelligence/model-version";
import { capturePredictionSnapshot, type PredictionSnapshot } from "@/modules/economy/intelligence/prediction-snapshot";
import { anthropicRates } from "@/modules/economy/intelligence/provider-rates";
import { compareEstimateToActual } from "@/modules/economy/intelligence/reconciliation";
import { deriveRepositoryDrift } from "@/modules/economy/intelligence/repository-drift";
import type { SandboxUsage } from "@/modules/economy/sandbox-cost";
import { AGENT_WORKFLOW_FIXED_STEPS, REALISTIC_STEP_WORK, workflowEventCount } from "@/modules/economy/workflow-invocation-cost";
import type { ValidationDepth } from "@/modules/validation/depth";
import { calibrationFixtureForRun, type CalibrationFixture } from "./calibration";
import { renderPrediction, renderReconciliation, repositoryContextFrom } from "./calibration-report";
import { prepareBenchmark } from "./benchmark";
import { benchmarkStepKey } from "./fixtures";

/**
 * The calibration operator's two commands (Sprint 0055).
 *
 * **Dev-only. Not part of the test suite.** `vitest.config.mts` includes only
 * `*.test.ts`, so CI cannot reach a database through this file.
 *
 * ```
 * # Before starting run N — writes the frozen prediction to stdout.
 * NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
 * VIBE_INTERNAL_AGENT_DOGFOOD_PROJECT_IDS=<uuid> \
 * VIBE_DOGFOOD_PROJECT_ID=<uuid> \
 * VIBE_CALIBRATION_RUN=1 \
 * pnpm agent:calibrate
 *
 * # After run N has finished and validated.
 * … VIBE_CALIBRATION_RUN=1 VIBE_CALIBRATION_AGENT_RUN_ID=<uuid> \
 * pnpm agent:calibrate
 * ```
 *
 * ## It cannot start a run and it cannot spend
 *
 * By construction, not by policy. `prepareBenchmark` is the existing dry run —
 * it compiles a fixture through the real pipeline and imports no provider
 * client and no execution starter. Everything else here is a `select`. The real
 * run is started by a human through the internal dogfood surface, which is
 * gated by the operator allowlist, and that remains the only start path.
 *
 * ## It writes nothing
 *
 * No row, no audit event, no file. The reports go to stdout and a human commits
 * them, which is what makes the prediction's freeze timestamp meaningful: it is
 * a commit that precedes the run.
 *
 * ## Which mode runs
 *
 * `VIBE_CALIBRATION_AGENT_RUN_ID` decides. Absent means "predict"; present means
 * "reconcile". Reconciliation needs a run id that exists, so there is no way to
 * ask for the second mode before the first has been acted on.
 */

const RUN_NUMBER = Number(process.env.VIBE_CALIBRATION_RUN ?? "0");
const PROJECT_ID = process.env.VIBE_DOGFOOD_PROJECT_ID;
const AGENT_RUN_ID = process.env.VIBE_CALIBRATION_AGENT_RUN_ID ?? null;
const PREVIOUS_RUN_ID = process.env.VIBE_CALIBRATION_PREVIOUS_RUN_ID ?? null;

function serviceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");

  // Constructed here rather than through `createServiceClient` so this harness
  // cannot be mistaken for an application code path — only
  // `src/modules/operations/` may use that one (Rule 53).
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function requireFixture(): CalibrationFixture {
  const fixture = calibrationFixtureForRun(RUN_NUMBER);
  if (!fixture) {
    throw new Error(
      `VIBE_CALIBRATION_RUN must name a calibration run (1-5); received ${process.env.VIBE_CALIBRATION_RUN ?? "nothing"}.`,
    );
  }
  return fixture;
}

/** The run row's own repository columns, as the economy layer's shape. */
type RunRow = {
  id: string;
  status: string;
  created_at: string;
  prepared_change_id: string | null;
  repo_tree_entries: number | null;
  repo_files_analyzed: number | null;
  repo_bytes_analyzed: number | null;
  repo_routes_detected: number | null;
  repo_surfaces_detected: number | null;
  context_candidates_available: number | null;
  context_candidates_sent: number | null;
  duration_ms: number | null;
};

const RUN_COLUMNS =
  "id,status,created_at,prepared_change_id,repo_tree_entries,repo_files_analyzed," +
  "repo_bytes_analyzed,repo_routes_detected,repo_surfaces_detected," +
  "context_candidates_available,context_candidates_sent,duration_ms";

function repositoryContextOf(run: RunRow | null): RepositoryContextSize | null {
  if (!run) return null;

  return {
    treeEntries: run.repo_tree_entries,
    filesAnalyzed: run.repo_files_analyzed,
    bytesAnalyzed: run.repo_bytes_analyzed,
    routesDetected: run.repo_routes_detected,
    surfacesDetected: run.repo_surfaces_detected,
    candidatesAvailable: run.context_candidates_available,
    candidatesSent: run.context_candidates_sent,
  };
}

type SandboxRow = {
  operation: string;
  sandbox_duration_ms: number | null;
  active_cpu_ms: number | null;
  network_egress_bytes: number | null;
};

const SANDBOX_COLUMNS = "operation,sandbox_duration_ms,active_cpu_ms,network_egress_bytes";

/**
 * A query whose failure is a failure, not an absence.
 *
 * PostgREST answers a bad column with an error object rather than a throw, and
 * `{ data: null }` is indistinguishable from "there is no such row". This bit
 * immediately: the first version selected `active_cpu_ms` from `validation_runs`,
 * where it does not exist, and the report said a validated run had `stage_not_run`
 * — a query bug rendered as a fact about the run.
 *
 * That is the same shape as the silent `catch` that hid a metering defect for an
 * entire sprint. A calibration harness whose whole purpose is telling absence
 * from zero cannot afford it, so every read goes through here.
 */
async function required<T>(
  query: PromiseLike<{ data: T | null; error: { message: string } | null }>,
  label: string,
): Promise<T> {
  const { data, error } = await query;
  if (error) throw new Error(`Reading ${label} failed: ${error.message}`);
  if (data === null) throw new Error(`Reading ${label} returned nothing.`);
  return data;
}

/**
 * The validation run for a prepared change, and the sandbox it burned.
 *
 * Two reads, because they are two rows. `validation_runs` records the outcome
 * and the wall duration; the CPU and egress live on the *sandbox* row, keyed by
 * the validation run's own id rather than the agent run's. Reading the agent
 * run's sandbox row and calling it validation would price the wrong VM.
 *
 * Null only when the change was never validated — an absence the economy layer
 * reports as `stage_not_run`, which is genuinely different from unmeasured.
 */
async function loadValidation(
  supabase: SupabaseClient,
  preparedChangeId: string | null,
): Promise<{ run: { status: string; validation_depth: ValidationDepth | null }; sandbox: SandboxRow | null } | null> {
  if (!preparedChangeId) return null;

  const runs = await required(
    supabase
      .from("validation_runs")
      .select("id,status,validation_depth,sandbox_duration_ms")
      .eq("prepared_change_id", preparedChangeId)
      .order("created_at", { ascending: false })
      .limit(1),
    "validation_runs",
  );

  const validation = (runs as { id: string; status: string; validation_depth: ValidationDepth | null }[])[0];
  if (!validation) return null;

  const sandboxRows = await required(
    supabase.from("sandbox_usage_events").select(SANDBOX_COLUMNS).eq("validation_run_id", validation.id),
    "sandbox_usage_events (validation)",
  );

  return {
    run: validation,
    sandbox: (sandboxRows as SandboxRow[]).find((row) => row.operation === "change_validation") ?? null,
  };
}

function sandboxUsageOf(
  row: { sandbox_duration_ms: number | null; active_cpu_ms: number | null; network_egress_bytes: number | null } | null,
  purpose: SandboxUsage["purpose"],
): SandboxUsage | null {
  if (!row) return null;

  return {
    purpose,
    wallMs: row.sandbox_duration_ms,
    activeCpuMs: row.active_cpu_ms,
    // Reconstructed from the pinned sandbox configuration, never reported.
    vcpus: 4,
    vcpusBasis: "derived_from_configuration",
    creations: 1,
    outboundBytes: row.network_egress_bytes,
    snapshot: null,
  };
}

describe("economy calibration", () => {
  it(
    AGENT_RUN_ID ? "reconciles a finished calibration run" : "freezes a prediction before the run",
    async () => {
      const fixture = requireFixture();
      const supabase = serviceClient();

      if (!AGENT_RUN_ID) {
        console.log(await predict(supabase, fixture));
        return;
      }

      console.log(await reconcile(supabase, fixture));
    },
    120_000,
  );
});

/** Mode one: compile the fixture, estimate, and print the frozen record. */
async function predict(supabase: SupabaseClient, fixture: CalibrationFixture): Promise<string> {
  expect(PROJECT_ID, "VIBE_DOGFOOD_PROJECT_ID is required — a calibration runs against a real project.").toBeTruthy();

  const { data: project } = await supabase
    .from("projects")
    .select("id, user_id")
    .eq("id", PROJECT_ID!)
    .maybeSingle();
  expect(project, `Project ${PROJECT_ID} was not found.`).toBeTruthy();

  const prepared = await prepareBenchmark(supabase, {
    fixtureId: fixture.id,
    projectId: PROJECT_ID!,
    userId: (project as { user_id: string }).user_id,
    expectedBaseSha: null,
  });

  if (!prepared.ok) {
    throw new Error(
      `Preflight refused: ${"reason" in prepared ? prepared.reason : "unknown"}. ` +
        "A calibration prediction must describe a run that could actually start.",
    );
  }

  const at = new Date(process.env.VIBE_CALIBRATION_AT ?? "2026-08-21T00:00:00Z");
  const economyModel = resolveEconomyModel(at);

  const repositoryContext = repositoryContextFrom(
    prepared.compiled.repositoryScale,
    prepared.compiled.contextCandidates,
  );

  // The previous calibration run against this project, so drift has a left side.
  const previous = PREVIOUS_RUN_ID ? await loadRun(supabase, PREVIOUS_RUN_ID) : null;
  const drift = deriveRepositoryDrift(repositoryContextOf(previous), repositoryContext);

  const snapshot = capturePredictionSnapshot({
    at,
    pricingClass: fixture.expectedPricingClass,
    pricingClassReason: "single_surface",
    riskClass: fixture.expectedRiskClass,
    changeKind: fixture.changeKind,
    evidenceIds: fixture.evidenceIds,
    surfaces: prepared.compiled.surfaceBusinessSurfaces,
    repositoryContext,
    repositoryDrift: drift,
    // Unresolved until a Prepared Change exists. Null, never a guess.
    expectedValidationDepth: null,
    modelRates: anthropicRates(prepared.compiled.model, at),
    economyModel,
  });

  const report = renderPrediction({
    fixture,
    snapshot,
    baseSha: prepared.compiled.baseSha,
    projectId: PROJECT_ID!,
    stepKey: benchmarkStepKey(fixture),
  });

  /*
   * The snapshot is printed alongside the report because reconciliation reads
   * it back rather than recomputing it. Two artifacts, both committed before
   * the run: the report for a human, the JSON for the second command.
   */
  return [
    report,
    "",
    `<!-- Save the block below as docs/business/calibration/run-${fixture.calibrationRun}-prediction.json`,
    "     and pass its path as VIBE_CALIBRATION_SNAPSHOT when reconciling. -->",
    "",
    "```json",
    JSON.stringify(snapshot, null, 2),
    "```",
  ].join("\n");
}

/** Mode two: read what the run cost, compare it to the frozen prediction, explain the gap. */
async function reconcile(supabase: SupabaseClient, fixture: CalibrationFixture): Promise<string> {
  const run = await loadRun(supabase, AGENT_RUN_ID!);
  if (!run) throw new Error(`Agent run ${AGENT_RUN_ID} was not found.`);

  const snapshot = frozenSnapshot();

  const [usage, agentSandboxRows, validationRow] = await Promise.all([
    required(
      supabase.from("ai_usage_events").select("provider_cost_usd,pricing_version,status").eq("job_id", run.id),
      "ai_usage_events",
    ),
    required(
      supabase
        .from("sandbox_usage_events")
        .select(SANDBOX_COLUMNS)
        .eq("validation_run_id", run.id),
      "sandbox_usage_events (agent)",
    ),
    loadValidation(supabase, run.prepared_change_id),
  ]);

  const rows = usage as { provider_cost_usd: string | number | null; pricing_version: string | null }[];

  /*
   * Null when no row carried a cost — an unmetered run is not a free one, and
   * summing an empty list to zero would make it the cheapest run on record.
   * `storedCostToNanoUsd` parses the numeric exactly rather than through a
   * float, so the total reconciles to the nanodollar against the ledger.
   */
  const priced = rows
    .map((row) => storedCostToNanoUsd(row.provider_cost_usd))
    .filter((cost): cost is number => cost !== null);
  const providerCostNanoUsd =
    priced.length === 0 ? null : priced.reduce((sum, cost) => sum + cost, 0);

  const agentSandboxRow =
    (agentSandboxRows as SandboxRow[]).find((row) => row.operation === "agent_execution") ?? null;

  const actual = deriveActualExecutionEconomics({
    providerCostNanoUsd,
    agentSandbox: sandboxUsageOf(agentSandboxRow, "agent_execution"),
    validationSandbox: validationRow ? sandboxUsageOf(validationRow.sandbox, "change_validation") : null,
    validationAttempted: validationRow !== null,
    workflowSteps:
      run.duration_ms === null
        ? null
        : AGENT_WORKFLOW_FIXED_STEPS + workflowEventCount(run.duration_ms),
    rates: VERCEL_SANDBOX_RATES,
    functionsRates: VERCEL_FUNCTIONS_RATES,
    stepWork: REALISTIC_STEP_WORK,
  });

  const previous = PREVIOUS_RUN_ID ? await loadRun(supabase, PREVIOUS_RUN_ID) : null;

  return renderReconciliation({
    fixture,
    snapshot,
    actual,
    comparison: compareEstimateToActual(snapshot.estimate, actual),
    agentRunId: run.id,
    runStatus: run.status,
    validationStatus: validationRow?.run.status ?? null,
    actualValidationDepth: validationRow?.run.validation_depth ?? null,
    drift: deriveRepositoryDrift(repositoryContextOf(previous), repositoryContextOf(run)),
    repositoryContextAtExecution: repositoryContextOf(run),
    actualProviderPricingVersion: rows.find((row) => row.pricing_version !== null)?.pricing_version ?? null,
  });
}

async function loadRun(supabase: SupabaseClient, id: string): Promise<RunRow | null> {
  const { data } = await supabase.from("agent_execution_runs").select(RUN_COLUMNS).eq("id", id).maybeSingle();
  return (data as RunRow | null) ?? null;
}

/**
 * The prediction, read back rather than recomputed.
 *
 * `VIBE_CALIBRATION_SNAPSHOT` is the path to the JSON the predict step emitted
 * alongside its report. Recomputing the estimate here would compare the run
 * against an estimate made *after* it, which is not a prediction — and the
 * comparison would flatter itself every time the dataset grew.
 */
function frozenSnapshot(): PredictionSnapshot {
  const path = process.env.VIBE_CALIBRATION_SNAPSHOT;
  if (!path) {
    throw new Error(
      "VIBE_CALIBRATION_SNAPSHOT is required — reconciliation compares against the frozen " +
        "prediction, never against one recomputed after the run.",
    );
  }

  return JSON.parse(readFileSync(path, "utf8")) as PredictionSnapshot;
}
