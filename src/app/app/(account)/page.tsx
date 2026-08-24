import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/modules/auth/session";
import { getDashboardOverview } from "@/modules/projects/dashboard";
import { getOnboardingRouting } from "@/modules/onboarding/store";
import { AccountHome } from "../account-home";

/**
 * The account dashboard (Sprint UI-3, rebuilt in CORE-6).
 *
 * ## What a page owns, and what it does not
 *
 * The session, the reads, and the redirects. Everything that reaches the
 * screen is `AccountHome`, which the browser harness renders with fixtures — a
 * density budget asserted against a composition the test assembled itself
 * would measure a screen that exists only in the test file.
 *
 * ## Cost
 *
 * Two constant-cost read models regardless of how many projects exist: the
 * dashboard summary and one resumable-onboarding lookup. Neither ever builds a
 * prepared workspace, signs a review image, asks a sandbox provider for
 * anything, runs a GitHub merge preflight, or reads an audit's JSONB document.
 * `dashboard-contract.test.ts` asserts that.
 */
export default async function AppHomePage({
  searchParams,
}: {
  searchParams: Promise<{ connect_error?: string }>;
}) {
  const session = await requireSession();
  const { connect_error: connectError } = await searchParams;

  const supabase = await createClient();
  /*
   * One read. The Credit balance used to be the second half of a
   * `Promise.all` here; it belongs to the shell, and the shell is a layout as
   * of CORE-6 — reading it in both places would cost every dashboard render a
   * duplicate wallet lookup for a number this page does not render.
   */
  const { projects } = await getDashboardOverview(supabase, session.userId);

  /*
   * First login and interrupted activation resolve on the server. Connection
   * errors stay visible instead of being swallowed by a redirect loop.
   *
   * The takeover ends the moment a founder has finished setup once. Before
   * that there is nothing else to show them, so resuming is the only sensible
   * destination; after it, unfinished setup on a second project is an offer —
   * it is rendered rather than routed to. The first version redirected on any
   * unfinished project, which made the workspace unreachable for exactly the
   * person who least needed the flow.
   */
  const routing =
    projects.length === 0
      ? { resumableProjectId: null, hasCompleted: false }
      : await getOnboardingRouting(supabase, projects.map((project) => project.id));

  if (!connectError && !routing.hasCompleted) {
    if (projects.length === 0) redirect("/app/onboarding");
    if (routing.resumableProjectId) redirect(`/app/onboarding/${routing.resumableProjectId}`);
  }

  return (
    <AccountHome
      projects={projects}
      connectError={connectError ?? null}
      unfinishedSetupProjectId={routing.hasCompleted ? routing.resumableProjectId : null}
    />
  );
}
