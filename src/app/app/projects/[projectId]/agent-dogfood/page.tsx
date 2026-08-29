import { notFound, redirect } from "next/navigation";
import { projectSectionHref } from "@/components/layout/project-shell";
import { isDogfoodEligibleProject } from "@/modules/coding-agent/website-preflight";
import { requireProjectAccess } from "@/modules/projects/workspace-context";

/**
 * Compatibility redirect for links created before the Agent workspace became
 * the canonical execution UI. Ownership and the internal allowlist are checked
 * before the destination is revealed; the old diagnostic surface is no longer
 * rendered.
 */
export default async function AgentDogfoodPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  await requireProjectAccess(projectId);

  if (!isDogfoodEligibleProject(projectId)) notFound();
  redirect(projectSectionHref(projectId, "agent"));
}
