import "server-only";

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BusinessLens } from "@/modules/business-audit/schema";
import type { ExecutionCapability } from "@/modules/execution/schema";
import type { PlanValidationFinding } from "./validate";
import type {
  ActionPlan,
  ActionPlanStatus,
  ActionPlanStep,
  ExecutionSupport,
  StepActor,
  StepChangeKind,
} from "./schema";

/**
 * Persistence for Action Plans (CORE-2b §51, §52, §53, §54).
 *
 * Normalized rather than one JSONB blob, for the reason the Opportunity Engine
 * was: a plan step is a row a user will eventually act on individually, so it
 * gets an identity now rather than after something depends on it.
 *
 * Every query runs through the caller's client, so the browser read path is
 * always under RLS, and durable execution supplies the service-role client with
 * ownership predicates taken from the persisted operation row (ADR 0013,
 * Rule 53).
 *
 * A completed plan is immutable. Replanning creates a new plan and marks the
 * previous one `superseded`; nothing rewrites one, so a plan a founder read
 * yesterday still says what it said (§43).
 *
 * Deliberately absent: prompt text, model responses, reasoning, raw evidence,
 * repository paths, refs or code.
 */

export type StoredActionPlanStep = ActionPlanStep;

export type StoredActionPlan = {
  id: string;
  projectId: string;
  businessAuditId: string;
  opportunitySetId: string;
  /** The Move within that set. The engine's own id, not a database row id. */
  opportunityId: string;
  inputHash: string;
  status: ActionPlanStatus;

  goal: string | null;
  whyNow: string | null;
  expectedOutcome: string | null;
  addressesRootProblem: string | null;
  assumptions: string[];
  /** The internal root problem this plan was built to solve (§37). */
  rootProblem: string | null;
  lenses: BusinessLens[];

  stepCount: number | null;
  validationNotes: string[];
  validationFindings: PlanValidationFinding[];
  failureCode: string | null;

  contractVersion: string;
  plannerVersion: string;
  promptVersion: string;
  rubricVersion: string;
  evidencePackVersion: string;
  provider: string;
  model: string;

  /** The understanding and stated intent this plan reasoned from (§42). */
  productProfileId: string;
  founderIntentHash: string;

  createdAt: string;
  completedAt: string | null;
  /** Populated only by the reads that join them. */
  steps: StoredActionPlanStep[];
};

type PlanRow = {
  id: string;
  project_id: string;
  business_audit_id: string;
  opportunity_set_id: string;
  opportunity_id: string;
  input_hash: string;
  status: ActionPlanStatus;
  goal: string | null;
  why_now: string | null;
  expected_outcome: string | null;
  addresses_root_problem: string | null;
  assumptions: string[] | null;
  root_problem: string | null;
  lenses: BusinessLens[] | null;
  step_count: number | null;
  validation_notes: string[] | null;
  validation_findings: PlanValidationFinding[] | null;
  failure_code: string | null;
  contract_version: string;
  planner_version: string;
  prompt_version: string;
  rubric_version: string;
  evidence_pack_version: string;
  provider: string;
  model: string;
  product_profile_id: string;
  founder_intent_hash: string;
  created_at: string;
  completed_at: string | null;
};

type StepRow = {
  id: string;
  action_plan_id: string;
  step_key: string;
  step_order: number;
  title: string;
  description: string;
  purpose: string;
  actor: StepActor;
  change_kind: StepChangeKind;
  completion_criteria: string;
  depends_on: number[] | null;
  evidence_ids: string[] | null;
  execution_support: ExecutionSupport;
  capability: ExecutionCapability | null;
  requires_approval: boolean;
};

const PLAN_COLUMNS =
  "id, project_id, business_audit_id, opportunity_set_id, opportunity_id, input_hash, status, goal, why_now, expected_outcome, addresses_root_problem, assumptions, root_problem, lenses, step_count, validation_notes, validation_findings, failure_code, contract_version, planner_version, prompt_version, rubric_version, evidence_pack_version, provider, model, product_profile_id, founder_intent_hash, created_at, completed_at";

const STEP_COLUMNS =
  "id, action_plan_id, step_key, step_order, title, description, purpose, actor, change_kind, completion_criteria, depends_on, evidence_ids, execution_support, capability, requires_approval";

function mapPlan(row: PlanRow, steps: StoredActionPlanStep[] = []): StoredActionPlan {
  return {
    id: row.id,
    projectId: row.project_id,
    businessAuditId: row.business_audit_id,
    opportunitySetId: row.opportunity_set_id,
    opportunityId: row.opportunity_id,
    inputHash: row.input_hash,
    status: row.status,
    goal: row.goal,
    whyNow: row.why_now,
    expectedOutcome: row.expected_outcome,
    addressesRootProblem: row.addresses_root_problem,
    assumptions: row.assumptions ?? [],
    rootProblem: row.root_problem,
    lenses: row.lenses ?? [],
    stepCount: row.step_count,
    validationNotes: row.validation_notes ?? [],
    validationFindings: row.validation_findings ?? [],
    failureCode: row.failure_code,
    contractVersion: row.contract_version,
    plannerVersion: row.planner_version,
    promptVersion: row.prompt_version,
    rubricVersion: row.rubric_version,
    evidencePackVersion: row.evidence_pack_version,
    provider: row.provider,
    model: row.model,
    productProfileId: row.product_profile_id,
    founderIntentHash: row.founder_intent_hash,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    steps,
  };
}

