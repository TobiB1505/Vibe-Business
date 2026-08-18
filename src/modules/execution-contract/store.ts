import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExecutionCapability } from "@/modules/execution/schema";
import type { CreditUnits } from "@/modules/credits/units";
import { creditUnits } from "@/modules/credits/units";
import type { ExecutionSpec } from "./spec";
import type { ExecutionClass, ExecutionMode, ExecutionRiskClass } from "./schema";

/**
 * Persistence for ExecutionSpecs (EXECUTION CORE-3 §10, §55).
 *
 * ## Why only one table
 *
 * §55 asks for the smallest schema that is actually needed, and the answer is
 * one table. A spec is the only concept here that requires an *immutable
 * historical identity*: everything else is either derivable (a resolution is a
 * pure function of the plan, the snapshot and live state, recomputed in
 * milliseconds) or has no writer yet.
 *
 * `ExecutionInterrupt` and the activity-event contract are deliberately not
 * persisted. Nothing raises an interrupt and nothing emits an activity event,
 * because no agent exists — and a table with no writer is the speculative
 * infrastructure CLAUDE.md rule 15 and ADR 0007 both refuse. Core-4 adds them
 * alongside the code that fills them.
 *
 * ## Immutability
 *
 * There is no update function and no delete function in this file, and the
 * table rejects both at the database level. A spec whose premise moved is
 * replaced by a new spec with a new identity, never edited (§10).
 */

const SPEC_COLUMNS =
  "id, project_id, action_plan_id, step_key, step_order, business_audit_id, opportunity_id, spec_identity, mode, execution_class, risk_class, repository_connection_id, base_sha, repository_snapshot_id, capability, capability_version, credit_quote_id, max_authorized_credits, spec, schema_version, resolver_version, policy_version, risk_policy_version, created_at";

type SpecRow = {
  id: string;
  project_id: string;
  action_plan_id: string;
  step_key: string;
  step_order: number;
  business_audit_id: string;
  opportunity_id: string;
  spec_identity: string;
  mode: ExecutionMode;
  execution_class: ExecutionClass | null;
  risk_class: ExecutionRiskClass;
  repository_connection_id: string;
  base_sha: string;
  repository_snapshot_id: string;
  capability: ExecutionCapability | null;
  capability_version: string | null;
  credit_quote_id: string | null;
  max_authorized_credits: number | null;
  spec: ExecutionSpec;
  schema_version: string;
  resolver_version: string;
  policy_version: string;
  risk_policy_version: string;
  created_at: string;
};

export type StoredExecutionSpec = {
  id: string;
  projectId: string;
  actionPlanId: string;
  stepKey: string;
  stepOrder: number;
  businessAuditId: string;
  opportunityId: string;
  specIdentity: string;
  mode: ExecutionMode;
  executionClass: ExecutionClass | null;
  riskClass: ExecutionRiskClass;
  repositoryConnectionId: string;
  baseSha: string;
  repositorySnapshotId: string;
  capability: ExecutionCapability | null;
  capabilityVersion: string | null;
  creditQuoteId: string | null;
  maxAuthorizedCredits: CreditUnits | null;
  /** The immutable document. */
  spec: ExecutionSpec;
  schemaVersion: string;
  resolverVersion: string;
  policyVersion: string;
  riskPolicyVersion: string;
  createdAt: string;
};

function mapSpec(row: SpecRow): StoredExecutionSpec {
  return {
    id: row.id,
    projectId: row.project_id,
    actionPlanId: row.action_plan_id,
    stepKey: row.step_key,
    stepOrder: row.step_order,
    businessAuditId: row.business_audit_id,
    opportunityId: row.opportunity_id,
    specIdentity: row.spec_identity,
    mode: row.mode,
    executionClass: row.execution_class,
    riskClass: row.risk_class,
    repositoryConnectionId: row.repository_connection_id,
    baseSha: row.base_sha,
    repositorySnapshotId: row.repository_snapshot_id,
    capability: row.capability,
    capabilityVersion: row.capability_version,
    creditQuoteId: row.credit_quote_id,
    // `== null` rather than `=== null`: the column is nullable, and PostgREST
    // omits a null it was not asked for. Coercing an absent value through
    // `creditUnits` would throw on a read rather than report "no ceiling".
    maxAuthorizedCredits:
      row.max_authorized_credits == null ? null : creditUnits(row.max_authorized_credits),
    spec: row.spec,
    schemaVersion: row.schema_version,
    resolverVersion: row.resolver_version,
    policyVersion: row.policy_version,
    riskPolicyVersion: row.risk_policy_version,
    createdAt: row.created_at,
  };
}

