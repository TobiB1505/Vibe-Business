import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AbsorbedStepSatisfaction, AgentStepCompletionEvidence } from "./completion";

type CompletionSpecRow = {
  id: string;
  step_key: string;
  step_order: number;
  /** Every step this run delivers, head first. Empty for a run of one. */
  chain_step_keys: string[] | null;
  chain_step_orders: number[] | null;
  /** Every step this run performs rather than delivers. Never contains the head. */
  absorbed_step_keys: string[] | null;
  absorbed_step_orders: number[] | null;
};

/** Both projections one pass produces. See {@link listStepExecutionEvidence}. */
export type StepExecutionEvidence = {
  completion: AgentStepCompletionEvidence[];
  absorbed: AbsorbedStepSatisfaction[];
};

type CompletionRunRow = {
  id: string;
  execution_spec_id: string;
  prepared_change_id: string;
};

type VerificationEventRow = {
  agent_execution_run_id: string;
};

type PassingValidationRow = {
  id: string;
  prepared_change_id: string;
  source_integrity: unknown;
};

function changedFilesWereVerified(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "changedFilesVerified" in value &&
    value.changedFilesVerified === true
  );
}

/**
 * Reads the existing execution records that jointly authorize Agent-step
 * completion. No row alone is enough:
 *
 * 1. the immutable spec binds the run to this plan and step;
 * 2. the planner-owned run succeeded and produced a Prepared Change;
 * 3. Vibe accepted the observed candidate (`change_verified`);
 * 4. independent validation passed after verifying the changed files.
 *
 * Missing or legacy evidence stays incomplete. That is intentionally safer
 * than reconstructing authority from prose or a terminal status.
 */
/**
 * The steps one spec delivered: its chain, or just its head.
 *
 * A row whose arrays disagree in length is refused by a CHECK constraint, and a
 * row whose head is absent from its own chain is refused by another — so this
 * pairs them by index without a second reconciliation. A row from before build
 * chains has empty arrays and yields exactly the one member it always did.
 */
function chainMembers(spec: CompletionSpecRow): { stepKey: string; stepOrder: number }[] {
  const keys = spec.chain_step_keys ?? [];
  const orders = spec.chain_step_orders ?? [];

  if (keys.length === 0 || keys.length !== orders.length) {
    return [{ stepKey: spec.step_key, stepOrder: spec.step_order }];
  }

  return keys.map((stepKey, index) => ({ stepKey, stepOrder: orders[index] }));
}

/**
 * The steps one spec absorbed: preparation it performed, never delivered.
 *
 * Paired by index like {@link chainMembers}, and constrained the same way —
 * equal lengths, ascending orders, and the head *excluded* rather than
 * required. Empty for every row written before ADR 0091, which is the honest
 * value: those runs absorbed nothing this reader can see.
 */
function absorbedMembers(spec: CompletionSpecRow): { stepKey: string; stepOrder: number }[] {
  const keys = spec.absorbed_step_keys ?? [];
  const orders = spec.absorbed_step_orders ?? [];

  if (keys.length === 0 || keys.length !== orders.length) return [];

  return keys.map((stepKey, index) => ({ stepKey, stepOrder: orders[index] }));
}

/**
 * Both projections a plan needs, from one pass over the same four records.
 *
 * They are read together rather than by two functions because they must agree
 * about one thing: **whether the run succeeded.** A step is covered by
 * absorption only once the run that absorbed it produced a verified change and
 * passed independent validation — the same verdict, evaluated in the same
 * place, that lets the run's own steps count as complete. Two readers could
 * drift, and the drift would be a founder told an absorbed step was handled by
 * a run that failed.
 *
 * What they are not is interchangeable. `completion` says a step was carried
 * out; `absorbed` says a step no longer needs to be, and names what covered it.
 * ADR 0091 turns on keeping those apart.
 */
