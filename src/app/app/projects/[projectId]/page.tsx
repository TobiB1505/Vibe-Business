import { notFound } from "next/navigation";
import { PageShell } from "@/components/layout/page-shell";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/modules/auth/session";
import { getProjectWithRepository } from "@/modules/projects/queries";
import { getBusinessContext } from "@/modules/projects/business-context-store";
import { checkInstallationStillAccessible } from "@/modules/github/repositories";
import { getLatestSuccessfulSnapshot } from "@/modules/repository-intelligence/store";
import { getLatestSuccessfulLiveSnapshot } from "@/modules/live-product-intelligence/store";
import { getLatestSuccessfulAudit } from "@/modules/business-audit/store";
import { getAuditCurrency } from "@/modules/business-audit/service";
import {
  getActiveBusinessAuditOperation,
  getActiveOpportunityOperation,
} from "@/modules/operations/service";
import { getLatestOpportunities, getOpportunityReadiness } from "@/modules/opportunities/service";
import { buildAuditEvidenceNotice } from "@/modules/business-audit/evidence-notice";
import { isBrowserProviderConfigured } from "@/modules/authenticated-product-intelligence/browserbase/client";
import { getDeepScanAccessStatus } from "@/modules/authenticated-product-intelligence/service";
import {
  getLatestSession,
  getLatestSuccessfulAuthenticatedSnapshot,
} from "@/modules/authenticated-product-intelligence/store";
import { detectAuthenticatedSurfaces } from "@/modules/authenticated-product-intelligence/surface-detection";
import { buildDeepScanViewModel } from "@/modules/authenticated-product-intelligence/view";
import { AuditEvidenceNotice } from "./audit-evidence-notice";
import { OpportunitiesPanel } from "./opportunities-panel";
import { BusinessAuditSummary } from "./business-audit-summary";
import { DeepScanPanel } from "./deep-scan-panel";
import { BusinessContextForm } from "./business-context-form";
import { DisconnectButton } from "./disconnect-button";
import { InspectButton } from "./inspect-button";
import { InspectLiveButton } from "./inspect-live-button";
import { IntelligenceSummary } from "./intelligence-summary";
import { LiveIntelligenceSummary } from "./live-intelligence-summary";
import { ProductionUrlForm } from "./production-url-form";
import { RunAuditButton } from "./run-audit-button";

/**
 * The Deep Scan analysis runs inside this route segment's function, and its
 * own budget is 90 seconds (`DEFAULT_AUTHENTICATED_BUDGETS.maxDurationMs`).
 * Without this the platform default (15s on Pro) would kill the function
 * mid-analysis — the user would have signed in, been charged for a browser
 * session, and got nothing back.
 *
 * Set above the analysis budget so the budget stays the thing that ends a
 * scan, rather than the platform.
 */
export const maxDuration = 120;

/**
 * Project screen: connection status (Sprint 1), repository intelligence
 * (Sprint 2), and live product intelligence (Sprint 3).
 *
 * The two intelligence sources are shown side by side and stay
 * independent — one describes what the code contains, the other what a
 * visitor actually sees (Sprint 3 §24).
 */
