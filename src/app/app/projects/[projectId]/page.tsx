import { notFound } from "next/navigation";
import {
  ProjectHeader,
  ProjectShell,
  ProjectSidebar,
  WorkspaceSection,
  type ProjectNavItem,
} from "@/components/layout/project-shell";
import { Metric } from "@/components/ui/metric";
import { EmptyState, Notice } from "@/components/ui/states";
import { StatusPill } from "@/components/ui/status-pill";
import { Surface } from "@/components/ui/surface";
import { MonoLabel } from "@/components/ui/typography";
import { formatTimestamp } from "@/lib/utils/format-datetime";
import { listAuditEventsForProject } from "@/modules/audit-log/queries";
import { buildActivityFeed } from "@/modules/audit-log/view";
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
import {
  getActivePreparationFor,
  getLatestFailedPreparationFor,
  getOpportunityExecutionSummaries,
} from "@/modules/execution/service";
import { buildOpportunityActionState } from "@/modules/execution/view";
import { buildBranchUrl } from "@/modules/execution/diff";
import { OPERATION_FAILURE_MESSAGES } from "@/modules/operations/messages";
import { getLatestValidation } from "@/modules/validation/service";
import { SANDBOX_POLICY_VERSION } from "@/modules/validation/schema";
import { buildValidationSummary } from "@/modules/validation/view";
import { getPreparedChangeWorkspace } from "@/modules/execution/workspace";
import { getProjectImpact } from "@/modules/business-measurement/project-impact";
import type { OutcomeCardState } from "@/modules/outcome-verification/view";
import { PreparedChangesSection, type PreparedChangeCard } from "./prepared-changes-section";
import type { ValidationSummary } from "./validation-panel";
import { buildAuditEvidenceNotice } from "@/modules/business-audit/evidence-notice";
import { isBrowserProviderConfigured } from "@/modules/authenticated-product-intelligence/browserbase/client";
import { getDeepScanAccessStatus } from "@/modules/authenticated-product-intelligence/service";
import {
  getLatestSession,
  getLatestSuccessfulAuthenticatedSnapshot,
} from "@/modules/authenticated-product-intelligence/store";
import { detectAuthenticatedSurfaces } from "@/modules/authenticated-product-intelligence/surface-detection";
import { buildDeepScanViewModel } from "@/modules/authenticated-product-intelligence/view";
import { ActivityFeed } from "./activity-feed";
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
 * Outcome states as one short phrase each, for the Impact summary row.
 *
 * Deliberately the same words the Outcome panel already uses, rather than new
 * ones: two places describing one state differently is how a product starts
 * disagreeing with itself. In particular `failed` stays a statement about
 * *Vibe* — it never says the customer's product failed.
 */
