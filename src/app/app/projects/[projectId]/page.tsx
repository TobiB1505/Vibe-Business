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
import { buildHomeView } from "@/modules/projects/command-center";
import { requireProjectAccess } from "@/modules/projects/workspace-context";
import { getLatestSuccessfulSnapshot } from "@/modules/repository-intelligence/store";
import { getLatestSuccessfulAuthenticatedSnapshot } from "@/modules/authenticated-product-intelligence/store";
import { formatTimestamp } from "@/lib/utils/format-datetime";
import { HomeStatus } from "./home-status";
import { InspectButton } from "./inspect-button";
import { InspectLiveButton } from "./inspect-live-button";
import { IntelligenceSummary, LIVE_PRODUCT_ANCHOR } from "./intelligence-summary";
import { LiveIntelligenceSummary } from "./live-intelligence-summary";

/**
 * Home (Sprint UI-2 Part 2 as Overview; rebuilt by CORE-5).
 *
 * ## What this screen is for
 *
 * Overview answered "what does Vibe know about this project, and where did it
 * come from" — a provenance screen, and a reasonable one, but not what someone
 * opening their own product at nine in the morning wants first. Home answers
 * four questions instead: what your product is, how the business is doing, what
 * is most in the way, and what to do about it. `HomeStatus` is those four, and
 * `buildHomeView` decides them in testable data rather than in JSX.
 *
 * Everything below the card is context: the evidence Vibe is working from, and
 * the last few things it did.
 *
 * ## Cost
 *
 * The same reads Overview made, unchanged. It loads *summaries*: the latest
 * audit, the opportunity set, a prepared-change count, and the few most recent
 * activity entries.
 *
 * The expensive reads it does not perform: the prepared-change workspace
 * (review-image signing, preview origins, the GitHub merge preflight, outcome
 * and impact per change), and the per-opportunity execution assembly.
 * `listPreparedChangeSummaries` is the cheap read that replaces the first — it
 * exists precisely so a count does not cost a workspace.
 */

const RECENT_ACTIVITY_COUNT = 5;

export default async function ProjectHomePage({
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

  const home = buildHomeView({
    profile: productProfile?.profile ?? null,
    audit: latestAudit?.result ?? null,
    // Null when the engine has never produced a set — which is a different
    // fact from a set that came back empty, and the view model keeps them
    // apart.
    opportunities: opportunities?.set.opportunities ?? null,
    preparedCount: preparedSummaries.length,
  });

  return (
    <WorkspaceSection
      id="home"
      title="Home"
      description="Where your product stands right now, and the next move Vibe would make."
    >
      <div className="flex flex-col gap-5">
        <HomeStatus
          view={home}
          planHref={projectSectionHref(project.id, "action-plan")}
          agentHref={projectSectionHref(project.id, "agent")}
          productHref={projectSectionHref(project.id, "my-product")}
          healthHref={projectSectionHref(project.id, "business-audit")}
        />

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
