import "server-only";

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuditDimensionId, Confidence } from "@/modules/business-audit/schema";
import type {
  BusinessOpportunity,
  ExecutionReadiness,
  ExecutionType,
  OpportunityCategory,
  OpportunityEffort,
  OpportunityImpact,
  OpportunitySet,
} from "./schema";

/**
 * Persistence for opportunity sets (Sprint 8 §29).
 *
 * Every query runs through the caller's client, so the browser read path is
 * always under RLS and durable execution supplies the service-role client with
 * ownership predicates of its own (ADR 0013).
 *
 * A completed set is immutable. Re-running prioritization creates a new set;
 * nothing rewrites an old one, so an opportunity a founder read yesterday
 * still says what it said.
 */

export type OpportunitySetStatus = "pending" | "analyzing" | "completed" | "failed";

export type StoredOpportunitySet = {
  id: string;
  projectId: string;
  businessAuditId: string;
  inputHash: string;
  status: OpportunitySetStatus;
  opportunityCount: number | null;
  validationNotes: string[];
  failureCode: string | null;
  engineVersion: string;
  promptVersion: string;
  rubricVersion: string;
  evidencePackVersion: string;
  provider: string;
  model: string;
  createdAt: string;
  completedAt: string | null;
  /** Populated only by the reads that join them. */
  opportunities: BusinessOpportunity[];
};

type SetRow = {
  id: string;
  project_id: string;
  business_audit_id: string;
  input_hash: string;
  status: OpportunitySetStatus;
  opportunity_count: number | null;
  validation_notes: string[] | null;
  failure_code: string | null;
  engine_version: string;
  prompt_version: string;
  rubric_version: string;
  evidence_pack_version: string;
  provider: string;
  model: string;
  created_at: string;
  completed_at: string | null;
};

type OpportunityRow = {
  id: string;
  opportunity_set_id: string;
  rank: number;
  source_conclusion_key: string | null;
  title: string;
  problem: string;
  why_now: string;
  impact: OpportunityImpact;
  effort: OpportunityEffort;
  confidence: Confidence;
  category: OpportunityCategory;
  primary_dimension: AuditDimensionId;
  secondary_dimensions: AuditDimensionId[] | null;
  evidence_ids: string[] | null;
  execution_type: ExecutionType;
  execution_readiness: ExecutionReadiness;
  dependencies: string[] | null;
};

const SET_COLUMNS =
  "id, project_id, business_audit_id, input_hash, status, opportunity_count, validation_notes, failure_code, engine_version, prompt_version, rubric_version, evidence_pack_version, provider, model, created_at, completed_at";

const OPPORTUNITY_COLUMNS =
  "id, opportunity_set_id, rank, source_conclusion_key, title, problem, why_now, impact, effort, confidence, category, primary_dimension, secondary_dimensions, evidence_ids, execution_type, execution_readiness, dependencies";

function mapSet(row: SetRow, opportunities: BusinessOpportunity[] = []): StoredOpportunitySet {
  return {
    id: row.id,
    projectId: row.project_id,
    businessAuditId: row.business_audit_id,
    inputHash: row.input_hash,
    status: row.status,
    opportunityCount: row.opportunity_count,
    validationNotes: row.validation_notes ?? [],
    failureCode: row.failure_code,
    engineVersion: row.engine_version,
    promptVersion: row.prompt_version,
    rubricVersion: row.rubric_version,
    evidencePackVersion: row.evidence_pack_version,
    provider: row.provider,
    model: row.model,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    opportunities,
  };
}

function mapOpportunity(row: OpportunityRow): BusinessOpportunity {
  return {
    id: row.id,
    rank: row.rank,
    sourceConclusionKey: row.source_conclusion_key,
    title: row.title,
    problem: row.problem,
    whyNow: row.why_now,
    impact: row.impact,
    effort: row.effort,
    confidence: row.confidence,
    category: row.category,
    primaryDimension: row.primary_dimension,
    secondaryDimensions: row.secondary_dimensions ?? [],
    evidenceIds: row.evidence_ids ?? [],
    executionType: row.execution_type,
    executionReadiness: row.execution_readiness,
    dependencies: row.dependencies ?? [],
  };
}

/**
 * The identity of a prioritization's inputs (Sprint 8 §23).
 *
 * The audit's own input hash is included, not just its id. Two audits can
 * carry the same evidence identity — a forced re-run produces exactly that —
 * and prioritizing the second when the first was already prioritized is paying
 * twice for the same answer. Including both means a genuinely new diagnosis
 * invalidates reuse while a duplicate one does not.
 *
 * Field order is fixed rather than derived from object keys, so the hash is
 * stable across refactors.
 */
export function computeOpportunityInputHash(params: {
  auditId: string;
  auditInputHash: string;
  evidencePackVersion: string;
  engineVersion: string;
  promptVersion: string;
  rubricVersion: string;
  schemaVersion: string;
  provider: string;
  model: string;
}): string {
  const canonical = JSON.stringify([
    params.auditId,
    params.auditInputHash,
    params.evidencePackVersion,
    params.engineVersion,
    params.promptVersion,
    params.rubricVersion,
    params.schemaVersion,
    params.provider,
    params.model,
  ]);
  return createHash("sha256").update(canonical).digest("hex");
}

