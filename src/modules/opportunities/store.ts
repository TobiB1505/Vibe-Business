import "server-only";

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BusinessLens, Confidence } from "@/modules/business-audit/schema";
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
  /** Null on rows stored before business-opportunity.v3 (dimension-attributed). */
  primary_lens: BusinessLens | null;
  secondary_lenses: BusinessLens[] | null;
  evidence_ids: string[] | null;
  execution_type: ExecutionType;
  execution_readiness: ExecutionReadiness;
  dependencies: string[] | null;
};

const SET_COLUMNS =
  "id, project_id, business_audit_id, input_hash, status, opportunity_count, validation_notes, failure_code, engine_version, prompt_version, rubric_version, evidence_pack_version, provider, model, created_at, completed_at";

const OPPORTUNITY_COLUMNS =
  "id, opportunity_set_id, rank, source_conclusion_key, title, problem, why_now, impact, effort, confidence, category, primary_lens, secondary_lenses, evidence_ids, execution_type, execution_readiness, dependencies";

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
    primaryLens: row.primary_lens,
    secondaryLenses: row.secondary_lenses ?? [],
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

/**
 * One Move, by its own id within its set (UI-5 dogfood).
 *
 * Both halves of the key are used deliberately. An opportunity id is only
 * stable *within* a set — it is derived from category and rank — so reading by
 * id alone would be a lookup that silently matches the wrong Move as soon as a
 * second set exists. A prepared change stores both, which is why it can ask
 * this question at all.
 *
 * RLS scopes the row to its owner; this adds no filter of its own for the same
 * reason `getOpportunitySetById` does not.
 */
export async function getOpportunityById(
  supabase: SupabaseClient,
  params: { setId: string; opportunityId: string },
): Promise<BusinessOpportunity | null> {
  const { data, error } = await supabase
    .from("business_opportunities")
    .select(OPPORTUNITY_COLUMNS)
    .eq("opportunity_set_id", params.setId)
    .eq("id", params.opportunityId)
    .maybeSingle();

  if (error) throw error;
  return data ? mapOpportunity(data as OpportunityRow) : null;
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

/**
 * One set by id, **with its Moves**.
 *
 * `getOpportunitySetById` deliberately does not join them — both of its
 * callers only need the row's status — and `mapSet` then defaults
 * `opportunities` to `[]`. That default is a silent trap for anything that
 * does need them: no error, no empty result, just a set that appears to have
 * no Moves. It cost the `move_recommendation` voice slot a live run.
 *
 * Named separately rather than by adding a join to the existing read, so a
 * caller that wants the Moves has to say so and a caller that does not keeps
 * paying for one query instead of two.
 */
export async function getOpportunitySetWithMoves(
  supabase: SupabaseClient,
  setId: string,
): Promise<StoredOpportunitySet | null> {
  const set = await getOpportunitySetById(supabase, setId);
  if (set === null) return null;

  return { ...set, opportunities: await loadOpportunities(supabase, setId) };
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
      // The retired dimension columns are left to their defaults: null and
      // '[]'. They carry attribution only on rows written before v3.
      primary_lens: opportunity.primaryLens,
      secondary_lenses: opportunity.secondaryLenses,
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
