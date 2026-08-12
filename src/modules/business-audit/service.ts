import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { BUSINESS_READINESS_AUDIT_CONFIG } from "@/modules/ai/operations";
import { getLatestSuccessfulLiveSnapshot } from "@/modules/live-product-intelligence/store";
import { getLatestSuccessfulSnapshot } from "@/modules/repository-intelligence/store";
import { getBusinessContext } from "@/modules/projects/business-context-store";
import { getLatestSuccessfulAuthenticatedSnapshot } from "@/modules/authenticated-product-intelligence/store";
import { EVIDENCE_PACK_V2_VERSION } from "./evidence-v2";
import { PROMPT_VERSION } from "./prompt";
import { RUBRIC_VERSION } from "./rubric";
import { BUSINESS_AUDIT_SCHEMA_VERSION, BUSINESS_AUDIT_VERSION } from "./schema";
import { computeAuditInputHash, getLatestSuccessfulAudit } from "./store";

/**
 * Business Audit application queries: what is missing, and whether the
 * displayed audit is still current.
 *
 * Execution moved to `src/modules/operations/` in Sprint 7 — see the note at
 * the bottom of this file. What remains here is read-only.
 */

export type AuditPrerequisite =
  | "repository_intelligence_missing"
  | "live_product_intelligence_missing"
  | "business_context_missing";

/**
 * Which prerequisites a project is still missing. Used by the UI to say
 * exactly what is required rather than failing opaquely (Sprint 4 §29).
 */
export type AuditReadiness = {
  hasRepositoryIntelligence: boolean;
  hasLiveProductIntelligence: boolean;
  hasBusinessContext: boolean;
  ready: boolean;
};

export async function getAuditReadiness(
  supabase: SupabaseClient,
  projectId: string,
): Promise<AuditReadiness> {
  const [repository, live, context] = await Promise.all([
    getLatestSuccessfulSnapshot(supabase, projectId),
    getLatestSuccessfulLiveSnapshot(supabase, projectId),
    getBusinessContext(supabase, projectId),
  ]);

  const hasRepositoryIntelligence = Boolean(repository?.result);
  const hasLiveProductIntelligence = Boolean(live?.result);
  const hasBusinessContext = context !== null;

  return {
    hasRepositoryIntelligence,
    hasLiveProductIntelligence,
    hasBusinessContext,
    ready: hasRepositoryIntelligence && hasLiveProductIntelligence && hasBusinessContext,
  };
}

/**
 * Whether the displayed audit still reflects the evidence that exists today
 * (Sprint 6 §12).
 *
 * Vibe Business deliberately does **not** re-run the audit when new evidence
 * appears (Sprint 6 §14): inference costs the user real money, so spending it
 * is their decision. What the product owes them instead is an honest statement
 * that the audit on screen is older than the evidence.
 *
 * `newDeepScanEvidence` is derived rather than stored: an audit's identity hash
 * already encodes which authenticated snapshot it saw, so recomputing the hash
 * with `authenticatedSnapshotId: null` tells us whether the displayed audit was
 * produced before this Deep Scan existed — no schema change required.
 */
export type AuditCurrency = {
  hasAudit: boolean;
  /** The displayed audit was produced from exactly today's evidence. */
  upToDate: boolean;
  /** A successful Deep Scan exists that the displayed audit did not see. */
  newDeepScanEvidence: boolean;
};

export async function getAuditCurrency(
  supabase: SupabaseClient,
  projectId: string,
): Promise<AuditCurrency> {
  const [latestAudit, repositorySnapshot, liveSnapshot, businessContext, authenticatedSnapshot] =
    await Promise.all([
      getLatestSuccessfulAudit(supabase, projectId),
      getLatestSuccessfulSnapshot(supabase, projectId),
      getLatestSuccessfulLiveSnapshot(supabase, projectId),
      getBusinessContext(supabase, projectId),
      getLatestSuccessfulAuthenticatedSnapshot(supabase, projectId),
    ]);

  if (!latestAudit || !repositorySnapshot?.result || !liveSnapshot?.result || !businessContext) {
    return { hasAudit: latestAudit !== null, upToDate: false, newDeepScanEvidence: false };
  }

  const authenticated = authenticatedSnapshot?.result ? authenticatedSnapshot : null;

  const identity = (authenticatedSnapshotId: string | null) =>
    computeAuditInputHash({
      repositorySnapshotId: repositorySnapshot.id,
      liveSnapshotId: liveSnapshot.id,
      businessContextHash: businessContext.contextHash,
      authenticatedSnapshotId,
      schemaVersion: BUSINESS_AUDIT_SCHEMA_VERSION,
      auditVersion: BUSINESS_AUDIT_VERSION,
      evidencePackVersion: EVIDENCE_PACK_V2_VERSION,
      promptVersion: PROMPT_VERSION,
      rubricVersion: RUBRIC_VERSION,
      provider: "anthropic",
      model: BUSINESS_READINESS_AUDIT_CONFIG.model,
    });

  const current = identity(authenticated?.id ?? null);

  return {
    hasAudit: true,
    upToDate: latestAudit.inputHash === current,
    // Only claim *Deep Scan* staleness when the Deep Scan is demonstrably the
    // difference. Any other change (new repository snapshot, edited context,
    // new prompt version) leaves this false and shows the generic message.
    newDeepScanEvidence:
      authenticated !== null &&
      latestAudit.inputHash !== current &&
      latestAudit.inputHash === identity(null),
  };
}

/**
 * The synchronous `runProjectBusinessAudit` lived here until Sprint 7.
 *
 * It ran the whole audit inside the browser request — measured at ~50 seconds
 * against the real project — and was replaced by durable execution in
 * `src/modules/operations/`. It is deleted rather than deprecated on purpose:
 * a function that can still spend money inside a request is not something to
 * leave lying around for someone to wire back up.
 *
 * The domain pipeline it called (`runBusinessReadinessAudit`) is unchanged and
 * is now invoked from a workflow step instead.
 */
