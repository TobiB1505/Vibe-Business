import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { recordAuditEvent } from "@/modules/audit-log/events";
import { getAIProvider } from "@/modules/ai/anthropic/client";
import { BUSINESS_READINESS_AUDIT_CONFIG } from "@/modules/ai/operations";
import { recordAIUsage } from "@/modules/ai/usage";
import { getLatestSuccessfulLiveSnapshot } from "@/modules/live-product-intelligence/store";
import { getLatestSuccessfulSnapshot } from "@/modules/repository-intelligence/store";
import { getBusinessContext } from "@/modules/projects/business-context-store";
import { getLatestSuccessfulAuthenticatedSnapshot } from "@/modules/authenticated-product-intelligence/store";
import { EVIDENCE_PACK_V2_VERSION } from "./evidence-v2";
import { PROMPT_VERSION } from "./prompt";
import { RUBRIC_VERSION } from "./rubric";
import { runBusinessReadinessAudit, type AuditRunFailure } from "./runner";
import { BUSINESS_AUDIT_SCHEMA_VERSION, BUSINESS_AUDIT_VERSION } from "./schema";
import {
  completeAuditRun,
  computeAuditInputHash,
  createAuditRun,
  failAuditRun,
  findReusableAudit,
  getLatestSuccessfulAudit,
  type StoredAudit,
} from "./store";

/**
 * Application service tying prerequisites, reuse, inference, persistence
 * and accounting together. The only entry point the UI calls.
 *
 * Ownership is verified from persisted data before any paid call: the
 * caller supplies a project id and nothing else, so a user can only ever
 * spend inference on their own project's evidence.
 */

export type AuditPrerequisite =
  | "repository_intelligence_missing"
  | "live_product_intelligence_missing"
  | "business_context_missing";

export type RunAuditFailureCode = AuditRunFailure | AuditPrerequisite | "project_not_found" | "already_running";

export type RunAuditResult =
  | { ok: true; audit: StoredAudit; reused: boolean }
  | { ok: false; error: RunAuditFailureCode };

export type RunAuditOptions = {
  /** Deliberate re-run: skips reuse and pays for a fresh inference call. */
  force?: boolean;
};

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