export async function listStepExecutionEvidence(
  supabase: SupabaseClient,
  params: { projectId: string; actionPlanId: string },
): Promise<StepExecutionEvidence> {
  const empty: StepExecutionEvidence = { completion: [], absorbed: [] };
  const { data: specData, error: specError } = await supabase
    .from("execution_specs")
    .select(
      "id, step_key, step_order, chain_step_keys, chain_step_orders, absorbed_step_keys, absorbed_step_orders",
    )
    .eq("project_id", params.projectId)
    .eq("action_plan_id", params.actionPlanId);

  if (specError) throw specError;

  const specs = (specData ?? []) as CompletionSpecRow[];
  if (specs.length === 0) return empty;

  const { data: runData, error: runError } = await supabase
    .from("agent_execution_runs")
    .select("id, execution_spec_id, prepared_change_id")
    .eq("project_id", params.projectId)
    .eq("execution_origin", "planner")
    .eq("status", "succeeded")
    .in(
      "execution_spec_id",
      specs.map((spec) => spec.id),
    )
    .not("prepared_change_id", "is", null);

  if (runError) throw runError;

  const runs = (runData ?? []) as CompletionRunRow[];
  if (runs.length === 0) return empty;

  const [eventResult, validationResult] = await Promise.all([
    supabase
      .from("agent_execution_events")
      .select("agent_execution_run_id")
      .eq("project_id", params.projectId)
      .eq("type", "change_verified")
      .in(
        "agent_execution_run_id",
        runs.map((run) => run.id),
      ),
    supabase
      .from("validation_runs")
      .select("id, prepared_change_id, source_integrity")
      .eq("project_id", params.projectId)
      .eq("status", "passed")
      .in(
        "prepared_change_id",
        runs.map((run) => run.prepared_change_id),
      ),
  ]);

  if (eventResult.error) throw eventResult.error;
  if (validationResult.error) throw validationResult.error;

  const verifiedRunIds = new Set(
    ((eventResult.data ?? []) as VerificationEventRow[]).map(
      (event) => event.agent_execution_run_id,
    ),
  );
  const validationsByPreparedChange = new Map<string, PassingValidationRow>();

  for (const validation of (validationResult.data ?? []) as PassingValidationRow[]) {
    if (!changedFilesWereVerified(validation.source_integrity)) continue;
    if (!validationsByPreparedChange.has(validation.prepared_change_id)) {
      validationsByPreparedChange.set(validation.prepared_change_id, validation);
    }
  }

  const specsById = new Map(specs.map((spec) => [spec.id, spec]));
  const evidence: AgentStepCompletionEvidence[] = [];
  const absorbed: AbsorbedStepSatisfaction[] = [];

  for (const run of runs) {
    if (!verifiedRunIds.has(run.id)) continue;

    const spec = specsById.get(run.execution_spec_id);
    const validation = validationsByPreparedChange.get(run.prepared_change_id);
    if (!spec || !validation) continue;

    /*
     * One record per step the run delivered (`build-chain-v1`).
     *
     * The four-record requirement above is evaluated **once per run**, exactly
     * as it always was — a chain does not weaken it, and a run whose validation
     * did not verify the changed files still emits nothing at all. What changes
     * is only how many steps that one verdict speaks for.
     *
     * The records share every id on purpose. One artifact, one validation,
     * several steps: the data says so by repeating the ids rather than by
     * inventing separate evidence for each member, and a reader can see the
     * difference between a chain and three independent runs.
     */
    for (const member of chainMembers(spec)) {
      evidence.push({
        executionSpecId: spec.id,
        agentExecutionRunId: run.id,
        preparedChangeId: run.prepared_change_id,
        validationRunId: validation.id,
        stepKey: member.stepKey,
        stepOrder: member.stepOrder,
      });
    }

    /*
     * And one record per step the run *covered* rather than delivered.
     *
     * Same run, same verdict, deliberately a different list. These steps were
     * never carried out on their own — the run performed the work inside its
     * own boundary on the way to its delivery — so calling them complete would
     * lose the one fact a founder may later want back: whether this analysis
     * was done as its own piece of work or folded into something larger.
     *
     * `absorbedBy` is the head, not the chain: a chain is several deliveries of
     * one run, and the step that *needed* the preparation is the one the run
     * was built for.
     */
    for (const member of absorbedMembers(spec)) {
      absorbed.push({
        executionSpecId: spec.id,
        agentExecutionRunId: run.id,
        preparedChangeId: run.prepared_change_id,
        validationRunId: validation.id,
        stepKey: member.stepKey,
        stepOrder: member.stepOrder,
        absorbedByStepKey: spec.step_key,
        absorbedByStepOrder: spec.step_order,
      });
    }
  }

  return { completion: evidence, absorbed };
}

/** The audit-trail half alone, for callers that ask only "what is finished?". */
export async function listAgentStepCompletionEvidence(
  supabase: SupabaseClient,
  params: { projectId: string; actionPlanId: string },
): Promise<AgentStepCompletionEvidence[]> {
  return (await listStepExecutionEvidence(supabase, params)).completion;
}
