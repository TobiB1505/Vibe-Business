import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { buttonClasses } from "@/components/ui/button";
import { Notice } from "@/components/ui/states";
import { Surface } from "@/components/ui/surface";
import { MonoLabel } from "@/components/ui/typography";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/modules/auth/session";
import { buildActivityEntry } from "@/modules/audit-log/view";
import { buildAttentionItems } from "@/modules/projects/attention";
import { getDashboardOverview } from "@/modules/projects/dashboard";
import { getOnboardingRouting } from "@/modules/onboarding/store";
import { AttentionList } from "./attention-list";
import { DashboardActivity, type DashboardActivityEntry } from "./dashboard-activity";
import { ProjectRow } from "./project-list";

/**
 * The global dashboard (Sprint UI-3).
 *
 * ## What changed
 *
 * `/app` answered "which projects do I have". It now answers "what needs my
 * attention", and the section order is the argument: attention, then projects,
 * then activity. A project list is what you fall back to when nothing is
 * pending — not the first thing the product says.
 *
 * ## Cost
 *
 * Two constant-cost read models regardless of how many projects exist: the
 * dashboard summary and one resumable-onboarding lookup. Neither ever builds a
 * prepared workspace, signs a review image, asks a
 * sandbox provider for anything, runs a GitHub merge preflight, or reads an
 * audit's JSONB document. `dashboard-contract.test.ts` asserts that.
 */

const CONNECT_ERROR_MESSAGES: Record<string, string> = {
  oauth_denied: "GitHub authorization was cancelled or denied.",
  state_invalid: "That connection attempt expired or was invalid. Please try connecting GitHub again.",
  missing_params: "GitHub didn't return the information needed to complete the connection. Please try again.",
  installation_not_accessible:
    "That GitHub installation isn't accessible to your GitHub account. Please try again.",
  github_unavailable: "GitHub is temporarily unavailable. Please try again in a moment.",
};

/**
 * The empty dashboard is the product's first real sentence to a new user, so
 * it says what Vibe does rather than that a list is empty. It links the
 * existing connect flow and introduces nothing new.
 */
function EmptyDashboard() {
  return (
    <Surface level="card" padding="lg" className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <MonoLabel>Get started</MonoLabel>
        <h2 className="text-fg text-headline max-w-[24ch] font-bold text-balance">
          Turn what you built into a business.
        </h2>
        <p className="text-fg-prose max-w-[60ch] text-sm leading-relaxed">
          Connect a repository you have already built. Vibe reads the product, scores the business
          around it, and shows you what to do next. Read-only to start — nothing is written to your
          code until you approve a change.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <Link href="/app/connect/github" className={buttonClasses()}>
          Connect GitHub
        </Link>
        <span className="text-fg-meta text-xs">Opens GitHub · takes about a minute</span>
      </div>
    </Surface>
  );
}

export default async function AppHomePage({
  searchParams,
}: {
  searchParams: Promise<{ connect_error?: string }>;
}) {
  const session = await requireSession();
  const { connect_error: connectError } = await searchParams;

  const supabase = await createClient();
  const { projects, recentActivity } = await getDashboardOverview(supabase, session.userId);

  /*
   * First login and interrupted activation resolve on the server. Connection
   * errors stay visible instead of being swallowed by a redirect loop.
   *
   * The takeover ends the moment a founder has finished setup once. Before
   * that there is nothing else to show them, so resuming is the only sensible
   * destination; after it, unfinished setup on a second project is an offer —
   * it is rendered below rather than routed to. The first version redirected on
   * any unfinished project, which made the workspace unreachable for exactly
   * the person who least needed the flow.
   */
  const routing =
    projects.length === 0
      ? { resumableProjectId: null, hasCompleted: false }
      : await getOnboardingRouting(supabase, projects.map((project) => project.id));

  if (!connectError && !routing.hasCompleted) {
    if (projects.length === 0) redirect("/app/onboarding");
    if (routing.resumableProjectId) redirect(`/app/onboarding/${routing.resumableProjectId}`);
  }

  const unfinishedSetup = routing.hasCompleted ? routing.resumableProjectId : null;

  const attention = buildAttentionItems(projects);
  const projectNames = new Map(projects.map((project) => [project.id, project.name]));

  const activityEntries: DashboardActivityEntry[] = recentActivity.map((event) => ({
    ...buildActivityEntry(event),
    projectId: event.projectId,
    // Only ever a project the caller owns — `projects` is the same RLS-scoped
    // read the events were filtered by.
    projectName: projectNames.get(event.projectId) ?? "",
  }));

  /**
   * The headline states a fact or says there is nothing. No greeting by name
   * and no time of day: the session carries an email, not a name, and the
   * server's clock is not the user's. Inventing either would be exactly the
   * fake personalisation this product avoids.
   */
  const headline =
    projects.length === 0
      ? "Welcome to Vibe Business."
      : attention.length === 0
        ? "Nothing needs your attention."
        : `${attention.length} ${attention.length === 1 ? "thing needs" : "things need"} your attention.`;

  return (
    <AppShell email={session.email}>
      <div className="flex flex-col gap-10">
        {connectError && (
          <Notice tone="problem" label="Connection failed">
            {CONNECT_ERROR_MESSAGES[connectError] ?? "GitHub connection failed. Please try again."}
          </Notice>
        )}

        {unfinishedSetup && (
          <Notice
            label="Setup not finished"
            action={
              <Link
                href={`/app/onboarding/${unfinishedSetup}`}
                className={buttonClasses({ variant: "secondary", size: "sm" })}
              >
                Continue setup
              </Link>
            }
          >
            {projectNames.get(unfinishedSetup) ?? "One of your projects"} hasn&rsquo;t finished
            setup. You can pick it up whenever you want — nothing is lost in the meantime.
          </Notice>
        )}

        <header className="flex flex-col gap-2">
          <h1 className="text-fg text-headline sm:text-display font-bold text-balance">
            {headline}
          </h1>
          {projects.length > 0 && (
            <p className="text-fg-muted text-sm">
              {attention.length === 0
                ? "Vibe is watching your projects. Anything that needs a decision will appear here."
                : "Vibe ranked these from what it found in your projects."}
            </p>
          )}
        </header>

        {projects.length === 0 ? (
          <EmptyDashboard />
        ) : (
          <>
            {attention.length > 0 && <AttentionList items={attention} />}

            <section aria-labelledby="projects-heading" className="flex flex-col gap-4">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <h2 id="projects-heading" className="text-fg text-title font-bold">
                  Your projects
                </h2>
                <Link
                  href="/app/connect/github"
                  className={buttonClasses({ variant: "secondary", size: "sm" })}
                >
                  Connect another project
                </Link>
              </div>
              <ul className="flex flex-col gap-3">
                {projects.map((project) => (
                  <ProjectRow key={project.id} project={project} />
                ))}
              </ul>
            </section>

            <DashboardActivity entries={activityEntries} />
          </>
        )}
      </div>
    </AppShell>
  );
}