function mapStep(row: StepRow): StoredActionPlanStep {
  return {
    id: row.step_key,
    order: row.step_order,
    title: row.title,
    description: row.description,
    purpose: row.purpose,
    actor: row.actor,
    changeKind: row.change_kind,
    completionCriteria: row.completion_criteria,
    dependsOn: row.depends_on ?? [],
    evidenceIds: row.evidence_ids ?? [],
    executionSupport: row.execution_support,
    capability: row.capability,
    requiresApproval: row.requires_approval,
  };
}

/**
 * The identity of a plan's inputs (§53).
 *
 * Everything that could change what the plan should say. The audit's own input
 * hash rides along with its id for the reason the Opportunity Engine records:
 * two audits can carry the same evidence identity, and planning the second when
 * the first was already planned is paying twice for one answer.
 *
 * The Move id is in here, so planning a *different* Move from the same audit is
 * correctly a different plan rather than a reuse. So are the product profile and
 * the founder intent hash, which is what makes §89 and §90 work: telling Vibe
 * something new about the business genuinely changes what the plan should be.
 *
 * Field order is fixed rather than derived from object keys, so the hash is
 * stable across refactors.
 */
export function computeActionPlanInputHash(params: {
  auditId: string;
  auditInputHash: string;
  opportunitySetId: string;
  opportunityId: string;
  productProfileId: string;
  founderIntentHash: string;
  evidencePackVersion: string;
  contractVersion: string;
  plannerVersion: string;
  promptVersion: string;
  rubricVersion: string;
  schemaVersion: string;
  provider: string;
  model: string;
}): string {
  const canonical = JSON.stringify([
    params.auditId,
    params.auditInputHash,
    params.opportunitySetId,
    params.opportunityId,
    params.productProfileId,
    params.founderIntentHash,
    params.evidencePackVersion,
    params.contractVersion,
    params.plannerVersion,
    params.promptVersion,
    params.rubricVersion,
    params.schemaVersion,
    params.provider,
    params.model,
  ]);
  return createHash("sha256").update(canonical).digest("hex");
}

async function loadSteps(
  supabase: SupabaseClient,
  planId: string,
): Promise<StoredActionPlanStep[]> {
  const { data, error } = await supabase
    .from("action_plan_steps")
    .select(STEP_COLUMNS)
    .eq("action_plan_id", planId)
    .order("step_order", { ascending: true });

  if (error) throw error;
  return ((data ?? []) as StepRow[]).map(mapStep);
}

/** The plan a project page shows: the newest completed one, with its steps. */
export async function getLatestCompletedActionPlan(
  supabase: SupabaseClient,
  projectId: string,
): Promise<StoredActionPlan | null> {
  const { data, error } = await supabase
    .from("action_plans")
    .select(PLAN_COLUMNS)
    .eq("project_id", projectId)
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const row = data as PlanRow;
  return mapPlan(row, await loadSteps(supabase, row.id));
}

/** Finds an existing successful plan for identical inputs (§53, §86). */
export async function findReusableActionPlan(
  supabase: SupabaseClient,
  params: { projectId: string; inputHash: string },
): Promise<StoredActionPlan | null> {
  const { data, error } = await supabase
    .from("action_plans")
    .select(PLAN_COLUMNS)
    .eq("project_id", params.projectId)
    .eq("input_hash", params.inputHash)
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data ? mapPlan(data as PlanRow) : null;
}

