import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { storedCostToNanoUsd } from "@/modules/credits/projection";
import type { StepChangeKind } from "@/modules/action-plans/schema";
import type { ExecutionRiskClass } from "@/modules/execution-contract/schema";
import type { SandboxUsage } from "@/modules/economy/sandbox-cost";

/**
 * What Vibe's own completed runs cost, read back for the estimator.
 *
 * ## Why this exists at all
 *
 * `economy/historical-runs.ts` was read out of Supabase by a person on
 * 2026-08-20 and typed into the repository. It is the estimator's whole sample,
 * it has no database access, and it therefore stopped growing that morning
 * while the runs kept being written. This is the query that was never written.
 *
 * ## Five reads, none of them per run
 *
 * The obvious shape — walk the runs, and for each one fetch its usage — is
 * three round trips per run and the exact thing `execution/workspace.test.ts`
 * exists to catch elsewhere. Every read here is one `.in()` over the whole
 * bounded set, so the cost of rendering the Agent screen does not grow with how
 * much a founder has used the product.
 *
 * ## Scoped by RLS, deliberately
 *
 * A session-scoped client, so a founder's forecast rests on Vibe's published
 * measured runs plus **their own**. Reading every account's runs would need the
 * service-role client and a reviewed exception (rule 53), and would make one
 * customer's activity an input to another's screen. Neither is worth a larger
 * sample.
 *
 * ## Nothing here decides what a run cost
 *
 * These are observation rows. `economy/measured-runs.ts` decides what they
 * mean, and `deriveActualExecutionEconomics` decides what they cost — the same
 * function the calibration probe uses, so a run reconciled by hand and a run
 * read by this query cannot disagree.
 *
 * That separation is enforced rather than intended. `sprint-0054-safety.test.ts`
 * lets only four `economy/` modules be imported from outside the module, and
 * this file imports exactly one of them — `sandbox-cost`, for the shape of a
 * sandbox's dimensions. The observation type is satisfied **structurally**:
 * nothing here names it, and `run-forecast.ts` — the one file sanctioned to
 * reach the estimator — is where the two meet. If the shapes ever drift, the
 * page that joins them stops compiling, which is a better check than a comment.
 */

/**
 * How many completed runs the estimator will look at.
 *
 * A bound rather than a page: the estimator weights by similarity, not by
 * recency, so this exists to keep one query bounded (rule 27) rather than to
 * paginate. Generous against a product whose busiest account has twenty-one.
 */
export const MEASURED_RUN_LIMIT = 100;

/**
 * Row ceilings on the usage reads, and what happens when one is reached.
 *
 * `.in()` bounds how many *ids* are asked about; it says nothing about how many
 * rows each id has. A run writes one `ai_usage_events` row per model call and
 * one `sandbox_usage_events` row per sandbox, so these are generous — and
 * generous is not the same as bounded, which is why they are limits rather
 * than an argument in `read-bounds.test.ts`'s review list.
 *
 * Reaching one is treated as *not having an answer* rather than as having a
 * smaller one. A truncated usage read makes runs look cheaper than they were,
 * and a cheaper-looking history is worse than no history: it would quietly bias
 * the estimator down, with nothing to show for it (rule 44).
 */
export const MEASURED_USAGE_ROW_LIMIT = 2_000;
export const MEASURED_SANDBOX_ROW_LIMIT = 1_000;

/**
 * One completed run, as its own rows describe it.
 *
 * Structurally identical to `economy/measured-runs.ts`'s observation type and
 * deliberately not imported from it — see the note above. Written out rather
 * than inferred so the query has something to be checked against here, where
 * the columns are.
 */
type RunObservation = {
  id: string;
  createdAt: string;
  title: string;
  riskClass: ExecutionRiskClass;
  changeKind: StepChangeKind;
  evidenceIds: readonly string[];
  providerCostNanoUsd: number | null;
  agentSandbox: SandboxUsage | null;
  validationSandbox: SandboxUsage | null;
  validationAttempted: boolean;
  durationMs: number | null;
};

