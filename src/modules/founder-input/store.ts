import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActionPlanStep } from "@/modules/action-plans/schema";
import type {
  FounderInputKind,
  FounderInputOption,
  FounderInputRequest,
  FounderInputRequestOrigin,
  FounderInputRequestStatus,
  FounderInputResolution,
  FounderInputResponseSource,
  FounderInputResponseType,
} from "./schema";

type RequestRow = {
  id: string;
  project_id: string;
  action_plan_id: string | null;
  action_plan_step_key: string | null;
  execution_interrupt_id: string | null;
  origin: FounderInputRequestOrigin;
  input_kind: FounderInputKind;
  subject_key: string;
  question: string;
  why_needed: string;
  response_type: FounderInputResponseType;
  recommendation: FounderInputOption | null;
  alternatives: FounderInputOption[] | null;
  allow_custom: boolean;
  context_hash: string;
  status: FounderInputRequestStatus;
  created_at: string;
  resolved_at: string | null;
};

type ResolutionRow = {
  id: string;
  project_id: string;
  request_id: string;
  input_kind: FounderInputKind;
  subject_key: string;
  response_source: FounderInputResponseSource;
  selected_option_id: string | null;
  raw_answer: string | null;
  resolved_statement: string;
  context_hash: string;
  supersedes_resolution_id: string | null;
  superseded_at: string | null;
  created_at: string;
};

const REQUEST_COLUMNS =
  "id, project_id, action_plan_id, action_plan_step_key, execution_interrupt_id, origin, input_kind, subject_key, question, why_needed, response_type, recommendation, alternatives, allow_custom, context_hash, status, created_at, resolved_at";
const RESOLUTION_COLUMNS =
  "id, project_id, request_id, input_kind, subject_key, response_source, selected_option_id, raw_answer, resolved_statement, context_hash, supersedes_resolution_id, superseded_at, created_at";
const POSTGRES_UNIQUE_VIOLATION = "23505";

function mapRequest(row: RequestRow): FounderInputRequest {
  return {
    id: row.id,
    projectId: row.project_id,
    actionPlanId: row.action_plan_id,
    actionPlanStepKey: row.action_plan_step_key,
    executionInterruptId: row.execution_interrupt_id,
    origin: row.origin,
    kind: row.input_kind,
    subjectKey: row.subject_key,
    question: row.question,
    whyNeeded: row.why_needed,
    responseType: row.response_type,
    recommendation: row.recommendation,
    alternatives: row.alternatives ?? [],
    allowCustom: row.allow_custom,
    contextHash: row.context_hash,
    status: row.status,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  };
}

function mapResolution(row: ResolutionRow): FounderInputResolution {
  return {
    id: row.id,
    projectId: row.project_id,
    requestId: row.request_id,
    kind: row.input_kind,
    subjectKey: row.subject_key,
    responseSource: row.response_source,
    selectedOptionId: row.selected_option_id,
    rawAnswer: row.raw_answer,
    resolvedStatement: row.resolved_statement,
    contextHash: row.context_hash,
    supersedesResolutionId: row.supersedes_resolution_id,
    supersededAt: row.superseded_at,
    createdAt: row.created_at,
  };
}

export async function listActiveFounderResolutions(
  supabase: SupabaseClient,
  projectId: string,
): Promise<FounderInputResolution[]> {
  const { data, error } = await supabase
    .from("project_founder_resolutions")
    .select(RESOLUTION_COLUMNS)
    .eq("project_id", projectId)
    .is("superseded_at", null)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as ResolutionRow[]).map(mapResolution);
}

export async function listFounderInputRequestsForPlan(
  supabase: SupabaseClient,
  planId: string,
): Promise<FounderInputRequest[]> {
  const { data, error } = await supabase
    .from("project_founder_input_requests")
    .select(REQUEST_COLUMNS)
    .eq("action_plan_id", planId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as RequestRow[]).map(mapRequest);
}

/**
 * Materializes planner-known requirements after the immutable plan steps exist.
 * Older open requests are superseded first, and existing active project
 * resolutions prevent a duplicate question from being created.
 */