async function loadOpportunities(
  supabase: SupabaseClient,
  setId: string,
): Promise<BusinessOpportunity[]> {
  const { data, error } = await supabase
    .from("business_opportunities")
    .select(OPPORTUNITY_COLUMNS)
    .eq("opportunity_set_id", setId)
    .order("rank", { ascending: true });

  if (error) throw error;
  return ((data ?? []) as OpportunityRow[]).map(mapOpportunity);
}

/** The set shown on the project page: the newest completed one. */
export async function getLatestCompletedOpportunitySet(
  supabase: SupabaseClient,
  projectId: string,
): Promise<StoredOpportunitySet | null> {
  const { data, error } = await supabase
    .from("opportunity_sets")
    .select(SET_COLUMNS)
    .eq("project_id", projectId)
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const row = data as SetRow;
  return mapSet(row, await loadOpportunities(supabase, row.id));
}

/** Finds an existing successful set for identical inputs (§23). */
export async function findReusableOpportunitySet(
  supabase: SupabaseClient,
  params: { projectId: string; inputHash: string },
): Promise<StoredOpportunitySet | null> {
  const { data, error } = await supabase
    .from("opportunity_sets")
    .select(SET_COLUMNS)
    .eq("project_id", params.projectId)
    .eq("input_hash", params.inputHash)
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data ? mapSet(data as SetRow) : null;
}

export async function getOpportunitySetById(
  supabase: SupabaseClient,
  setId: string,
): Promise<StoredOpportunitySet | null> {
  const { data, error } = await supabase
    .from("opportunity_sets")
    .select(SET_COLUMNS)
    .eq("id", setId)
    .maybeSingle();

  if (error) throw error;
  return data ? mapSet(data as SetRow) : null;
}

export type CreateOpportunitySetResult =
  | { ok: true; setId: string }
  | { ok: false; error: "already_running" }
  | { ok: false; error: "unknown"; message: string };

const POSTGRES_UNIQUE_VIOLATION = "23505";

/**
 * Claims a generation run. The partial unique index on in-flight rows turns a
 * double submission into a constraint violation rather than a second paid
 * call (§26).
 */
export async function createOpportunitySetRun(
  supabase: SupabaseClient,
  params: {
    projectId: string;
    businessAuditId: string;
    inputHash: string;
    schemaVersion: string;
    engineVersion: string;
    promptVersion: string;
    rubricVersion: string;
    evidencePackVersion: string;
    provider: string;
    model: string;
  },
): Promise<CreateOpportunitySetResult> {
  const { data, error } = await supabase
    .from("opportunity_sets")
    .insert({
      project_id: params.projectId,
      business_audit_id: params.businessAuditId,
      input_hash: params.inputHash,
      schema_version: params.schemaVersion,
      engine_version: params.engineVersion,
      prompt_version: params.promptVersion,
      rubric_version: params.rubricVersion,
      evidence_pack_version: params.evidencePackVersion,
      provider: params.provider,
      model: params.model,
      status: "analyzing",
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === POSTGRES_UNIQUE_VIOLATION) return { ok: false, error: "already_running" };
    return { ok: false, error: "unknown", message: error.message };
  }

  return { ok: true, setId: data.id };
}

/**
 * Writes the opportunities and completes the set.
 *
 * The rows go in first: a set marked completed with no contents would be a
 * lie the UI has no way to detect, whereas orphaned rows under a set that
 * never completed are invisible to every read path here.
 */
export async function completeOpportunitySetRun(
  supabase: SupabaseClient,
  setId: string,
  set: OpportunitySet,
): Promise<void> {
  const { error: insertError } = await supabase.from("business_opportunities").insert(
    set.opportunities.map((opportunity) => ({
      opportunity_set_id: setId,
      rank: opportunity.rank,
      // The canonical Move → Conclusion relationship (CORE-2b FIX §1, §3).
      source_conclusion_key: opportunity.sourceConclusionKey,
      title: opportunity.title,
      problem: opportunity.problem,
      why_now: opportunity.whyNow,
      impact: opportunity.impact,
      effort: opportunity.effort,
      confidence: opportunity.confidence,
      category: opportunity.category,
      primary_dimension: opportunity.primaryDimension,
      secondary_dimensions: opportunity.secondaryDimensions,
      evidence_ids: opportunity.evidenceIds,
      execution_type: opportunity.executionType,
      execution_readiness: opportunity.executionReadiness,
      dependencies: opportunity.dependencies,
    })),
  );

  if (insertError) throw insertError;

  const { error } = await supabase
    .from("opportunity_sets")
    .update({
      status: "completed",
      opportunity_count: set.opportunities.length,
      validation_notes: set.validationNotes,
      completed_at: new Date().toISOString(),
    })
    .eq("id", setId);

  if (error) throw error;
}

/** Marks a run failed with a typed code only — never provider prose. */
export async function failOpportunitySetRun(
  supabase: SupabaseClient,
  setId: string,
  failureCode: string,
): Promise<void> {
  const { error } = await supabase
    .from("opportunity_sets")
    .update({
      status: "failed",
      failure_code: failureCode,
      completed_at: new Date().toISOString(),
    })
    .eq("id", setId);

  if (error) {
    console.error("[opportunities] failed to record run failure", { setId });
  }
}
