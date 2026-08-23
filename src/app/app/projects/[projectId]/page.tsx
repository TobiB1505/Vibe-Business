import Link from "next/link";
import { WorkspaceSection, projectSectionHref } from "@/components/layout/project-shell";
import { Surface } from "@/components/ui/surface";
import { MonoLabel } from "@/components/ui/typography";
import { listAuditEventsForProject } from "@/modules/audit-log/queries";
import { buildActivityFeed } from "@/modules/audit-log/view";
import { getLatestSuccessfulAudit } from "@/modules/business-audit/store";
import { listPreparedChangeSummaries } from "@/modules/execution/workspace";
import { getLatestOpportunities } from "@/modules/opportunities/service";
import { getLatestProfile } from "@/modules/product-understanding/store";
import { buildHomeView } from "@/modules/projects/command-center";
import { requireProjectAccess } from "@/modules/projects/workspace-context";
import { formatTimestamp } from "@/lib/utils/format-datetime";
import { HomeStatus } from "./home-status";

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
 * Below the card there is one thing: the last few actions on this project, and
 * a link to the rest. Overview's evidence surfaces — the repository and live
 * product summaries, and the readiness rows above them — moved to My Product,
 * which is where a founder goes to ask what Vibe knows and where it came from.
 *
 * ## Cost
 *
 * Less than Overview paid: the two intelligence snapshot reads and the Deep
 * Scan read left with the surfaces that used them. What remains is the latest
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
    productProfile,
    latestAudit,
    opportunities,
    preparedSummaries,
    activity,
  ] = await Promise.all([
    getLatestProfile(supabase, projectId),
    getLatestSuccessfulAudit(supabase, projectId),
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

      </div>
    </WorkspaceSection>
  );
}