export async function runProjectBusinessAudit(
  supabase: SupabaseClient,
  params: { projectId: string; userId: string },
  options: RunAuditOptions = {},
): Promise<RunAuditResult> {
  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", params.projectId)
    .eq("user_id", params.userId)
    .maybeSingle();

  if (!project) return { ok: false, error: "project_not_found" };

  // All three evidence sources are required for a first audit
  // (Sprint 4 §29). Producing a cheap, thin audit from partial
  // prerequisites would misrepresent what Vibe Business actually knows.
  //
  // Deep Scan is the exception: it is OPTIONAL evidence (Sprint 6 §1). A
  // project without one still produces a valid audit — with the gap stated
  // explicitly rather than left invisible.
  const [repositorySnapshot, liveSnapshot, businessContext, authenticatedSnapshot] = await Promise.all([
    getLatestSuccessfulSnapshot(supabase, params.projectId),
    getLatestSuccessfulLiveSnapshot(supabase, params.projectId),
    getBusinessContext(supabase, params.projectId),
    // Successful only, by construction of this query (Sprint 6 §6). A failed,
    // cancelled, expired or in-flight scan has no trustworthy snapshot, and
    // partial evidence from an aborted crawl would read as absence.
    getLatestSuccessfulAuthenticatedSnapshot(supabase, params.projectId),
  ]);

  if (!repositorySnapshot?.result) return { ok: false, error: "repository_intelligence_missing" };
  if (!liveSnapshot?.result) return { ok: false, error: "live_product_intelligence_missing" };
  if (!businessContext) return { ok: false, error: "business_context_missing" };

  // A completed row without a payload cannot contribute evidence, and must not
  // enter the identity either — otherwise the hash would claim the audit used
  // authenticated evidence it never saw.
  const authenticated = authenticatedSnapshot?.result ? authenticatedSnapshot : null;

  const config = BUSINESS_READINESS_AUDIT_CONFIG;

  const inputHash = computeAuditInputHash({
    repositorySnapshotId: repositorySnapshot.id,
    liveSnapshotId: liveSnapshot.id,
    businessContextHash: businessContext.contextHash,
    authenticatedSnapshotId: authenticated?.id ?? null,
    schemaVersion: BUSINESS_AUDIT_SCHEMA_VERSION,
    auditVersion: BUSINESS_AUDIT_VERSION,
    evidencePackVersion: EVIDENCE_PACK_V2_VERSION,
    promptVersion: PROMPT_VERSION,
    rubricVersion: RUBRIC_VERSION,
    provider: "anthropic",
    model: config.model,
  });

  if (!options.force) {
    const reusable = await findReusableAudit(supabase, { projectId: params.projectId, inputHash });
    if (reusable) {
      await recordAuditEvent(supabase, {
        userId: params.userId,
        eventType: "business_audit.reused",
        metadata: {
          projectId: params.projectId,
          auditId: reusable.id,
          model: config.model,
          promptVersion: PROMPT_VERSION,
          overallScore: reusable.overallScore,
          coverage: `${reusable.assessedDimensions ?? 0}/${reusable.totalDimensions ?? 0}`,
        },
      });
      return { ok: true, audit: reusable, reused: true };
    }
  }

  const run = await createAuditRun(supabase, {
    projectId: params.projectId,
    repositorySnapshotId: repositorySnapshot.id,
    liveSnapshotId: liveSnapshot.id,
    businessContextHash: businessContext.contextHash,
    inputHash,
    schemaVersion: BUSINESS_AUDIT_SCHEMA_VERSION,
    auditVersion: BUSINESS_AUDIT_VERSION,
    evidencePackVersion: EVIDENCE_PACK_V2_VERSION,
    promptVersion: PROMPT_VERSION,
    rubricVersion: RUBRIC_VERSION,
    provider: "anthropic",
    model: config.model,
  });

  if (!run.ok) {
    if (run.error === "already_running") return { ok: false, error: "already_running" };
    return { ok: false, error: "audit_failed" };
  }

  await recordAuditEvent(supabase, {
    userId: params.userId,
    eventType: "business_audit.started",
    metadata: {
      projectId: params.projectId,
      auditId: run.auditId,
      model: config.model,
      promptVersion: PROMPT_VERSION,
      rubricVersion: RUBRIC_VERSION,
    },
  });

  const provider = getAIProvider();

  const outcome = await runBusinessReadinessAudit({
    provider,
    config,
    repository: repositorySnapshot.result,
    liveProduct: liveSnapshot.result,
    businessContext: businessContext.context,
    authenticatedProduct: authenticated?.result ?? null,
  });

  // Usage is recorded for successes and failures alike, and only when
  // tokens were genuinely billed (Sprint 4 §25, §27).
  await recordAIUsage(supabase, {
    userId: params.userId,
    projectId: params.projectId,
    operation: config.operation,
    provider: provider.name,
    model: config.model,
    jobId: run.auditId,
    status: outcome.ok ? "succeeded" : "failed",
    usage: outcome.usage,
    estimatedInputTokens: outcome.estimatedInputTokens,
    latencyMs: outcome.latencyMs,
    failureCode: outcome.ok ? null : outcome.error,
  });

  if (!outcome.ok) {
    await failAuditRun(supabase, run.auditId, outcome.error);

    // The typed failure code is persisted on the run and in the usage
    // ledger; the bounded diagnostic goes to the audit log, which already
    // has a JSON metadata channel for exactly this. Nothing here is model
    // output, provider prose, prompt text, or evidence — see
    // `AuditRunDiagnostic`.
    await recordAuditEvent(supabase, {
      userId: params.userId,
      eventType: "business_audit.failed",
      metadata: {
        projectId: params.projectId,
        auditId: run.auditId,
        reason: outcome.error,
        ...(outcome.diagnostic ? { diagnostic: outcome.diagnostic } : {}),
      },
    });

    // Also logged server-side so an operator investigating a failed dogfood
    // run does not have to query the database to see which stage failed.
    console.error("[business-audit] run failed", {
      auditId: run.auditId,
      operation: config.operation,
      model: config.model,
      failureCode: outcome.error,
      diagnostic: outcome.diagnostic ?? null,
      billedTokens: outcome.usage
        ? { input: outcome.usage.inputTokens, output: outcome.usage.outputTokens }
        : null,
    });

    return { ok: false, error: outcome.error };
  }

  await completeAuditRun(supabase, run.auditId, outcome.audit);

  await recordAuditEvent(supabase, {
    userId: params.userId,
    eventType: "business_audit.completed",
    metadata: {
      projectId: params.projectId,
      auditId: run.auditId,
      model: outcome.audit.model,
      promptVersion: PROMPT_VERSION,
      rubricVersion: RUBRIC_VERSION,
      overallScore: outcome.audit.overall.score,
      coverage: `${outcome.audit.overall.assessedDimensions}/${outcome.audit.overall.totalDimensions}`,
    },
  });

  const completedAt = new Date().toISOString();
  return {
    ok: true,
    reused: false,
    audit: {
      id: run.auditId,
      projectId: params.projectId,
      status: "completed",
      inputHash,
      overallScore: outcome.audit.overall.score,
      assessedDimensions: outcome.audit.overall.assessedDimensions,
      totalDimensions: outcome.audit.overall.totalDimensions,
      failureCode: null,
      result: outcome.audit,
      createdAt: completedAt,
      completedAt,
    },
  };
}