/** `sandbox_usage_events` carries the agent run under the validation column. */
const SANDBOX_COLUMNS =
  "validation_run_id,operation,sandbox_duration_ms,active_cpu_ms,network_egress_bytes";

type SandboxRow = {
  validation_run_id: string | null;
  operation: string | null;
  sandbox_duration_ms: number | null;
  active_cpu_ms: number | null;
  network_egress_bytes: number | null;
};

function sandboxUsageOf(
  row: SandboxRow | null,
  purpose: SandboxUsage["purpose"],
): SandboxUsage | null {
  if (!row) return null;

  return {
    purpose,
    wallMs: row.sandbox_duration_ms,
    activeCpuMs: row.active_cpu_ms,
    // Reconstructed from the pinned sandbox configuration, never reported —
    // the same assumption the calibration probe makes, for the same reason.
    vcpus: 4,
    vcpusBasis: "derived_from_configuration",
    creations: 1,
    outboundBytes: row.network_egress_bytes,
    snapshot: null,
  };
}

/**
 * The step a run was executed against.
 *
 * From `action_plan_steps`, joined through the spec's `action_plan_id` and
 * `step_key`, because the spec document does not carry `changeKind` or
 * `evidenceIds` — it carries the objective those were resolved into. Read
 * rather than reconstructed, so a classification cannot drift from the run it
 * describes; a run whose step can no longer be resolved is skipped rather than
 * classified at a guess.
 */
type StepRow = {
  action_plan_id: string;
  step_key: string;
  title: string | null;
  change_kind: string | null;
  evidence_ids: unknown;
};

function stepKeyOf(actionPlanId: string, stepKey: string): string {
  return `${actionPlanId}\u0000${stepKey}`;
}

type RunRow = {
  id: string;
  created_at: string;
  prepared_change_id: string | null;
  duration_ms: number | null;
  execution_specs: { risk_class: string; action_plan_id: string; step_key: string } | null;
};

/**
 * Every succeeded run this caller can see, as observations.
 *
 * Failed runs are excluded and that is a judgement worth stating: a run that
 * failed cost real money, but what it cost is not what a *comparable* run
 * costs — it is what stopping early costs, and averaging the two would predict
 * neither. The economics of failure have their own module.
 */