const POSTGRES_UNIQUE_VIOLATION = "23505";

export type InsertExecutionSpecResult =
  | { ok: true; spec: StoredExecutionSpec; alreadyExisted: boolean }
  | { ok: false; error: string };

/**
 * Writes one spec, or returns the existing one for the same identity.
 *
 * A duplicate is not an error. Re-resolving an unchanged world produces the
 * same identity by construction, and the honest answer to "create the spec for
 * this work" when it already exists is the spec that exists — the same shape
 * `postLedgerEntry` uses for a retried grant.
 *
 * Every column that could be forged is copied off the already-validated spec
 * document rather than accepted as a separate argument, so a caller cannot
 * store a row that disagrees with the document it contains (§54).
 */
export async function insertExecutionSpec(
  supabase: SupabaseClient,
  params: {
    spec: ExecutionSpec;
    repositoryConnectionId: string;
    creditQuoteId: string | null;
    maxAuthorizedCredits: CreditUnits | null;
  },
): Promise<InsertExecutionSpecResult> {
  const { spec } = params;

  const { data, error } = await supabase
    .from("execution_specs")
    .insert({
      project_id: spec.projectId,
      action_plan_id: spec.actionPlanId,
      step_key: spec.stepKey,
      step_order: spec.stepOrder,
      business_audit_id: spec.businessAuditId,
      opportunity_id: spec.opportunityId,
      spec_identity: spec.identity,
      mode: spec.mode,
      execution_class: spec.executionClass,
      risk_class: spec.riskClass,
      repository_connection_id: params.repositoryConnectionId,
      base_sha: spec.repository.baseSha,
      repository_snapshot_id: spec.repository.repositorySnapshotId,
      capability: spec.capability,
      capability_version: spec.capabilityVersion,
      credit_quote_id: params.creditQuoteId,
      max_authorized_credits: params.maxAuthorizedCredits,
      spec,
      schema_version: spec.schemaVersion,
      resolver_version: spec.resolverVersion,
      policy_version: spec.policyVersion,
      risk_policy_version: spec.riskPolicyVersion,
    })
    .select(SPEC_COLUMNS)
    .single();

  if (error) {
    if (error.code === POSTGRES_UNIQUE_VIOLATION) {
      const existing = await findExecutionSpecByIdentity(supabase, {
        projectId: spec.projectId,
        specIdentity: spec.identity,
      });
      if (existing) return { ok: true, spec: existing, alreadyExisted: true };
    }
    return { ok: false, error: error.message };
  }

  return { ok: true, spec: mapSpec(data as SpecRow), alreadyExisted: false };
}

export async function findExecutionSpecByIdentity(
  supabase: SupabaseClient,
  params: { projectId: string; specIdentity: string },
): Promise<StoredExecutionSpec | null> {
  const { data, error } = await supabase
    .from("execution_specs")
    .select(SPEC_COLUMNS)
    .eq("project_id", params.projectId)
    .eq("spec_identity", params.specIdentity)
    .maybeSingle();

  if (error) throw error;
  return data ? mapSpec(data as SpecRow) : null;
}

/**
 * Every spec produced for one plan, newest first.
 *
 * History rather than "the current one", because there is no current one: a
 * spec is superseded by the existence of a newer identity, not by a status
 * change, and a reader who wants the latest takes the first row.
 */
export async function listExecutionSpecsForPlan(
  supabase: SupabaseClient,
  params: { projectId: string; actionPlanId: string },
): Promise<StoredExecutionSpec[]> {
  const { data, error } = await supabase
    .from("execution_specs")
    .select(SPEC_COLUMNS)
    .eq("project_id", params.projectId)
    .eq("action_plan_id", params.actionPlanId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return ((data ?? []) as SpecRow[]).map(mapSpec);
}
