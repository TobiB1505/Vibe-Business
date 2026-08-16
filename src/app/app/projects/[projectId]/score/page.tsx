import { EmptyState, Notice } from "@/components/ui/states";
import { WorkspaceSection } from "@/components/layout/project-shell";
import {
  getAuditAccessStatus,
  getAuditCurrency,
  getAuditReadiness,
  type AuditPrerequisite,
} from "@/modules/business-audit/service";
import { getLatestSuccessfulAudit } from "@/modules/business-audit/store";
import { buildAuditEvidenceNotice } from "@/modules/business-audit/evidence-notice";
import { getDeepScanAccessStatus } from "@/modules/authenticated-product-intelligence/service";
import { isBrowserProviderConfigured } from "@/modules/authenticated-product-intelligence/browserbase/client";
import {
  getLatestSession,
  getLatestSuccessfulAuthenticatedSnapshot,
} from "@/modules/authenticated-product-intelligence/store";
import { detectAuthenticatedSurfaces } from "@/modules/authenticated-product-intelligence/surface-detection";
import { buildDeepScanViewModel } from "@/modules/authenticated-product-intelligence/view";
import { getLatestSuccessfulLiveSnapshot } from "@/modules/live-product-intelligence/store";
import { getActiveBusinessAuditOperation } from "@/modules/operations/service";
import { getLatestOpportunities } from "@/modules/opportunities/service";

import { requireProjectAccess } from "@/modules/projects/workspace-context";
import { getLatestSuccessfulSnapshot } from "@/modules/repository-intelligence/store";
import { AuditEvidenceNotice } from "../audit-evidence-notice";
import { AuditConclusion } from "../audit-conclusion";
import { RunAuditButton } from "../run-audit-button";

/**
 * How a missing prerequisite reads in the sentence "A business audit needs
 * … first." Phrased as things rather than as error codes, and the two
 * profile cases stay distinct because their remedies are (CORE-2 §8).
 */
const AUDIT_PREREQUISITE_LABELS: Record<AuditPrerequisite, string> = {
  repository_intelligence_missing: "repository intelligence",
  live_product_intelligence_missing: "live product intelligence",
  product_profile_missing: "Vibe to understand your product",
  product_profile_stale: "an up-to-date understanding of your product",
};

/**
 * Business score (Sprint UI-2 Part 2).
 *
 * ## What this route pays for
 *
 * The audit, its currency, the three evidence flags the prerequisite sentence
 * needs, and the Deep Scan model — the last only because the evidence notice
 * asks whether a Deep Scan is available and whether the audit predates it.
 *
 * What it no longer pays for, and used to: the prepared-change assembly. Before
 * the split, opening the score signed review-image URLs, asked the sandbox
 * provider for preview origins and ran the GitHub merge preflight. None of that
 * is reached from here now.
 */
