import Link from "next/link";
import { WorkspaceSection, projectSectionHref } from "@/components/layout/project-shell";
import { Surface } from "@/components/ui/surface";
import { MonoLabel } from "@/components/ui/typography";
import { listAuditEventsForProject } from "@/modules/audit-log/queries";
import { buildActivityFeed } from "@/modules/audit-log/view";
import { getLatestSuccessfulAudit } from "@/modules/business-audit/store";
import { listPreparedChangeSummaries } from "@/modules/execution/workspace";
import { getLatestSuccessfulLiveSnapshot } from "@/modules/live-product-intelligence/store";
import { getLatestOpportunities } from "@/modules/opportunities/service";
import { getLatestProfile } from "@/modules/product-understanding/store";
import { requireProjectAccess } from "@/modules/projects/workspace-context";
import { getLatestSuccessfulSnapshot } from "@/modules/repository-intelligence/store";
import { getLatestSuccessfulAuthenticatedSnapshot } from "@/modules/authenticated-product-intelligence/store";
import { formatTimestamp } from "@/lib/utils/format-datetime";
import { InspectButton } from "./inspect-button";
import { InspectLiveButton } from "./inspect-live-button";
import { IntelligenceSummary, LIVE_PRODUCT_ANCHOR } from "./intelligence-summary";
import { LiveIntelligenceSummary } from "./live-intelligence-summary";

/**
 * Overview (Sprint UI-2 Part 2).
 *
 * ## A summary, not the workspace
 *
 * Before the split this route rendered all seven sections and loaded
 * everything they needed. It now loads *summaries*: the latest audit's score,
 * how many opportunities exist, how many prepared changes exist, whether a Deep
 * Scan has run, and the few most recent activity entries. Each links to the
 * route that owns the detail.
 *
 * The expensive reads it no longer performs: the prepared-change workspace
 * (review-image signing, preview origins, the GitHub merge preflight, outcome
 * and impact per change), and the per-opportunity execution assembly.
 * `listPreparedChangeSummaries` is the cheap read that replaces the first — it
 * exists precisely so a count does not cost a workspace.
 *
 * What stays here in full: the evidence and connection surfaces that are about
 * the project itself rather than about one section — business context, the
 * production URL, both intelligence snapshots, and disconnecting.
 */

const RECENT_ACTIVITY_COUNT = 5;

