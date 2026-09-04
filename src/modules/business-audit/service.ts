import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  BUSINESS_READINESS_AUDIT_CONFIG,
  PRODUCT_UNDERSTANDING_CONFIG,
} from "@/modules/ai/operations";
import { LIVE_PRODUCT_ANALYZER_VERSION } from "@/modules/live-product-intelligence/schema";
import { getLatestSuccessfulLiveSnapshot } from "@/modules/live-product-intelligence/store";
import { ANALYZER_VERSION as REPOSITORY_ANALYZER_VERSION } from "@/modules/repository-intelligence/schema";
import { getLatestSuccessfulSnapshot } from "@/modules/repository-intelligence/store";
import { getLatestSuccessfulAuthenticatedSnapshot } from "@/modules/authenticated-product-intelligence/store";
import { UNDERSTANDING_EVIDENCE_VERSION } from "@/modules/product-understanding/evidence";
import { PROMPT_VERSION as PROFILE_PROMPT_VERSION } from "@/modules/product-understanding/prompt";
import {
  PRODUCT_PROFILE_SCHEMA_VERSION,
  PROFILE_BUILDER_VERSION,
} from "@/modules/product-understanding/schema";
import { computeProfileInputHash, getLatestProfile } from "@/modules/product-understanding/store";
import { resolveOperationCreditCost } from "@/modules/operations/billing";
import { getFounderIntent } from "@/modules/projects/founder-intent-store";
import { CURRENT_EVIDENCE_PACK_VERSION } from "./evidence-v3";
import { PROMPT_VERSION } from "./prompt";
import { RUBRIC_VERSION } from "./rubric";
import { BUSINESS_AUDIT_SCHEMA_VERSION, BUSINESS_AUDIT_VERSION } from "./schema";
import { liveConnections } from "@/modules/projects/repository-connection";
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
  /**
   * The newest scan was produced by an analyzer Vibe has since corrected.
   *
   * Not "missing" and not "old": present, readable, and known to have been
   * made by a machine that got something wrong. Its own remedy is a re-scan,
   * which costs the customer nothing.
   */
  | "repository_scan_outdated"
  | "live_scan_outdated"
  | "product_profile_missing"
  | "product_profile_stale";

