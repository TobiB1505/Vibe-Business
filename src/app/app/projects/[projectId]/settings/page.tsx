import { requireProjectAccess } from "@/modules/projects/workspace-context";
import { getFounderIntent } from "@/modules/projects/founder-intent-store";
import { findReconnectInstallationId } from "@/modules/projects/attach";
import { ProjectSettingsView } from "./project-settings-view";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Project settings",
  description: "The repository this product is connected to.",
};

/**
 * Settings (CORE-5).
 *
 * ## Why this route exists
 *
 * Because these three controls were on Overview, and Overview is now Home.
 *
 * That was never a deliberate placement. The production URL, what the founder
 * told Vibe, and disconnecting the repository accumulated on the index page
 * because it was the only page a project had, and they stayed there through the
 * UI-2 split because nothing moved them. The cost was that the first screen
 * after opening a project asked a founder to configure it — three forms below
 * the summary — rather than telling them where their product stands.
 *
 * They are configuration. They belong together, in the one place a person looks
 * when they want to change something rather than find something out.
 *
 * ## What it deliberately does not own
 *
 * Credits and billing (`/app/settings/billing`) and the GitHub App installation both stay
 * where they are and are linked from here. Neither is scoped to one project —
 * an account has one balance and one installation across every project — so
 * putting either behind a project's Settings would imply a per-project setting
 * that does not exist.
 *
 * ## Why the markup is not here
 *
 * `ProjectSettingsView` holds it, so the browser suite can render this screen
 * without a session and a Supabase project. Until UI-21 it could not, and this
 * page — which carries disconnecting a repository and deleting a product — had
 * no browser coverage at all.
 *
 * ## Cost
 *
 * The founder intent read, and the project context the access gate already
 * resolved. Nothing else — no audit, no opportunities, no prepared changes.
 */
export default async function ProjectSettingsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  // Re-checked here, not inherited from the layout: an App Router layout does
  // not gate the routes beneath it.
  const { supabase, project } = await requireProjectAccess(projectId);

  const founderIntent = await getFounderIntent(supabase, projectId);

  /*
   * Reconnecting goes straight to the picker for the installation this project
   * was already using, read from its connection history. Walking a founder back
   * through account selection and a fresh authorization to reach a repository
   * they already granted access to would be ceremony, not safety — the action
   * re-verifies the installation server-side either way.
   *
   * Falls back to the ordinary connect flow when there is no history to read,
   * which is the case for a project that never had a connection at all.
   */
  const reconnectInstallationId = project.repository
    ? null
    : await findReconnectInstallationId(supabase, projectId);
  const reconnectHref = reconnectInstallationId
    ? `/app/connect/github/repositories?installation=${reconnectInstallationId}&projectId=${projectId}`
    : "/app/connect/github";

  return (
    <ProjectSettingsView
      projectId={project.id}
      projectName={project.name}
      repository={project.repository}
      productionUrl={project.productionUrl}
      founderIntent={founderIntent.intent}
      reconnectHref={reconnectHref}
    />
  );
}