export default async function ProjectOverviewPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const { supabase, userId, project } = await requireProjectAccess(projectId);

  const [
    latestSnapshot,
    latestLiveSnapshot,
    productProfile,
    latestAudit,
    latestDeepScanSnapshot,
    opportunities,
    preparedSummaries,
    activity,
  ] = await Promise.all([
    getLatestSuccessfulSnapshot(supabase, projectId),
    getLatestSuccessfulLiveSnapshot(supabase, projectId),
    getLatestProfile(supabase, projectId),
    getLatestSuccessfulAudit(supabase, projectId),
    getLatestSuccessfulAuthenticatedSnapshot(supabase, projectId),
    getLatestOpportunities(supabase, projectId),
    listPreparedChangeSummaries(supabase, {
      projectId,
      repositoryFullName: project.repository?.fullName ?? null,
    }),
    listAuditEventsForProject(supabase, {
      projectId,
      userId,
      limit: RECENT_ACTIVITY_COUNT,
    }),
  ]);

  const recentActivity = buildActivityFeed(activity.events);

  /**
   * Evidence readiness (Sprint 3 §31). Each entry is derived from a snapshot
   * that either exists or does not — no state here is inferred, and "not yet"
   * is never dressed up as a problem.
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
      // CORE-2 §3: the audit reasons from Vibe's understanding of the product,
      // not from a paragraph the founder typed. This row reports that
      // understanding, and it is never "Missing" — only "Not built yet".
      label: "Product understanding",
      ready: productProfile !== null,
      detail: productProfile ? "Ready" : "Not built yet",
    },
    {
      label: "Deep Scan",
      ready: Boolean(latestDeepScanSnapshot?.result),
      detail: latestDeepScanSnapshot?.result ? "Ready" : "Not run yet",
    },
  ];

  /**
   * The summary tiles. Every value is real or absent — a project with no
   * opportunity set shows "Not identified yet", never a zero, because zero
   * opportunities and "never asked" are different statements.
   */
  const summaries: { id: string; label: string; value: string; href: string }[] = [
    {
      id: "business-audit",
      label: "Business health",
      value: latestAudit?.result
        ? latestAudit.result.overall.score === null
          ? "Not enough coverage"
          : `${latestAudit.result.overall.score} / 100`
        : "Not analyzed yet",
      href: projectSectionHref(project.id, "business-audit"),
    },
    {
      id: "action-plan",
      label: "Action plan",
      value: opportunities
        ? `${opportunities.set.opportunities.length} identified`
        : "Not identified yet",
      href: projectSectionHref(project.id, "action-plan"),
    },
    {
      id: "agent",
      label: "Agent",
      value:
        preparedSummaries.length > 0
          ? `${preparedSummaries.length} ${preparedSummaries.length === 1 ? "change" : "changes"}`
          : "None yet",
      href: projectSectionHref(project.id, "agent"),
    },
  ];

  return (
    <WorkspaceSection
      id="home"
      title="Home"
      description="Where your product stands right now, and the next move Vibe would make."
    >
      <div className="flex flex-col gap-5">
        <ul className="grid gap-4 sm:grid-cols-3">
          {summaries.map((summary) => (
            <li key={summary.id}>
              <Link
                href={summary.href}
                className="rounded-panel bg-surface-3 border-line-3 hover:border-line-4 flex h-full flex-col gap-2 border p-5 transition-[border-color]"
              >
                <MonoLabel>{summary.label}</MonoLabel>
                <span className="text-fg text-title font-bold">{summary.value}</span>
              </Link>
            </li>
          ))}
        </ul>

        <Surface level="panel" padding="lg" className="flex flex-col gap-4">
          <MonoLabel>Project context</MonoLabel>
          <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
            {contextRows.map((row) => (
              <div
                key={row.label}
                className="border-line-1 flex items-baseline justify-between gap-3 border-b pb-3"
              >
                <dt className="text-fg-secondary text-sm">{row.label}</dt>
                <dd className={`font-mono text-xs ${row.ready ? "text-mint" : "text-fg-meta"}`}>
                  {row.detail}
                </dd>
              </div>
            ))}
          </dl>
        </Surface>

        {recentActivity.length > 0 && (
          <Surface level="section" padding="lg" className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between gap-4">
              <MonoLabel>Recent activity</MonoLabel>
              <Link
                href={projectSectionHref(project.id, "activity")}
                className="text-fg-muted hover:text-fg-body rounded-sm text-xs underline underline-offset-4 transition-interactive"
              >
                See all
              </Link>
            </div>
            <ul className="flex flex-col gap-2">
              {recentActivity.map((entry) => (
                <li key={entry.id} className="flex items-baseline justify-between gap-4">
                  <span className="text-fg-secondary truncate text-sm">{entry.title}</span>
                  <time
                    dateTime={entry.at}
                    className="text-fg-meta shrink-0 font-mono text-meta"
                  >
                    {formatTimestamp(entry.at) ?? entry.at}
                  </time>
                </li>
              ))}
            </ul>
          </Surface>
        )}

        {project.productionUrl && (
          <Surface
            // The anchor repository findings link to when only a live check
            // could settle the question (UI-3.6 §39). `scroll-mt` clears the
            // sticky workspace header, as `WorkspaceSection` does.
            id={LIVE_PRODUCT_ANCHOR}
            level="section"
            padding="lg"
            className="scroll-mt-40 flex flex-col gap-4 lg:scroll-mt-32"
          >
            {latestLiveSnapshot?.result ? (
              <LiveIntelligenceSummary
                snapshot={latestLiveSnapshot.result}
                analyzedAt={latestLiveSnapshot.completedAt ?? latestLiveSnapshot.createdAt}
              />
            ) : (
              <div className="flex flex-col gap-1">
                <MonoLabel>What Vibe sees when it visits your product · Live product check</MonoLabel>
                <h3 className="text-fg text-base font-semibold">
                  Vibe hasn&apos;t visited your product yet.
                </h3>
                <p className="text-fg-muted max-w-[70ch] text-sm">
                  A live check shows what a visitor can actually reach — which is the only way to
                  confirm what your code suggests.
                </p>
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

        {project.repository && (
          <Surface level="section" padding="lg" className="flex flex-col gap-4">
            {latestSnapshot?.result ? (
              <IntelligenceSummary
                snapshot={latestSnapshot.result}
                analyzedAt={latestSnapshot.createdAt}
                projectId={project.id}
                // Passed only so the two layers can be compared where they
                // disagree (UI-3.6 §11). Live results are rendered above.
                liveSnapshot={latestLiveSnapshot?.result ?? null}
              />
            ) : (
              <div className="flex flex-col gap-1">
                <MonoLabel>What Vibe learned from your code · Repository intelligence</MonoLabel>
                <h3 className="text-fg text-base font-semibold">
                  Vibe hasn&apos;t read your code yet.
                </h3>
                <p className="text-fg-muted max-w-[70ch] text-sm">
                  Reading it is how Vibe works out what your product already does, and what it is
                  missing.
                </p>
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

      </div>
    </WorkspaceSection>
  );
}