export default async function ProjectScorePage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const { supabase, userId, project } = await requireProjectAccess(projectId);

  const [
    latestAudit,
    auditCurrency,
    activeAuditOperation,
    latestSnapshot,
    latestLiveSnapshot,
    auditReadiness,
    auditAccess,
    deepScanAccess,
    latestDeepScanSnapshot,
    latestDeepScanSession,
    opportunities,
  ] = await Promise.all([
    getLatestSuccessfulAudit(supabase, projectId),
    getAuditCurrency(supabase, projectId),
    // Discovered on the server so returning here shows a running audit rather
    // than an inviting button (Sprint 7 §19).
    getActiveBusinessAuditOperation(supabase, projectId),
    getLatestSuccessfulSnapshot(supabase, projectId),
    getLatestSuccessfulLiveSnapshot(supabase, projectId),
    getAuditReadiness(supabase, projectId),
    getAuditAccessStatus(supabase, { projectId, userId }),
    getDeepScanAccessStatus(supabase, { projectId, userId }),
    getLatestSuccessfulAuthenticatedSnapshot(supabase, projectId),
    getLatestSession(supabase, projectId),
    // CORE-2 §18: "Where I'd start" links to the existing Opportunity Engine's
    // output. The audit never produces moves of its own.
    getLatestOpportunities(supabase, projectId),
  ]);

  const hasMoves = (opportunities?.set.opportunities.length ?? 0) > 0;

  const deepScanModel = deepScanAccess
    ? buildDeepScanViewModel({
        accessStatus: deepScanAccess,
        latestSnapshot: latestDeepScanSnapshot
          ? {
              result: latestDeepScanSnapshot.result,
              accessMode: latestDeepScanSnapshot.accessMode,
              completedAt: latestDeepScanSnapshot.completedAt,
              createdAt: latestDeepScanSnapshot.createdAt,
              pagesInspected: latestDeepScanSnapshot.pagesInspected,
            }
          : null,
        latestSession: latestDeepScanSession
          ? { status: latestDeepScanSession.status, failureCode: latestDeepScanSession.failureCode }
          : null,
        surfaceDetection: detectAuthenticatedSurfaces({
          repository: latestSnapshot?.result ?? null,
          publicProduct: latestLiveSnapshot?.result ?? null,
        }),
        providerConfigured: isBrowserProviderConfigured(),
      })
    : null;

  // Deep Scan evidence notice (Sprint 6 §11, §14). Informational: it never
  // gates the audit, and a new Deep Scan never triggers an automatic AI call.
  const auditEvidenceNotice = buildAuditEvidenceNotice({
    hasSuccessfulDeepScan: Boolean(latestDeepScanSnapshot?.result),
    authenticatedSurfacesLikely: deepScanModel?.showRecommendation ?? false,
    canStartDeepScan: deepScanModel?.canStart ?? false,
    auditPredatesDeepScan: auditCurrency.newDeepScanEvidence,
  });

  /*
   * Prerequisites come from the audit service rather than being re-derived
   * here (CORE-2 §3), so the button and the server gate cannot disagree.
   *
   * The entitlement is a *separate* reason the button must be off, and it is
   * kept separate: the first dogfood showed a prominent, enabled "Re-run
   * business audit" directly beneath a notice saying the free audit was already
   * spent — and pressing it paid for a model call that then failed at
   * persistence. Nothing is missing in that state, so it gets its own notice
   * rather than being folded into the "needs … first" sentence.
   */
  const missingPrerequisites = auditReadiness.missing.map(
    (prerequisite) => AUDIT_PREREQUISITE_LABELS[prerequisite],
  );
  const blockedByCredits = auditAccess.blockedReason === "credits_required";
  const auditReady = auditReadiness.ready && !blockedByCredits;

  return (
    // The section id stays `business-audit`: `BUSINESS_AUDIT_ANCHOR` is a tested
    // domain constant that a blocked opportunity set links at, and that link is
    // the only way out of that state. It now resolves on this route.
    <WorkspaceSection
      id="business-audit"
      title="Business audit"
      description="What Vibe makes of this product as a business, and what it would do about it."
      actions={
        <RunAuditButton
          projectId={project.id}
          hasAudit={Boolean(latestAudit?.result)}
          disabled={!auditReady}
          activeOperation={activeAuditOperation}
        />
      }
    >
      <div className="flex flex-col gap-4">
        <AuditEvidenceNotice notice={auditEvidenceNotice} />

        {missingPrerequisites.length > 0 && (
          <Notice tone="waiting" label="Why this is blocked">
            A business audit needs {missingPrerequisites.join(", ")} first.
          </Notice>
        )}

        {/*
          CORE-2 §16: the first qualified audit is free, and the entitlement is
          decided server-side. This only reports the decision — no price, no
          balance, no checkout that does not exist (§45, §46).
        */}
        {auditReady && !latestAudit?.result && auditAccess.freeAuditAvailable && (
          <Notice tone="info" label="Included">
            Your first business audit is free.
          </Notice>
        )}

        {blockedByCredits && (
          <Notice tone="waiting" label="Keep Vibe working">
            You&rsquo;ve used the free audit for this project. Running another one will need
            credits — they aren&rsquo;t available yet.
          </Notice>
        )}

        {latestAudit?.result ? (
          // Answer first, evidence second, tech last — all three owned by the
          // component, so the reading order cannot be reassembled here (§14).
          <AuditConclusion
            audit={latestAudit.result}
            analyzedAt={latestAudit.completedAt ?? latestAudit.createdAt}
            movesHref={`/app/projects/${project.id}/moves`}
            hasMoves={hasMoves}
          />
        ) : (
          // Not scored is not a score of zero. No meter, no number.
          <EmptyState
            title="Not analyzed yet"
            description="Vibe reads what it understands about your product, your repository and your public site, and works out what that means for the business. Nothing is judged until that runs."
          />
        )}
      </div>
    </WorkspaceSection>
  );
}