export type AuditReadiness = {
  hasRepositoryIntelligence: boolean;
  hasLiveProductIntelligence: boolean;
  hasProductProfile: boolean;
  /** The profile was built from the evidence that exists now. */
  productProfileCurrent: boolean;
  /** Both scans were produced by the analyzers running now. */
  scansCurrent: boolean;
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
/**
 * Every document the Business Health read models share (VB-022).
 *
 * ## Why this exists
 *
 * Because three of them wanted the same evidence and each fetched it for
 * itself. `getAuditReadiness` reads the repository snapshot; so does
 * `getAuditCurrency`; so does the profile-currency check inside the first; and
 * so does the page around them. Every one of those call sites is correct on its
 * own — a single `await` inside a `Promise.all` — and the cost is only visible
 * in the total: measured, four fetches of the repository snapshot, four of the
 * live snapshot and three of the audit document, per render of the product's
 * most-visited route. These are multi-hundred-kilobyte JSONB documents.
 *
 * ## Why not React `cache()`
 *
 * It was the obvious answer and it is the wrong shape here. `cache()` memoizes
 * only inside a render — measured: outside one it calls straight through — so
 * nothing in the test suite could prove the duplication had gone, and the
 * memoization would silently not apply to any other caller. Passing the
 * evidence explicitly is the same pattern VB-023 used for prepared changes, and
 * it is checkable by counting.
 *
 * Every field is what the corresponding getter returns; nothing here is
 * derived, and no read model re-decides anything because of where its input
 * came from.
 */
export type AuditEvidence = {
  repository: Awaited<ReturnType<typeof getLatestSuccessfulSnapshot>>;
  live: Awaited<ReturnType<typeof getLatestSuccessfulLiveSnapshot>>;
  authenticated: Awaited<ReturnType<typeof getLatestSuccessfulAuthenticatedSnapshot>>;
  profile: Awaited<ReturnType<typeof getLatestProfile>>;
  latestAudit: Awaited<ReturnType<typeof getLatestSuccessfulAudit>>;
  founderIntent: Awaited<ReturnType<typeof getFounderIntent>>;
};

export async function readAuditEvidence(
  supabase: SupabaseClient,
  projectId: string,
): Promise<AuditEvidence> {
  const [repository, live, authenticated, profile, latestAudit, founderIntent] = await Promise.all([
    getLatestSuccessfulSnapshot(supabase, projectId),
    getLatestSuccessfulLiveSnapshot(supabase, projectId),
    getLatestSuccessfulAuthenticatedSnapshot(supabase, projectId),
    getLatestProfile(supabase, projectId),
    getLatestSuccessfulAudit(supabase, projectId),
    getFounderIntent(supabase, projectId),
  ]);

  return { repository, live, authenticated, profile, latestAudit, founderIntent };
}

/**
 * The scans that were produced by an analyzer older than the one running now.
 *
 * ## Why this is a prerequisite and not a note
 *
 * Because everything downstream is derived from these two snapshots, and a
 * correction to a detector does not reach into the answers it already gave.
 * On 2026-09-02 the pricing classifier learned to see an anchor section; the
 * snapshot taken hours earlier kept saying a page with three prices on it had
 * no pricing surface, and two days later that produced an audit whose critical
 * blocker, whose highest-priority contradiction and whose whole plan were
 * false. Nothing warned anybody, because nothing was looking at this.
 *
 * ## Why the version and not the age
 *
 * A month-old scan of a site that has not changed is perfectly good evidence.
 * A scan from this morning made by a detector corrected at lunchtime is not.
 * Age is a proxy; the analyzer version is the fact.
 *
 * The analyzer version is also the only thing `findReusableLiveSnapshot` keys
 * reuse on, so a stale snapshot cannot be noticed anywhere else — which is why
 * `LIVE_PRODUCT_ANALYZER_VERSION` says at length what happens when somebody
 * changes a detector and forgets to bump it.
 */
export function outdatedScans(evidence: AuditEvidence): AuditPrerequisite[] {
  const outdated: AuditPrerequisite[] = [];

  if (
    evidence.repository?.result &&
    evidence.repository.analyzerVersion !== REPOSITORY_ANALYZER_VERSION
  ) {
    outdated.push("repository_scan_outdated");
  }

  if (evidence.live?.result && evidence.live.analyzerVersion !== LIVE_PRODUCT_ANALYZER_VERSION) {
    outdated.push("live_scan_outdated");
  }

  return outdated;
}

function isProfileCurrent(evidence: AuditEvidence, storedInputHash: string): boolean {
  const { repository, live, authenticated } = evidence;

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
  /** Already read by the caller, when it is reading it anyway (VB-022). */
  prefetched?: AuditEvidence,
): Promise<AuditReadiness> {
  const evidence = prefetched ?? (await readAuditEvidence(supabase, projectId));
  const { repository, live, profile } = evidence;

  const hasRepositoryIntelligence = Boolean(repository?.result);
  const hasLiveProductIntelligence = Boolean(live?.result);
  const hasProductProfile = profile !== null;

  const productProfileCurrent = profile
    ? isProfileCurrent(evidence, profile.stored.inputHash)
    : false;

  /*
   * Before the profile, deliberately. `isProfileCurrent` hashes the snapshot's
   * *id*, not the analyzer that made it — so a profile built on an outdated
   * scan reports itself current, and checking it first would wave the audit
   * through onto evidence Vibe already knows is wrong.
   */
  const outdated = outdatedScans(evidence);

  const missing: AuditPrerequisite[] = [];
  if (!hasRepositoryIntelligence) missing.push("repository_intelligence_missing");
  if (!hasLiveProductIntelligence) missing.push("live_product_intelligence_missing");
  missing.push(...outdated);
  if (!hasProductProfile) missing.push("product_profile_missing");
  else if (!productProfileCurrent) missing.push("product_profile_stale");

  return {
    hasRepositoryIntelligence,
    hasLiveProductIntelligence,
    hasProductProfile,
    productProfileCurrent,
    scansCurrent: outdated.length === 0,
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
  /** Already read by the caller, when it is reading it anyway (VB-022). */
  prefetched?: AuditEvidence,
): Promise<AuditEntitlementFacts> {
  const [readiness, completedIncluded, running, recentStarts, repositoryId, latestAudit] =
    await Promise.all([
      getAuditReadiness(supabase, params.projectId, prefetched),
      hasCompletedIncludedAudit(supabase, params.projectId),
      hasRunningAudit(supabase, params.projectId),
      countRecentAuditStarts(supabase, params.projectId),
      getConnectedRepositoryId(supabase, params.projectId),
      /*
       * The pack already carries it, and it is the audit document — the
       * largest single thing this route transfers.
       *
       * Branching on whether the pack was *given*, not on whether its audit is
       * non-null: `null` is the real answer for a project that has never
       * completed one, and `??` would read the table again to rediscover it.
       */
      prefetched ? prefetched.latestAudit : getLatestSuccessfulAudit(supabase, params.projectId),
    ]);

  const grant =
    repositoryId === null
      ? false
      : await hasFreeAuditGrant(supabase, {
          userId: params.userId,
          githubRepositoryId: repositoryId,
        });

  return {
    hasCompletedIncludedAudit: completedIncluded,
    hasRepositoryGrant: grant,
    hasRunningAudit: running,
    recentStartCount: recentStarts,
    // Read from the stored payload rather than a column: the contract version
    // lives inside `result`, so no migration was needed (CORE-2a.2 §24, §42).
    storedAudit: latestAudit
      ? { contractVersion: latestAudit.result?.contractVersion ?? null }
      : null,
    scansCurrent: readiness.scansCurrent,
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
  const { data, error } = await liveConnections(supabase, "github_repository_id")
    .eq("project_id", projectId)
    .maybeSingle();

  if (error) throw error;
  return (data as { github_repository_id: number } | null)?.github_repository_id ?? null;
}

/**
 * The entitlement decision, plus the price when the customer is the one paying.
 *
 * `toAuditAccessStatus` is pure over entitlement facts and deliberately leaves
 * `creditCost` null — a wallet is not an entitlement fact. This is where the
 * two are joined, and the join is conditional on purpose: the balance is only
 * read when the included audit is spent, so the free path costs no extra query.
 *
 * Without this, `credits_required` reached the UI as a bare refusal with no
 * price and no balance, and the only sentence a screen could write from it was
 * that Credits were unavailable — which stopped being true when Billing Core-2
 * shipped (§39).
 */
export async function getAuditAccessStatus(
  supabase: SupabaseClient,
  params: { projectId: string; userId: string },
  /**
   * Already read by the caller (VB-022).
   *
   * Without it this re-read the whole evidence pack — five snapshot documents
   * and the audit — that Business Health had gathered one line earlier and was
   * already passing to the two read models beside this one. The prefetch
   * parameter existed on those; this call site was the one that did not take
   * it, so the duplication the pattern exists to remove came back on the
   * product's most-visited route.
   */
  prefetched?: AuditEvidence,
): Promise<AuditAccessStatus> {
  const status = toAuditAccessStatus(await getAuditEntitlementFacts(supabase, params, prefetched));
  if (status.blockedReason !== "credits_required") return status;

  const cost = await resolveOperationCreditCost(supabase, {
    projectId: params.projectId,
    operation: "business_audit",
  });
  // Null means the audit carries no retail price under the policy in force.
  // Then there is nothing to pay and nothing to say, so the status stays as the
  // pure function left it rather than inventing a price of zero.
  if (!cost) return status;

  return {
    ...status,
    creditCost: {
      requiredCredits: cost.requiredCredits,
      availableCredits: cost.availableCredits,
      affordable: cost.affordable,
    },
  };
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
  /** Already read by the caller, when it is reading it anyway (VB-022). */
  prefetched?: AuditEvidence,
): Promise<AuditCurrency> {
  const {
    latestAudit,
    repository: repositorySnapshot,
    live: liveSnapshot,
    profile,
    founderIntent,
    authenticated: authenticatedSnapshot,
  } = prefetched ?? (await readAuditEvidence(supabase, projectId));

  if (!latestAudit || !repositorySnapshot?.result || !liveSnapshot?.result || !profile) {
    return { hasAudit: latestAudit !== null, upToDate: false, newDeepScanEvidence: false };
  }

  /*
   * The other end of the same chain.
   *
   * `computeAuditInputHash` takes each snapshot's *id*, so an audit built on a
   * scan Vibe has since corrected still hashes identical — the id did not move,
   * only the machine that produced it did. Reporting that audit as up to date
   * lets everything downstream run on it: the Moves engine's only freshness
   * gate is `audit_stale`, so a false `upToDate` is what let two Move sets be
   * generated from a pricing surface that was never really missing.
   *
   * A re-scan writes a new snapshot with a new id, which moves the hash and
   * makes this branch redundant again. Until then the honest answer is no.
   */
  if (
    outdatedScans({
      ...(prefetched ?? {}),
      repository: repositorySnapshot,
      live: liveSnapshot,
    } as AuditEvidence).length > 0
  ) {
    return { hasAudit: true, upToDate: false, newDeepScanEvidence: false };
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
      evidencePackVersion: CURRENT_EVIDENCE_PACK_VERSION,
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
