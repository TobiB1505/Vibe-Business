import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { OPPORTUNITY_GENERATION_CONFIG } from "@/modules/ai/operations";
import { getAuditCurrency } from "@/modules/business-audit/service";
import { getLatestSuccessfulAudit, getProjectAuditById } from "@/modules/business-audit/store";
import { resolveMoveLineage, type MoveLineageMap } from "./lineage";
import { OPPORTUNITY_PROMPT_VERSION } from "./prompt";
import { OPPORTUNITY_RUBRIC_VERSION } from "./rubric";
import { OPPORTUNITY_ENGINE_VERSION, OPPORTUNITY_SET_SCHEMA_VERSION } from "./schema";
import {
  computeOpportunityInputHash,
  getLatestCompletedOpportunitySet,
  type StoredOpportunitySet,
} from "./store";

/**
 * Opportunity readiness and staleness (Sprint 8 §34, §35).
 *
 * Two different staleness questions, deliberately separate:
 *
 *  - **Is the audit current?** If newer evidence exists, prioritizing from the
 *    old diagnosis produces confident advice about a product that has since
 *    changed. Generation is blocked until the audit is refreshed (§34).
 *  - **Is the opportunity set current?** If a newer audit exists than the one
 *    a set was built from, the set is stale — shown, not deleted, with an
 *    offer to refresh. No automatic spend (§35).
 */

export type OpportunityBlockReason =
  /** No audit exists yet — there is nothing to prioritize from. */
  | "audit_missing"
  /** The audit predates evidence that exists now (§34). */
  | "audit_stale";

export type OpportunityReadiness = {
  /** Generation may be offered. */
  ready: boolean;
  blockedReason: OpportunityBlockReason | null;
  /** The audit that would be prioritized, when there is one. */
  auditId: string | null;
};

export async function getOpportunityReadiness(
  supabase: SupabaseClient,
  projectId: string,
): Promise<OpportunityReadiness> {
  const [audit, currency] = await Promise.all([
    getLatestSuccessfulAudit(supabase, projectId),
    getAuditCurrency(supabase, projectId),
  ]);

  if (!audit?.result) return { ready: false, blockedReason: "audit_missing", auditId: null };

  // Refusing here rather than warning is the deliberate choice. A prioritized
  // list built from a diagnosis we already know is out of date reads exactly
  // like one built from current evidence, and the user has no way to tell.
  if (!currency.upToDate) return { ready: false, blockedReason: "audit_stale", auditId: audit.id };

  return { ready: true, blockedReason: null, auditId: audit.id };
}

export type OpportunitySetView = {
  set: StoredOpportunitySet;
  /**
   * A newer audit exists than the one this set was prioritized from.
   *
   * The set stays visible — it was true when it was made, and deleting a
   * founder's list because the diagnosis moved would be worse than saying so.
   */
  stale: boolean;
};

export async function getLatestOpportunities(
  supabase: SupabaseClient,
  projectId: string,
): Promise<OpportunitySetView | null> {
  const [set, latestAudit] = await Promise.all([
    getLatestCompletedOpportunitySet(supabase, projectId),
    getLatestSuccessfulAudit(supabase, projectId),
  ]);

  if (!set) return null;

  return {
    set,
    stale: latestAudit !== null && latestAudit.id !== set.businessAuditId,
  };
}

/**
 * Which audit finding each Move in a set answers (UI-S2 §6, §51).
 *
 * **One query for the whole list**, not one per Move. The set already names the
 * audit it was prioritized from, and every conclusion lives inside that single
 * stored document — so resolving twenty Moves costs exactly the same as
 * resolving one, and the N+1 this could easily have been never exists.
 *
 * The audit is read by the set's own `businessAuditId`, which is what keeps a
 * historical set bound to the diagnosis it actually came from (§7).
 */
export async function getMoveLineage(
  supabase: SupabaseClient,
  params: { projectId: string; set: StoredOpportunitySet },
): Promise<MoveLineageMap> {
  const audit = await getProjectAuditById(supabase, {
    projectId: params.projectId,
    auditId: params.set.businessAuditId,
  });

  return resolveMoveLineage({
    sourceAudit: audit?.result ?? null,
    opportunities: params.set.opportunities,
  });
}

/** Resolves the identity a generation run would carry, or why it cannot. */
export async function resolveOpportunityIdentity(
  supabase: SupabaseClient,
  projectId: string,
): Promise<
  | { ok: true; auditId: string; inputHash: string; evidencePackVersion: string }
  | { ok: false; error: OpportunityBlockReason }
> {
  const readiness = await getOpportunityReadiness(supabase, projectId);
  if (!readiness.ready) return { ok: false, error: readiness.blockedReason ?? "audit_missing" };

  const audit = await getLatestSuccessfulAudit(supabase, projectId);
  if (!audit?.result) return { ok: false, error: "audit_missing" };

  return {
    ok: true,
    auditId: audit.id,
    evidencePackVersion: audit.result.evidencePackVersion,
    inputHash: computeOpportunityInputHash({
      auditId: audit.id,
      auditInputHash: audit.inputHash,
      evidencePackVersion: audit.result.evidencePackVersion,
      engineVersion: OPPORTUNITY_ENGINE_VERSION,
      promptVersion: OPPORTUNITY_PROMPT_VERSION,
      rubricVersion: OPPORTUNITY_RUBRIC_VERSION,
      schemaVersion: OPPORTUNITY_SET_SCHEMA_VERSION,
      provider: "anthropic",
      model: OPPORTUNITY_GENERATION_CONFIG.model,
    }),
  };
}
