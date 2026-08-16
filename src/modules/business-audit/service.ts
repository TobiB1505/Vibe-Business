import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { BUSINESS_READINESS_AUDIT_CONFIG, PRODUCT_UNDERSTANDING_CONFIG } from "@/modules/ai/operations";
import { getLatestSuccessfulLiveSnapshot } from "@/modules/live-product-intelligence/store";
import { getLatestSuccessfulSnapshot } from "@/modules/repository-intelligence/store";
import { getLatestSuccessfulAuthenticatedSnapshot } from "@/modules/authenticated-product-intelligence/store";
import { UNDERSTANDING_EVIDENCE_VERSION } from "@/modules/product-understanding/evidence";
import { PROMPT_VERSION as PROFILE_PROMPT_VERSION } from "@/modules/product-understanding/prompt";
import {
  PRODUCT_PROFILE_SCHEMA_VERSION,
  PROFILE_BUILDER_VERSION,
} from "@/modules/product-understanding/schema";
import { computeProfileInputHash, getLatestProfile } from "@/modules/product-understanding/store";
import { getFounderIntent } from "@/modules/projects/founder-intent-store";
import { EVIDENCE_PACK_V3_VERSION } from "./evidence-v3";
import { PROMPT_VERSION } from "./prompt";
import { RUBRIC_VERSION } from "./rubric";
import { BUSINESS_AUDIT_SCHEMA_VERSION, BUSINESS_AUDIT_VERSION } from "./schema";
import {
  authorizeAudit,
  toAuditAccessStatus,
  type AuditAccessStatus,
  type AuditEntitlementFacts,
} from "./entitlement";
import {
  computeAuditInputHash,
  countRecentAuditStarts,
  getLatestSuccessfulAudit,
  hasCompletedIncludedAudit,
  hasFreeAuditGrant,
  hasRunningAudit,
} from "./store";

/**
 * Business Audit application queries: what is missing, whether the displayed
 * audit is still current, and whether a free audit may run.
 *
 * Execution moved to `src/modules/operations/` in Sprint 7 — see the note at
 * the bottom of this file. What remains here is read-only.
 */

/**
 * What a project is still missing before it can be audited (CORE-2 §8).
 *
 * `business_context_missing` is gone. It was replaced by two prerequisites
 * that say something materially different: the audit now needs Vibe's
 * *understanding* of the product, not the founder's typed description of it.
 *
 * The stale case is its own prerequisite rather than being folded into the
 * missing one, because the two have different remedies and CORE-2 §8 requires
 * the difference to be visible: a missing profile needs a first analysis, and
 * a stale one needs a refresh. Neither may cause the audit to quietly build a
 * second product-understanding pipeline of its own.
 */
export type AuditPrerequisite =
  | "repository_intelligence_missing"
  | "live_product_intelligence_missing"
  | "product_profile_missing"
  | "product_profile_stale";

export type AuditReadiness = {
  hasRepositoryIntelligence: boolean;
  hasLiveProductIntelligence: boolean;
  hasProductProfile: boolean;
  /** The profile was built from the evidence that exists now. */
  productProfileCurrent: boolean;
  ready: boolean;
  /** Everything still standing between this project and an audit. */
  missing: AuditPrerequisite[];
};

/**
 * Whether the stored profile was derived from today's evidence.
 *
 * Recomputes the profile's own input identity from the current snapshots and
 * compares. Nothing is stored for this: the profile's hash already encodes
 * every snapshot it saw plus the version set that produced it, so a new commit
 * or a finished Deep Scan changes the hash and this comparison notices —
 * without an invalidation system, and without a second source of truth that
 * could disagree with the one the understanding pipeline actually uses.
 */
async function isProfileCurrent(
  supabase: SupabaseClient,
  projectId: string,
  storedInputHash: string,
): Promise<boolean> {
  const [repository, live, authenticated] = await Promise.all([
    getLatestSuccessfulSnapshot(supabase, projectId),
    getLatestSuccessfulLiveSnapshot(supabase, projectId),
    getLatestSuccessfulAuthenticatedSnapshot(supabase, projectId),
  ]);

  const current = computeProfileInputHash({
    repositorySnapshotId: repository?.result ? repository.id : null,
    liveSnapshotId: live?.result ? live.id : null,
    authenticatedSnapshotId: authenticated?.result ? authenticated.id : null,
    schemaVersion: PRODUCT_PROFILE_SCHEMA_VERSION,
    builderVersion: PROFILE_BUILDER_VERSION,
    evidenceVersion: UNDERSTANDING_EVIDENCE_VERSION,
    promptVersion: PROFILE_PROMPT_VERSION,
    provider: "anthropic",
    model: PRODUCT_UNDERSTANDING_CONFIG.model,
  });

  return current === storedInputHash;
}

