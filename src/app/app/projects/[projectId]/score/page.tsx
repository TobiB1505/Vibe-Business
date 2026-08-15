import { EmptyState, Notice } from "@/components/ui/states";
import { WorkspaceSection } from "@/components/layout/project-shell";
import { getAuditCurrency } from "@/modules/business-audit/service";
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
import { getBusinessContext } from "@/modules/projects/business-context-store";
import { requireProjectAccess } from "@/modules/projects/workspace-context";
import { getLatestSuccessfulSnapshot } from "@/modules/repository-intelligence/store";
import { AuditEvidenceNotice } from "../audit-evidence-notice";
import { BusinessAuditSummary } from "../business-audit-summary";
import { RunAuditButton } from "../run-audit-button";

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
    businessContext,
    deepScanAccess,
    latestDeepScanSnapshot,
    latestDeepScanSession,
  ] = await Promise.all([
    getLatestSuccessfulAudit(supabase, projectId),
    getAuditCurrency(supabase, projectId),
    // Discovered on the server so returning here shows a running audit rather
    // than an inviting button (Sprint 7 §19).
    getActiveBusinessAuditOperation(supabase, projectId),
    getLatestSuccessfulSnapshot(supabase, projectId),
    getLatestSuccessfulLiveSnapshot(supabase, projectId),
    getBusinessContext(supabase, projectId),
    getDeepScanAccessStatus(supabase, { projectId, userId }),
    getLatestSuccessfulAuthenticatedSnapshot(supabase, projectId),
    getLatestSession(supabase, projectId),
  ]);

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

  // All three evidence sources are required before a first audit
  // (Sprint 4 §29), so the UI can say exactly what is still missing rather
  // than failing after the click.
  const hasRepositoryIntelligence = Boolean(latestSnapshot?.result);
  const hasLiveProductIntelligence = Boolean(latestLiveSnapshot?.result);
  const auditReady =
    hasRepositoryIntelligence && hasLiveProductIntelligence && businessContext !== null;

  const missingPrerequisites = [
    hasRepositoryIntelligence ? null : "repository intelligence",
    hasLiveProductIntelligence ? null : "live product intelligence",
    businessContext === null ? "business context" : null,
  ].filter((item): item is string => item !== null);

  return (
    // The section id stays `business-audit`: `BUSINESS_AUDIT_ANCHOR` is a tested
    // domain constant that a blocked opportunity set links at, and that link is
    // the only way out of that state. It now resolves on this route.
    <WorkspaceSection
      id="business-audit"
      title="Business score"
      description="How business-ready this product is, per dimension, with the evidence behind each score."
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

        {!auditReady && (
          <Notice tone="waiting" label="Why this is blocked">
            A business audit needs {missingPrerequisites.join(", ")} first.
          </Notice>
        )}

        {latestAudit?.result ? (
          <BusinessAuditSummary
            audit={latestAudit.result}
            analyzedAt={latestAudit.completedAt ?? latestAudit.createdAt}
          />
        ) : (
          // Not scored is not a score of zero. No meter, no number.
          <EmptyState
            title="Not analyzed yet"
            description="Vibe scores five business dimensions from your repository, your public product and the context you gave it. Nothing is scored until that runs."
          />
        )}
      </div>
    </WorkspaceSection>
  );
}