export async function getActionPlanById(
  supabase: SupabaseClient,
  planId: string,
): Promise<StoredActionPlan | null> {
  const { data, error } = await supabase
    .from("action_plans")
    .select(PLAN_COLUMNS)
    .eq("id", planId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const row = data as PlanRow;
  return mapPlan(row, await loadSteps(supabase, row.id));
}

/** Every plan for a project, newest first. History is kept, never destroyed (§43). */
export async function listActionPlans(
  supabase: SupabaseClient,
  projectId: string,
): Promise<StoredActionPlan[]> {
  const { data, error } = await supabase
    .from("action_plans")
    .select(PLAN_COLUMNS)
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return ((data ?? []) as PlanRow[]).map((row) => mapPlan(row));
}

export type CreateActionPlanResult =
  | { ok: true; planId: string }
  | { ok: false; error: "already_running" }
  | { ok: false; error: "unknown"; message: string };

const POSTGRES_UNIQUE_VIOLATION = "23505";

/**
 * Claims a planning run.
 *
 * The partial unique index on in-flight rows turns a double submission into a
 * constraint violation rather than a second paid call (§54). The database is
 * where this is enforced, not the application: two simultaneous requests can
 * both pass an application check, and only one can win an index.
 */
export async function createActionPlanRun(
  supabase: SupabaseClient,
  params: {
    projectId: string;
    businessAuditId: string;
    opportunitySetId: string;
    opportunityId: string;
    inputHash: string;
    rootProblem: string | null;
    lenses: BusinessLens[];
    productProfileId: string;
    founderIntentHash: string;
    schemaVersion: string;
    contractVersion: string;
    plannerVersion: string;
    promptVersion: string;
    rubricVersion: string;
    evidencePackVersion: string;
    provider: string;
    model: string;
  },
): Promise<CreateActionPlanResult> {
  const { data, error } = await supabase
    .from("action_plans")
    .insert({
      project_id: params.projectId,
      business_audit_id: params.businessAuditId,
      opportunity_set_id: params.opportunitySetId,
      opportunity_id: params.opportunityId,
      input_hash: params.inputHash,
      root_problem: params.rootProblem,
      lenses: params.lenses,
      product_profile_id: params.productProfileId,
      founder_intent_hash: params.founderIntentHash,
      schema_version: params.schemaVersion,
      contract_version: params.contractVersion,
      planner_version: params.plannerVersion,
      prompt_version: params.promptVersion,
      rubric_version: params.rubricVersion,
      evidence_pack_version: params.evidencePackVersion,
      provider: params.provider,
      model: params.model,
      status: "planning",
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === POSTGRES_UNIQUE_VIOLATION) return { ok: false, error: "already_running" };
    return { ok: false, error: "unknown", message: error.message };
  }

  return { ok: true, planId: data.id };
}

/**
 * Writes the steps, completes the plan, and supersedes the previous one.
 *
 * Order matters. The steps go in first: a plan marked completed with no steps
 * would be a lie the UI has no way to detect, whereas orphaned steps under a
 * plan that never completed are invisible to every read path here.
 *
 * Superseding happens last and is deliberately not a delete (§43). The older
 * plan keeps its steps, its provenance and its cost record — a founder who
 * acted on it can still see what it said.
 */
export async function completeActionPlanRun(
  supabase: SupabaseClient,
  planId: string,
  plan: ActionPlan,
  findings: PlanValidationFinding[],
): Promise<void> {
  const { error: insertError } = await supabase.from("action_plan_steps").insert(
    plan.steps.map((step) => ({
      action_plan_id: planId,
      step_key: step.id,
      step_order: step.order,
      title: step.title,
      description: step.description,
      purpose: step.purpose,
      actor: step.actor,
      change_kind: step.changeKind,
      completion_criteria: step.completionCriteria,
      depends_on: step.dependsOn,
      evidence_ids: step.evidenceIds,
      execution_support: step.executionSupport,
      capability: step.capability,
      requires_approval: step.requiresApproval,
    })),
  );

  if (insertError) throw insertError;

  const { data, error } = await supabase
    .from("action_plans")
    .update({
      status: "completed",
      goal: plan.goal,
      why_now: plan.whyNow,
      expected_outcome: plan.expectedOutcome,
      addresses_root_problem: plan.addressesRootProblem,
      assumptions: plan.assumptions,
      step_count: plan.steps.length,
      validation_notes: plan.validationNotes,
      validation_findings: findings,
      completed_at: new Date().toISOString(),
    })
    .eq("id", planId)
    .select("project_id")
    .single();

  if (error) throw error;

  await supersedeOtherPlans(supabase, {
    projectId: (data as { project_id: string }).project_id,
    keepPlanId: planId,
  });
}

/** Marks every other completed plan for the project superseded (§43, §44). */
export async function supersedeOtherPlans(
  supabase: SupabaseClient,
  params: { projectId: string; keepPlanId: string },
): Promise<void> {
  const { error } = await supabase
    .from("action_plans")
    .update({ status: "superseded" })
    .eq("project_id", params.projectId)
    .eq("status", "completed")
    .neq("id", params.keepPlanId);

  if (error) {
    // Not fatal to the plan that was just written: the read path takes the
    // newest completed plan, so a failure here leaves a stale row labelled
    // `completed` rather than losing anything.
    console.error("[action-plans] failed to supersede previous plans", params);
  }
}

/** Marks a run failed with a typed code only — never provider prose. */
export async function failActionPlanRun(
  supabase: SupabaseClient,
  planId: string,
  failureCode: string,
): Promise<void> {
  const { error } = await supabase
    .from("action_plans")
    .update({
      status: "failed",
      failure_code: failureCode,
      completed_at: new Date().toISOString(),
    })
    .eq("id", planId);

  if (error) {
    console.error("[action-plans] failed to record run failure", { planId });
  }
}