const OUTCOME_LABELS: Record<OutcomeCardState, string> = {
  unavailable: "Not applicable",
  not_started: "Not yet verified in production",
  observing: "Checking production…",
  verified: "Production outcome verified",
  partial: "Partly observed",
  not_observed: "Not observed within verification window",
  failed: "Vibe could not check",
};

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
    executionSummaries,
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
    getOpportunityExecutionSummaries(supabase, projectId),
  ]);

  // Execution state per opportunity, resolved here so the browser renders an
  // answer rather than deciding whether Vibe has an executor (Sprint 9C §2).
  const executionStates: Record<string, ReturnType<typeof buildOpportunityActionState>> = {};
  const branchUrls: Record<string, string> = {};
  // Isolated validation state per prepared change (Sprint 10A §44), resolved
  // server-side for the same reason execution state is: the browser renders an
  // answer, it does not decide what Vibe is willing to run.
  const validationSummaries: Record<string, ValidationSummary> = {};

  for (const summary of executionSummaries) {
    const opportunity = opportunities?.set.opportunities.find(
      (entry) => entry.id === summary.opportunityId,
    );
    if (!opportunity) continue;

    executionStates[summary.opportunityId] = buildOpportunityActionState({
      opportunity,
      capability: summary.capability,
      preparedChangeId: summary.preparedChangeId,
      activeOperation: await getActivePreparationFor(supabase, {
        projectId,
        opportunityId: summary.opportunityId,
      }),
      // Without this a failed preparation silently re-offers the start button
      // instead of saying what went wrong.
      failedOperation: await getLatestFailedPreparationFor(supabase, {
        projectId,
        opportunityId: summary.opportunityId,
      }),
      blockedReason: null,
    });

    if (summary.branchName && repository) {
      branchUrls[summary.opportunityId] = buildBranchUrl(repository.fullName, summary.branchName);
    }

    if (summary.preparedChangeId) {
      const validation = await getLatestValidation(supabase, {
        projectId,
        preparedChangeId: summary.preparedChangeId,
      });

      if (validation) {
        validationSummaries[summary.opportunityId] = buildValidationSummary(validation, {
          currentPolicyVersion: SANDBOX_POLICY_VERSION,
          failureMessage: validation.failureCode
            ? (OPERATION_FAILURE_MESSAGES[validation.failureCode] ?? null)
            : null,
        });
      }
    }
  }

  /**
   * Prepared changes, assembled by the workspace read model (Sprint UI-2
   * Phase B) rather than inline here.
   *
   * This is the expensive read on this page: per change it touches validation,
   * preview, review, approval, outcome and impact, plus — for an approved
   * change — the read-only GitHub merge preflight, signed review-image URLs and
   * a sandbox origin lookup. It stayed a page-level concern for as long as the
   * workspace was one page. It is now callable on its own, which is what lets a
   * future `/score` or `/activity` route not pay for it.
   */
  const preparedChangeCards: PreparedChangeCard[] = await getPreparedChangeWorkspace(supabase, {
    projectId,
    userId: session.userId,
    repositoryFullName: repository?.fullName ?? null,
  });

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

  /**
   * Evidence readiness (Sprint 3 §31), as one list rather than six ad-hoc rows.
   * Each entry is derived from a snapshot that either exists or does not — no
   * state here is inferred, and "not yet" is never dressed up as a problem.
   */
  const contextRows: { label: string; ready: boolean; detail: string }[] = [
    {
      label: "Repository intelligence",
      ready: Boolean(latestSnapshot?.result),
      detail: latestSnapshot?.result ? "Ready" : "Not analyzed yet",
    },
    {
      label: "Live product intelligence",
      ready: Boolean(latestLiveSnapshot?.result),
      detail: latestLiveSnapshot?.result ? "Ready" : "Not inspected yet",
    },
    {
      label: "Business context",
      ready: Boolean(businessContext),
      detail: businessContext ? "Ready" : "Missing",
    },
    {
      label: "Deep Scan",
      ready: Boolean(latestDeepScanSnapshot?.result),
      detail: latestDeepScanSnapshot?.result ? "Ready" : "Not run yet",
    },
    {
      label: "Opportunities",
      ready: Boolean(opportunities),
      detail: opportunities
        ? `${opportunities.set.opportunities.length} identified`
        : "Not identified yet",
    },
    {
      label: "Business readiness",
      ready: Boolean(latestAudit?.result),
      detail: latestAudit?.result ? "Ready" : "Not analyzed yet",
    },
  ];

  const opportunityCount = opportunities?.set.opportunities.length ?? null;

  /**
   * Activity (Sprint UI-2 Phase A). One bounded, indexed read against the
   * caller's own RLS-scoped client — no provider call, no AI, no GitHub.
   * `session.userId` is the verified session's, and project ownership was
   * already established above, so this cannot reach another account's log.
   */
  const activity = await listAuditEventsForProject(supabase, {
    projectId: project.id,
    userId: session.userId,
  });
  const activityEntries = buildActivityFeed(activity.events);

  /**
   * The workspace navigation. Counts come from data already loaded for this
   * render — never a placeholder, and never a zero standing in for "unknown":
   * a project with no opportunity set yet gets `null` and shows no badge at all.
   *
   * `href` is an in-page anchor. UI-1 deliberately keeps one route
   * (`/app/projects/[projectId]`) and splits it into sections; the route split
   * is a later sprint, and inventing `/score` here would produce dead links.
   */
  const navItems: ProjectNavItem[] = [
    { id: "overview", label: "Overview", href: "#overview" },
    { id: "business-audit", label: "Business score", href: "#business-audit" },
    {
      id: "next-moves",
      label: "Next moves",
      href: "#next-moves",
      count: opportunityCount,
      countTone: "accent",
    },
    {
      id: "prepared",
      label: "Prepared",
      href: "#prepared",
      count: preparedChangeCards.length > 0 ? preparedChangeCards.length : null,
    },
    { id: "deep-scan", label: "Deep Scan", href: "#deep-scan" },
    { id: "impact", label: "Impact", href: "#impact" },
    { id: "activity", label: "Activity", href: "#activity" },
  ];

  /**
   * Project impact (Sprint UI-2 Phase C). Its own read model rather than a
   * filter over the prepared cards: Impact needs merge state, outcome and
   * measurement, and none of the review images, preview origins or validation
   * detail that the prepared workspace pays for.
   *
   * On this page both are loaded because both sections are rendered. The point
   * of the separation is that a future `/impact` route can call only this one.
   */
  const projectImpact = await getProjectImpact(supabase, {
    projectId,
    userId: session.userId,
    repositoryConnected: repository !== null,
  });

  return (
    <ProjectShell
      sidebar={
        <ProjectSidebar
          projectName={project.name}
          repositoryFullName={repository?.fullName ?? null}
          tone={repository ? (accessible ? "active" : "waiting") : "neutral"}
          items={navItems}
        />
      }
    >
      <ProjectHeader
        projectName={project.name}
        title={project.name}
        meta={
          repository ? (
            <>
              <a
                href={repository.htmlUrl}
                target="_blank"
                rel="noreferrer"
                className="text-fg-body hover:text-fg rounded-sm font-mono text-xs underline underline-offset-4 transition-colors"
              >
                {repository.fullName}
              </a>
              <span className="text-fg-muted font-mono text-xs">{repository.defaultBranch}</span>
              {/* The word carries the state, so the colour is never the only
                  signal — and "GitHub access unavailable" stays the product's
                  existing wording rather than a friendlier, vaguer one. */}
              <StatusPill tone={accessible ? "success" : "waiting"} dot>
                {accessible ? "Connected" : "GitHub access unavailable"}
              </StatusPill>
            </>
          ) : (
            <StatusPill tone="neutral">No repository connected</StatusPill>
          )
        }
      />

      <div className="flex flex-col gap-14 px-5 py-8 sm:px-8 sm:py-10">
        <WorkspaceSection
          id="overview"
          title="Overview"
          description="What Vibe knows about this project so far, and where that knowledge came from."
        >
          <div className="flex flex-col gap-5">
            <Surface level="panel" padding="lg" className="flex flex-col gap-4">
              <MonoLabel>Project context</MonoLabel>
              <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
                {contextRows.map((row) => (
                  <div
                    key={row.label}
                    className="border-line-1 flex items-baseline justify-between gap-3 border-b pb-3"
                  >
                    <dt className="text-fg-secondary text-sm">{row.label}</dt>
                    <dd
                      className={`font-mono text-xs ${row.ready ? "text-mint" : "text-fg-meta"}`}
                    >
                      {row.detail}
                    </dd>
                  </div>
                ))}
              </dl>
            </Surface>

            <Surface level="section" padding="lg" className="flex flex-col gap-3">
              <div className="flex flex-col gap-2">
                <h3 className="text-fg text-base font-semibold">Business context</h3>
                {businessContext === null && (
                  <p className="text-fg-muted max-w-[70ch] text-sm">
                    Repository and website evidence cannot tell us who your product is for or what
                    you are trying to do next.
                  </p>
                )}
              </div>
              <BusinessContextForm
                projectId={project.id}
                context={businessContext?.context ?? null}
              />
            </Surface>

            <Surface level="section" padding="lg" className="flex flex-col gap-3">
              <div className="flex flex-col gap-2">
                <h3 className="text-fg text-base font-semibold">Production website</h3>
                {project.productionUrl === null && (
                  <p className="text-fg-muted text-sm">Not configured</p>
                )}
              </div>
              <ProductionUrlForm projectId={project.id} currentUrl={project.productionUrl} />
            </Surface>

            {project.productionUrl && (
              <Surface level="section" padding="lg" className="flex flex-col gap-4">
                {latestLiveSnapshot?.result ? (
                  <LiveIntelligenceSummary
                    snapshot={latestLiveSnapshot.result}
                    analyzedAt={latestLiveSnapshot.completedAt ?? latestLiveSnapshot.createdAt}
                  />
                ) : (
                  <div className="flex flex-col gap-1">
                    <h3 className="text-fg text-base font-semibold">Live product intelligence</h3>
                    <p className="text-fg-muted text-sm">Not inspected yet</p>
                  </div>
                )}
                <div>
                  <InspectLiveButton
                    projectId={project.id}
                    hasSnapshot={Boolean(latestLiveSnapshot?.result)}
                  />
                </div>
              </Surface>
            )}

            {repository && (
              <Surface level="section" padding="lg" className="flex flex-col gap-4">
                {latestSnapshot?.result ? (
                  <IntelligenceSummary
                    snapshot={latestSnapshot.result}
                    analyzedAt={latestSnapshot.createdAt}
                  />
                ) : (
                  <div className="flex flex-col gap-1">
                    <h3 className="text-fg text-base font-semibold">Repository intelligence</h3>
                    <p className="text-fg-muted text-sm">Not analyzed yet</p>
                  </div>
                )}
                <div>
                  <InspectButton
                    projectId={project.id}
                    hasSnapshot={Boolean(latestSnapshot?.result)}
                  />
                </div>
              </Surface>
            )}

            <div className="border-line-1 flex flex-wrap items-center justify-between gap-4 border-t pt-6">
              <p className="text-fg-muted text-xs">
                Disconnecting removes Vibe&apos;s access to this repository.
              </p>
              <DisconnectButton projectId={project.id} />
            </div>
          </div>
        </WorkspaceSection>

        {/* The section id is the jump target a blocked Opportunities set links
            to (`BUSINESS_AUDIT_ANCHOR`), supplied by `WorkspaceSection`. */}
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

        <WorkspaceSection
          id="next-moves"
          title={opportunityCount ? "Next moves" : "Opportunities"}
          description="A short, ranked list — not a report. The order is the engine's, and it is shown as produced."
        >
          <OpportunitiesPanel
            projectId={project.id}
            opportunities={opportunities?.set.opportunities ?? []}
            executionStates={executionStates}
            branchUrls={branchUrls}
            validationSummaries={validationSummaries}
            stale={opportunities?.stale ?? false}
            activeOperation={activeOpportunityOperation}
            blockedReason={opportunityReadiness.blockedReason}
          />
        </WorkspaceSection>

        <WorkspaceSection
          id="prepared"
          title="Prepared"
          description="Each change moves through validation, preview, review and your approval before anything can be merged."
        >
          {preparedChangeCards.length > 0 ? (
            <PreparedChangesSection projectId={project.id} changes={preparedChangeCards} />
          ) : (
            <EmptyState
              title="Nothing prepared yet"
              description="When you let Vibe act on one of your next moves, the prepared change appears here with its validation, preview, review and approval state."
            />
          )}
        </WorkspaceSection>

        <WorkspaceSection
          id="deep-scan"
          title="Deep Scan"
          description="What your product looks like after signing in — the part repository and public-page evidence cannot reach."
        >
          {deepScanModel ? (
            <DeepScanPanel projectId={project.id} model={deepScanModel} />
          ) : (
            <EmptyState
              title="Deep Scan is unavailable for this project"
              description="Deep Scan needs a connected repository and a configured production website before it can sign in to anything."
            />
          )}
        </WorkspaceSection>

        <WorkspaceSection
          id="impact"
          title="Impact"
          description="What actually changed after a merge — and what Vibe refuses to claim it caused."
        >
          {projectImpact.entries.length > 0 ? (
            <div className="flex flex-col gap-4">
              <Surface level="section" padding="lg" className="flex flex-col gap-4">
                <MonoLabel>Merged changes</MonoLabel>
                <ul className="flex flex-col gap-3">
                  {projectImpact.entries.map((entry) => (
                    <li
                      key={entry.preparedChangeId}
                      className="border-line-1 flex flex-wrap items-center gap-x-6 gap-y-2 border-b pb-3 last:border-b-0 last:pb-0"
                    >
                      {/* `Metric` renders an em dash for an absent value, so a
                          change without a recorded commit stays honest rather
                          than showing a truncated empty string. */}
                      <Metric label="Commit" value={entry.commitSha?.slice(0, 7)} mono />
                      <Metric label="Branch" value={entry.baseBranch} mono />
                      <Metric label="Merged" value={formatTimestamp(entry.mergedAt)} mono />
                      <Metric label="Production outcome" value={OUTCOME_LABELS[entry.outcome.state]} />
                      <a
                        href="#prepared"
                        className="text-fg-prose hover:text-fg ml-auto rounded-sm text-sm underline underline-offset-4 transition-colors"
                      >
                        See its outcome
                      </a>
                    </li>
                  ))}
                </ul>
              </Surface>
              {/* Deliberately a pointer rather than a copy: outcome
                  verification and business measurement are rendered per
                  prepared change, and duplicating those panels here would mean
                  two places claiming the same result. */}
              <p className="text-fg-muted text-sm">
                Production outcome and business impact are shown on each prepared change, beside the
                merge that produced them.
              </p>
            </div>
          ) : (
            <EmptyState
              title="Nothing merged yet"
              description="Impact can only be measured after a change of Vibe's has been approved and merged. Until then there is nothing to compare against, and Vibe will not estimate one."
            />
          )}
        </WorkspaceSection>

        <WorkspaceSection
          id="activity"
          title="Activity"
          description="The append-only record of what Vibe did, when, and with what result."
        >
          <ActivityFeed entries={activityEntries} hasMore={activity.hasMore} />
        </WorkspaceSection>
      </div>
    </ProjectShell>
  );
}
