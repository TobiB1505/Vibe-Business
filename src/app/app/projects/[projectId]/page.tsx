import { requireProjectAccess } from "@/modules/projects/workspace-context";
import { ProjectBusinessHealth } from "./health/content";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Business health",
  description: "How business-ready this product is, across nine areas.",
};

/**
 * Project Home is the Business Health command surface (UI-11).
 *
 * The diagnosis is the opening context for every action that follows. The
 * legacy `/health` address renders this same component, and the opportunity
 * engine's recovery fragment resolves to its `#business-audit` anchor here.
 */
export default async function ProjectHomePage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const access = await requireProjectAccess(projectId);

  return <ProjectBusinessHealth access={access} />;
}