export default async function ProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const session = await requireSession();
  const { projectId } = await params;

  const supabase = await createClient();
  const project = await getProjectWithRepository(supabase, projectId);

  if (!project || project.userId !== session.userId) {
    notFound();
  }

  const repository = project.repository;
  // Live probe (Sprint 1 §11): degrade gracefully — never crash — if the
  // installation was revoked/suspended on GitHub's side since connection.
  const accessible = repository ? await checkInstallationStillAccessible(repository.installationId) : false;
  const [
    latestSnapshot,
    latestLiveSnapshot,
    businessContext,
    latestAudit,
    deepScanAccess,
    latestDeepScanSnapshot,
    latestDeepScanSession,
    auditCurrency,
    activeAuditOperation,
    opportunities,
    opportunityReadiness,
    activeOpportunityOperation,
  ] = await Promise.all([
    getLatestSuccessfulSnapshot(supabase, projectId),
    getLatestSuccessfulLiveSnapshot(supabase, projectId),
    getBusinessContext(supabase, projectId),
    getLatestSuccessfulAudit(supabase, projectId),
    getDeepScanAccessStatus(supabase, { projectId, userId: session.userId }),
    getLatestSuccessfulAuthenticatedSnapshot(supabase, projectId),
    getLatestSession(supabase, projectId),
    getAuditCurrency(supabase, projectId),
    // Discovered on the server so returning to this page shows a running
    // audit rather than an inviting button (Sprint 7 §19).
    getActiveBusinessAuditOperation(supabase, projectId),
    getLatestOpportunities(supabase, projectId),
    getOpportunityReadiness(supabase, projectId),
    getActiveOpportunityOperation(supabase, projectId),
  ]);

  // Deep Scan state is derived on the server (Sprint 5 §13): entitlement,
  // cooldown and eligibility are the domain's answers, not React's.
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

  // All three evidence sources are required before a first audit
  // (Sprint 4 §29), so the UI can say exactly what is still missing rather
  // than failing after the click.
  const hasRepositoryIntelligence = Boolean(latestSnapshot?.result);
  const hasLiveProductIntelligence = Boolean(latestLiveSnapshot?.result);
  const auditReady = hasRepositoryIntelligence && hasLiveProductIntelligence && businessContext !== null;

  // Deep Scan evidence notice (Sprint 6 §11, §14). Informational: it never
  // gates the audit, and a new Deep Scan never triggers an automatic AI call.
  const auditEvidenceNotice = buildAuditEvidenceNotice({
    hasSuccessfulDeepScan: Boolean(latestDeepScanSnapshot?.result),
    authenticatedSurfacesLikely: deepScanModel?.showRecommendation ?? false,
    canStartDeepScan: deepScanModel?.canStart ?? false,
    auditPredatesDeepScan: auditCurrency.newDeepScanEvidence,
  });

  const missingPrerequisites = [
    hasRepositoryIntelligence ? null : "repository intelligence",
    hasLiveProductIntelligence ? null : "live product intelligence",
    businessContext === null ? "business context" : null,
  ].filter((item): item is string => item !== null);

  return (
    <PageShell>
      <header>
        <p className="text-sm font-medium tracking-wide text-zinc-500 uppercase">Vibe Business</p>
      </header>
      <main className="flex flex-1 flex-col justify-center gap-6">
        <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>

        {repository ? (
          <dl className="space-y-2 text-sm">
            <div className="flex gap-2">
              <dt className="w-40 shrink-0 text-zinc-500">Connected repository</dt>
              <dd>
                <a
                  href={repository.htmlUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-zinc-200 underline underline-offset-2 hover:text-zinc-50"
                >
                  {repository.fullName}
                </a>
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-40 shrink-0 text-zinc-500">Default branch</dt>
              <dd className="text-zinc-200">{repository.defaultBranch}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-40 shrink-0 text-zinc-500">Connection status</dt>
              <dd className={accessible ? "text-emerald-400" : "text-amber-400"}>
                {accessible ? "Connected" : "GitHub access unavailable"}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="text-sm text-zinc-400">No repository connected.</p>
        )}

        {/* Project context (Sprint 3 §31) — what evidence exists so far. */}
        <section className="space-y-2 rounded-md border border-zinc-800 p-4">
          <h2 className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Project context</h2>
          <dl className="space-y-1 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-zinc-500">Repository intelligence</dt>
              <dd className={latestSnapshot?.result ? "text-emerald-400" : "text-zinc-600"}>
                {latestSnapshot?.result ? "Ready" : "Not analyzed yet"}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-zinc-500">Live product intelligence</dt>
              <dd className={latestLiveSnapshot?.result ? "text-emerald-400" : "text-zinc-600"}>
                {latestLiveSnapshot?.result ? "Ready" : "Not inspected yet"}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-zinc-500">Business context</dt>
              <dd className={businessContext ? "text-emerald-400" : "text-zinc-600"}>
                {businessContext ? "Ready" : "Missing"}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-zinc-500">Deep Scan</dt>
              <dd className={latestDeepScanSnapshot?.result ? "text-emerald-400" : "text-zinc-600"}>
                {latestDeepScanSnapshot?.result ? "Ready" : "Not run yet"}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-zinc-500">Opportunities</dt>
              <dd className={opportunities ? "text-emerald-400" : "text-zinc-600"}>
                {opportunities ? `${opportunities.set.opportunities.length} identified` : "Not identified yet"}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-zinc-500">Business readiness</dt>
              <dd className={latestAudit?.result ? "text-emerald-400" : "text-zinc-600"}>
                {latestAudit?.result ? "Ready" : "Not analyzed yet"}
              </dd>
            </div>
          </dl>
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-medium text-zinc-200">Business context</h2>
          {businessContext === null && (
            <p className="text-sm text-zinc-500">
              Repository and website evidence cannot tell us who your product is for or what you are
              trying to do next.
            </p>
          )}
          <BusinessContextForm projectId={project.id} context={businessContext?.context ?? null} />
        </section>

        <section className="space-y-3">
          <AuditEvidenceNotice notice={auditEvidenceNotice} />

          {latestAudit?.result ? (
            <BusinessAuditSummary
              audit={latestAudit.result}
              analyzedAt={latestAudit.completedAt ?? latestAudit.createdAt}
            />
          ) : (
            <div className="space-y-1">
              <h2 className="text-sm font-medium text-zinc-200">Business readiness</h2>
              <p className="text-sm text-zinc-500">Not analyzed yet</p>
            </div>
          )}

          {!auditReady && (
            <p className="text-sm text-zinc-500">
              A business audit needs {missingPrerequisites.join(", ")} first.
            </p>
          )}

          <RunAuditButton
            projectId={project.id}
            hasAudit={Boolean(latestAudit?.result)}
            disabled={!auditReady}
            activeOperation={activeAuditOperation}
          />
        </section>

        <OpportunitiesPanel
          projectId={project.id}
          opportunities={opportunities?.set.opportunities ?? []}
          stale={opportunities?.stale ?? false}
          activeOperation={activeOpportunityOperation}
          blockedReason={opportunityReadiness.blockedReason}
        />

        <section className="space-y-2">
          <h2 className="text-sm font-medium text-zinc-200">Production website</h2>
          {project.productionUrl === null && (
            <p className="text-sm text-zinc-500">Not configured</p>
          )}
          <ProductionUrlForm projectId={project.id} currentUrl={project.productionUrl} />
        </section>

        {project.productionUrl && (
          <section className="space-y-3">
            {latestLiveSnapshot?.result ? (
              <LiveIntelligenceSummary
                snapshot={latestLiveSnapshot.result}
                analyzedAt={latestLiveSnapshot.completedAt ?? latestLiveSnapshot.createdAt}
              />
            ) : (
              <div className="space-y-1">
                <h2 className="text-sm font-medium text-zinc-200">Live product intelligence</h2>
                <p className="text-sm text-zinc-500">Not inspected yet</p>
              </div>
            )}
            <InspectLiveButton
              projectId={project.id}
              hasSnapshot={Boolean(latestLiveSnapshot?.result)}
            />
          </section>
        )}

        {deepScanModel && <DeepScanPanel projectId={project.id} model={deepScanModel} />}

        {repository && (
          <section className="space-y-3">
            {latestSnapshot?.result ? (
              <IntelligenceSummary snapshot={latestSnapshot.result} analyzedAt={latestSnapshot.createdAt} />
            ) : (
              <div className="space-y-1">
                <h2 className="text-sm font-medium text-zinc-200">Repository intelligence</h2>
                <p className="text-sm text-zinc-500">Not analyzed yet</p>
              </div>
            )}
            <InspectButton projectId={project.id} hasSnapshot={Boolean(latestSnapshot?.result)} />
          </section>
        )}

        <div>
          <DisconnectButton projectId={project.id} />
        </div>
      </main>
    </PageShell>
  );
}