export async function getAuditReadiness(
  supabase: SupabaseClient,
  projectId: string,
): Promise<AuditReadiness> {
  const [repository, live, profile] = await Promise.all([
    getLatestSuccessfulSnapshot(supabase, projectId),
    getLatestSuccessfulLiveSnapshot(supabase, projectId),
    getLatestProfile(supabase, projectId),
  ]);

  const hasRepositoryIntelligence = Boolean(repository?.result);
  const hasLiveProductIntelligence = Boolean(live?.result);
  const hasProductProfile = profile !== null;

  const productProfileCurrent = profile
    ? await isProfileCurrent(supabase, projectId, profile.stored.inputHash)
    : false;

  const missing: AuditPrerequisite[] = [];
  if (!hasRepositoryIntelligence) missing.push("repository_intelligence_missing");
  if (!hasLiveProductIntelligence) missing.push("live_product_intelligence_missing");
  if (!hasProductProfile) missing.push("product_profile_missing");
  else if (!productProfileCurrent) missing.push("product_profile_stale");

  return {
    hasRepositoryIntelligence,
    hasLiveProductIntelligence,
    hasProductProfile,
    productProfileCurrent,
    ready: missing.length === 0,
    missing,
  };
}

/**
 * Everything the free-audit decision needs, gathered from the database and
 * handed to the pure policy in `entitlement.ts` (CORE-2 §16).
 *
 * Split this way on purpose: every interesting rule — what consumes the
 * entitlement, what a failure costs, what survives a disconnect — is testable
 * without a database, and this function's only job is to be a faithful reader.
 */
export async function getAuditEntitlementFacts(
  supabase: SupabaseClient,
  params: { projectId: string; userId: string },
): Promise<AuditEntitlementFacts> {
  const [readiness, completedIncluded, running, recentStarts, repositoryId] = await Promise.all([
    getAuditReadiness(supabase, params.projectId),
    hasCompletedIncludedAudit(supabase, params.projectId),
    hasRunningAudit(supabase, params.projectId),
    countRecentAuditStarts(supabase, params.projectId),
    getConnectedRepositoryId(supabase, params.projectId),
  ]);

  const grant =
    repositoryId === null
      ? false
      : await hasFreeAuditGrant(supabase, { userId: params.userId, githubRepositoryId: repositoryId });

  return {
    hasCompletedIncludedAudit: completedIncluded,
    hasRepositoryGrant: grant,
    hasRunningAudit: running,
    recentStartCount: recentStarts,
    hasProductProfile: readiness.hasProductProfile,
    productProfileCurrent: readiness.productProfileCurrent,
  };
}

/**
 * The GitHub repository id behind a project.
 *
 * This is the key the free-audit grant is scoped to, because it survives
 * disconnect and reconnect while a project id does not (CORE-2 §16).
 */
export async function getConnectedRepositoryId(
  supabase: SupabaseClient,
  projectId: string,
): Promise<number | null> {
  const { data, error } = await supabase
    .from("repository_connections")
    .select("github_repository_id")
    .eq("project_id", projectId)
    .maybeSingle();

  if (error) throw error;
  return (data as { github_repository_id: number } | null)?.github_repository_id ?? null;
}

export async function getAuditAccessStatus(
  supabase: SupabaseClient,
  params: { projectId: string; userId: string },
): Promise<AuditAccessStatus> {
  return toAuditAccessStatus(await getAuditEntitlementFacts(supabase, params));
}

/** The server-side gate. The UI renders its answer; it never decides. */
export async function authorizeProjectAudit(
  supabase: SupabaseClient,
  params: { projectId: string; userId: string },
) {
  return authorizeAudit(await getAuditEntitlementFacts(supabase, params));
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
  const [latestAudit, repositorySnapshot, liveSnapshot, profile, founderIntent, authenticatedSnapshot] =
    await Promise.all([
      getLatestSuccessfulAudit(supabase, projectId),
      getLatestSuccessfulSnapshot(supabase, projectId),
      getLatestSuccessfulLiveSnapshot(supabase, projectId),
      getLatestProfile(supabase, projectId),
      getFounderIntent(supabase, projectId),
      getLatestSuccessfulAuthenticatedSnapshot(supabase, projectId),
    ]);

  if (!latestAudit || !repositorySnapshot?.result || !liveSnapshot?.result || !profile) {
    return { hasAudit: latestAudit !== null, upToDate: false, newDeepScanEvidence: false };
  }

  const authenticated = authenticatedSnapshot?.result ? authenticatedSnapshot : null;

  const identity = (authenticatedSnapshotId: string | null) =>
    computeAuditInputHash({
      repositorySnapshotId: repositorySnapshot.id,
      liveSnapshotId: liveSnapshot.id,
      productProfileId: profile.stored.id,
      founderIntentHash: founderIntent.intentHash,
      authenticatedSnapshotId,
      schemaVersion: BUSINESS_AUDIT_SCHEMA_VERSION,
      auditVersion: BUSINESS_AUDIT_VERSION,
      evidencePackVersion: EVIDENCE_PACK_V3_VERSION,
      promptVersion: PROMPT_VERSION,
      rubricVersion: RUBRIC_VERSION,
      profileSchemaVersion: PRODUCT_PROFILE_SCHEMA_VERSION,
      profileBuilderVersion: PROFILE_BUILDER_VERSION,
      provider: "anthropic",
      model: BUSINESS_READINESS_AUDIT_CONFIG.model,
    });

  const current = identity(authenticated?.id ?? null);

  return {
    hasAudit: true,
    upToDate: latestAudit.inputHash === current,
    // Only claim *Deep Scan* staleness when the Deep Scan is demonstrably the
    // difference. Any other change (new repository snapshot, refreshed
    // profile, edited intent, new prompt version) leaves this false and shows
    // the generic message.
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