export async function listMeasuredRunObservations(
  supabase: SupabaseClient,
  { limit = MEASURED_RUN_LIMIT }: { limit?: number } = {},
): Promise<readonly RunObservation[]> {
  const { data: runRows } = await supabase
    .from("agent_execution_runs")
    .select(
      "id,created_at,prepared_change_id,duration_ms,execution_specs(risk_class,action_plan_id,step_key)",
    )
    .eq("status", "succeeded")
    .order("created_at", { ascending: true })
    .limit(limit);

  const runs = (runRows ?? []) as unknown as RunRow[];
  if (runs.length === 0) return [];

  const runIds = runs.map((run) => run.id);
  const preparedChangeIds = runs
    .map((run) => run.prepared_change_id)
    .filter((id): id is string => id !== null);

  const actionPlanIds = [
    ...new Set(
      runs.flatMap((run) => (run.execution_specs ? [run.execution_specs.action_plan_id] : [])),
    ),
  ];

  const [usageResult, validationResult, stepResult] = await Promise.all([
    supabase
      .from("ai_usage_events")
      .select("job_id,provider_cost_usd")
      .in("job_id", runIds)
      .limit(MEASURED_USAGE_ROW_LIMIT),
    preparedChangeIds.length === 0
      ? Promise.resolve({ data: [] })
      : supabase
          .from("validation_runs")
          .select("id,prepared_change_id")
          .in("prepared_change_id", preparedChangeIds),
    actionPlanIds.length === 0
      ? Promise.resolve({ data: [] })
      : supabase
          .from("action_plan_steps")
          .select("action_plan_id,step_key,title,change_kind,evidence_ids")
          .in("action_plan_id", actionPlanIds),
  ]);

  const steps = new Map<string, StepRow>();
  for (const row of (stepResult.data ?? []) as StepRow[]) {
    steps.set(stepKeyOf(row.action_plan_id, row.step_key), row);
  }

  const validations = (validationResult.data ?? []) as { id: string; prepared_change_id: string }[];

  // One read for both sandbox purposes: the agent run and the validation run
  // are both addressed by `validation_run_id`, so asking twice would be two
  // round trips for one answer.
  const { data: sandboxRows } = await supabase
    .from("sandbox_usage_events")
    .select(SANDBOX_COLUMNS)
    .in("validation_run_id", [...runIds, ...validations.map((validation) => validation.id)])
    .limit(MEASURED_SANDBOX_ROW_LIMIT);

  const usageRows = (usageResult.data ?? []) as {
    job_id: string | null;
    provider_cost_usd: unknown;
  }[];
  const sandboxRowsRead = (sandboxRows ?? []) as SandboxRow[];

  /*
   * A read that may have been cut short answers nothing.
   *
   * Partial usage rows do not make a run cheap, they make its cost unknown —
   * and an unknown treated as a total would bias every forecast downward for
   * as long as the account kept running the agent. Returning nothing falls the
   * estimator back on Vibe's published measured runs, which is the honest
   * smaller answer.
   */
  if (
    usageRows.length >= MEASURED_USAGE_ROW_LIMIT ||
    sandboxRowsRead.length >= MEASURED_SANDBOX_ROW_LIMIT
  ) {
    return [];
  }

  const modelSpend = new Map<string, number>();
  for (const row of usageRows) {
    const cost = storedCostToNanoUsd(row.provider_cost_usd as string | number | null);
    // A row without a cost is not a zero-cost row. Left out entirely, so a run
    // whose every row is unpriced stays null and gets dropped downstream
    // rather than becoming the cheapest run on record.
    if (row.job_id === null || cost === null) continue;
    modelSpend.set(row.job_id, (modelSpend.get(row.job_id) ?? 0) + cost);
  }

  const sandboxes = new Map<string, SandboxRow>();
  for (const row of sandboxRowsRead) {
    if (row.validation_run_id !== null) sandboxes.set(row.validation_run_id, row);
  }

  const validationByPreparedChange = new Map<string, string>();
  for (const validation of validations) {
    // Newest wins, and the query returns them in insertion order; a prepared
    // change validated twice is one run's worth of sandbox either way.
    validationByPreparedChange.set(validation.prepared_change_id, validation.id);
  }

  return runs.flatMap((run): RunObservation[] => {
    const spec = run.execution_specs;
    const step = spec ? (steps.get(stepKeyOf(spec.action_plan_id, spec.step_key)) ?? null) : null;
    // A run whose plan step no longer resolves is not a run at some default
    // classification. Left out, so the sample stays a sample of runs Vibe can
    // actually say something about.
    if (!spec || !step || step.change_kind === null || !Array.isArray(step.evidence_ids)) return [];

    const validationId =
      run.prepared_change_id === null
        ? null
        : (validationByPreparedChange.get(run.prepared_change_id) ?? null);

    return [
      {
        id: run.id,
        createdAt: run.created_at,
        title: step.title ?? "",
        riskClass: spec.risk_class as RunObservation["riskClass"],
        changeKind: step.change_kind as RunObservation["changeKind"],
        evidenceIds: step.evidence_ids as readonly string[],
        providerCostNanoUsd: modelSpend.get(run.id) ?? null,
        agentSandbox: sandboxUsageOf(sandboxes.get(run.id) ?? null, "agent_execution"),
        validationSandbox:
          validationId === null
            ? null
            : sandboxUsageOf(sandboxes.get(validationId) ?? null, "change_validation"),
        // A validation that ran is a validation attempted, whether or not its
        // sandbox usage was recorded. The two are different absences and
        // `deriveActualExecutionEconomics` treats them differently.
        validationAttempted: validationId !== null,
        durationMs: run.duration_ms,
      },
    ];
  });
}
