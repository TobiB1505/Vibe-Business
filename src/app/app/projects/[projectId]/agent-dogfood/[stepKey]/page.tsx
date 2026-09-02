import { notFound, redirect } from "next/navigation";
import { projectSectionHref } from "@/components/layout/project-shell";
import { isDogfoodEligibleProject } from "@/modules/coding-agent/website-preflight";
import { requireProjectAccess } from "@/modules/projects/workspace-context";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Agent run",
  description: "One planned step, run by Vibe.",
};

/**
 * Old per-step URLs now land on the single Agent workspace. The step route no
 * longer renders a parallel run UI; Action Plan supplies the selected Move and
 * the new workspace owns start, activity, validation, preview and merge.
 */
export default async function AgentDogfoodStepPage({
  params,
}: {
  params: Promise<{ projectId: string; stepKey: string }>;
}) {
  const { projectId } = await params;
  await requireProjectAccess(projectId);

  if (!isDogfoodEligibleProject(projectId)) notFound();
  redirect(projectSectionHref(projectId, "agent"));
}