export async function createPlannerFounderInputRequests(
  supabase: SupabaseClient,
  params: {
    projectId: string;
    planId: string;
    contextHash: string;
    steps: readonly ActionPlanStep[];
  },
): Promise<void> {
  const requirements = params.steps
    .filter((step) => step.founderInputRequirement !== null)
    .map((step) => ({ step, requirement: step.founderInputRequirement! }));
  if (requirements.length === 0) return;

  const active = await listActiveFounderResolutions(supabase, params.projectId);
  const unresolved = requirements.filter(
    ({ requirement }) =>
      !active.some(
        (resolution) =>
          resolution.kind === requirement.kind &&
          resolution.subjectKey === requirement.subjectKey,
      ),
  );
  if (unresolved.length === 0) return;

  const { error: supersedeError } = await supabase
    .from("project_founder_input_requests")
    .update({ status: "superseded" })
    .eq("project_id", params.projectId)
    .eq("origin", "planner")
    .eq("status", "open")
    .neq("action_plan_id", params.planId);
  if (supersedeError) throw supersedeError;

  for (const { step, requirement } of unresolved) {
    const { error } = await supabase.from("project_founder_input_requests").insert({
      project_id: params.projectId,
      action_plan_id: params.planId,
      action_plan_step_key: step.id,
      execution_interrupt_id: null,
      origin: "planner",
      input_kind: requirement.kind,
      subject_key: requirement.subjectKey,
      question: requirement.question,
      why_needed: requirement.whyNeeded,
      response_type: requirement.responseType,
      recommendation: requirement.recommendation,
      alternatives: requirement.alternatives,
      allow_custom: requirement.allowCustom,
      context_hash: params.contextHash,
      status: "open",
    });
    if (!error) continue;
    if (error.code !== POSTGRES_UNIQUE_VIOLATION) throw error;

    // A concurrent caller may have materialized the same semantic request.
    // The partial unique index is the authority; seeing its canonical open row
    // turns the losing insert into a successful idempotent replay.
    const { data: canonical, error: readError } = await supabase
      .from("project_founder_input_requests")
      .select("id")
      .eq("project_id", params.projectId)
      .eq("input_kind", requirement.kind)
      .eq("subject_key", requirement.subjectKey)
      .eq("status", "open")
      .maybeSingle();
    if (readError) throw readError;
    if (!canonical) throw error;
  }
}

export async function getFounderInputRequest(
  supabase: SupabaseClient,
  requestId: string,
): Promise<FounderInputRequest | null> {
  const { data, error } = await supabase
    .from("project_founder_input_requests")
    .select(REQUEST_COLUMNS)
    .eq("id", requestId)
    .maybeSingle();
  if (error) throw error;
  return data ? mapRequest(data as RequestRow) : null;
}

export async function getFounderInputRequestForInterrupt(
  supabase: SupabaseClient,
  params: { projectId: string; executionInterruptId: string },
): Promise<FounderInputRequest | null> {
  const { data: interrupt, error: interruptError } = await supabase
    .from("execution_interrupts")
    .select("founder_input_request_id")
    .eq("id", params.executionInterruptId)
    .eq("project_id", params.projectId)
    .maybeSingle();
  if (interruptError) throw interruptError;
  const requestId = (interrupt as { founder_input_request_id?: string | null } | null)
    ?.founder_input_request_id;
  if (!requestId) return null;

  const { data, error } = await supabase
    .from("project_founder_input_requests")
    .select(REQUEST_COLUMNS)
    .eq("project_id", params.projectId)
    .eq("id", requestId)
    .maybeSingle();
  if (error) throw error;
  return data ? mapRequest(data as RequestRow) : null;
}

export async function callResolveFounderInputRequest(
  supabase: SupabaseClient,
  params: {
    requestId: string;
    userId: string;
    source: FounderInputResponseSource;
    selectedOptionId: string | null;
    rawAnswer: string | null;
    expectedContextHash: string;
  },
): Promise<string> {
  const { data, error } = await supabase.rpc("resolve_founder_input_request", {
    p_request_id: params.requestId,
    p_user_id: params.userId,
    p_response_source: params.source,
    p_selected_option_id: params.selectedOptionId,
    p_raw_answer: params.rawAnswer,
    p_expected_context_hash: params.expectedContextHash,
  });
  if (error) throw error;
  if (typeof data !== "string") throw new Error("Founder input resolution returned no id.");
  return data;
}
