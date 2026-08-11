import "server-only";

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BusinessReadinessAudit } from "./schema";

/**
 * Persistence for business readiness audits.
 *
 * Every query runs through the caller's request-scoped Supabase client, so
 * RLS is always in force — there is no service-role path here.
 */

export type AuditStatus = "pending" | "analyzing" | "completed" | "failed";

export type StoredAudit = {
  id: string;
  projectId: string;
  status: AuditStatus;
  inputHash: string;
  overallScore: number | null;
  assessedDimensions: number | null;
  totalDimensions: number | null;
  failureCode: string | null;
  result: BusinessReadinessAudit | null;
  createdAt: string;
  completedAt: string | null;
};

type AuditRow = {
  id: string;
  project_id: string;
  status: AuditStatus;
  input_hash: string;
  overall_score: number | null;
  assessed_dimensions: number | null;
  total_dimensions: number | null;
  failure_code: string | null;
  result: BusinessReadinessAudit | null;
  created_at: string;
  completed_at: string | null;
};

const AUDIT_COLUMNS =
  "id, project_id, status, input_hash, overall_score, assessed_dimensions, total_dimensions, failure_code, result, created_at, completed_at";

function mapRow(row: AuditRow): StoredAudit {
  return {
    id: row.id,
    projectId: row.project_id,
    status: row.status,
    inputHash: row.input_hash,
    overallScore: row.overall_score,
    assessedDimensions: row.assessed_dimensions,
    totalDimensions: row.total_dimensions,
    failureCode: row.failure_code,
    result: row.result,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

/**
 * The identity of an audit's inputs (Sprint 4 §23).
 *
 * Every input that can change the answer is included: the evidence
 * snapshots, the founder's context, and the full reproducibility set
 * (prompt, rubric, model, versions). Change any one and the hash changes,
 * which correctly invalidates reuse and buys a fresh audit. Change nothing
 * and the existing audit is returned for free.
 *
 * `authenticatedSnapshotId` is part of that identity and `null` is a real
 * value, not a missing one (Sprint 6 §7). An audit run before any Deep Scan
 * and an audit run after one saw different evidence, so they must not share a
 * hash — otherwise the first Deep Scan would silently return the stale
 * pre-Deep-Scan audit and the user would never see their new evidence used.
 *
 * Field order is fixed rather than derived from object keys, so the hash is
 * stable across refactors.
 */
export function computeAuditInputHash(params: {
  repositorySnapshotId: string;
  liveSnapshotId: string;
  businessContextHash: string;
  /** The latest successful Deep Scan snapshot, or null when none exists. */
  authenticatedSnapshotId: string | null;
  schemaVersion: string;
  auditVersion: string;
  evidencePackVersion: string;
  promptVersion: string;
  rubricVersion: string;
  provider: string;
  model: string;
}): string {
  const canonical = JSON.stringify([
    params.repositorySnapshotId,
    params.liveSnapshotId,
    params.businessContextHash,
    // `null` is carried through as JSON null rather than mapped to a sentinel
    // string: JSON keeps null distinct from every possible id, so "no Deep
    // Scan" can never be forged by a snapshot whose id happens to match.
    params.authenticatedSnapshotId,
    params.schemaVersion,
    params.auditVersion,
    params.evidencePackVersion,
    params.promptVersion,
    params.rubricVersion,
    params.provider,
    params.model,
  ]);
  return createHash("sha256").update(canonical).digest("hex");
}

/** The audit shown on the project page: the newest successful run. */
export async function getLatestSuccessfulAudit(
  supabase: SupabaseClient,
  projectId: string,
): Promise<StoredAudit | null> {
  const { data, error } = await supabase
    .from("business_readiness_audits")
    .select(AUDIT_COLUMNS)
    .eq("project_id", projectId)
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data ? mapRow(data as AuditRow) : null;
}

/**
 * Finds an existing successful audit for identical inputs. Reuse is the
 * default because inference costs real money and an identical input
 * provably yields an equivalent answer (Sprint 4 §23).
 */
export async function findReusableAudit(
  supabase: SupabaseClient,
  params: { projectId: string; inputHash: string },
): Promise<StoredAudit | null> {
  const { data, error } = await supabase
    .from("business_readiness_audits")
    .select(AUDIT_COLUMNS)
    .eq("project_id", params.projectId)
    .eq("input_hash", params.inputHash)
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data ? mapRow(data as AuditRow) : null;
}

export type CreateAuditRunResult =
  | { ok: true; auditId: string }
  | { ok: false; error: "already_running" }
  | { ok: false; error: "unknown"; message: string };

const POSTGRES_UNIQUE_VIOLATION = "23505";

/**
 * Claims an audit run. The partial unique index on in-flight rows turns a
 * double submission into a unique-constraint violation, reported as
 * `already_running` — so a user cannot accidentally buy two identical
 * inference calls by clicking twice (Sprint 4 §24).
 */
export async function createAuditRun(
  supabase: SupabaseClient,
  params: {
    projectId: string;
    repositorySnapshotId: string;
    liveSnapshotId: string;
    businessContextHash: string;
    inputHash: string;
    schemaVersion: string;
    auditVersion: string;
    evidencePackVersion: string;
    promptVersion: string;
    rubricVersion: string;
    provider: string;
    model: string;
  },
): Promise<CreateAuditRunResult> {
  const { data, error } = await supabase
    .from("business_readiness_audits")
    .insert({
      project_id: params.projectId,
      repository_snapshot_id: params.repositorySnapshotId,
      live_snapshot_id: params.liveSnapshotId,
      business_context_hash: params.businessContextHash,
      input_hash: params.inputHash,
      schema_version: params.schemaVersion,
      audit_version: params.auditVersion,
      evidence_pack_version: params.evidencePackVersion,
      prompt_version: params.promptVersion,
      rubric_version: params.rubricVersion,
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

  return { ok: true, auditId: data.id };
}

export async function completeAuditRun(
  supabase: SupabaseClient,
  auditId: string,
  audit: BusinessReadinessAudit,
): Promise<void> {
  const { error } = await supabase
    .from("business_readiness_audits")
    .update({
      status: "completed",
      result: audit,
      overall_score: audit.overall.score,
      assessed_dimensions: audit.overall.assessedDimensions,
      total_dimensions: audit.overall.totalDimensions,
      completed_at: new Date().toISOString(),
    })
    .eq("id", auditId);

  if (error) throw error;
}

/**
 * Marks a run failed with a typed code only. A failed row never carries a
 * `result`, so it cannot displace the latest successful audit the user sees
 * (Sprint 4 §27).
 */
export async function failAuditRun(
  supabase: SupabaseClient,
  auditId: string,
  failureCode: string,
): Promise<void> {
  const { error } = await supabase
    .from("business_readiness_audits")
    .update({
      status: "failed",
      failure_code: failureCode,
      completed_at: new Date().toISOString(),
    })
    .eq("id", auditId);

  if (error) {
    console.error("[business-audit] failed to record run failure", { auditId });
  }
}
