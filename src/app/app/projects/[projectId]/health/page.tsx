import { requireProjectAccess } from "@/modules/projects/workspace-context";
import { ProjectBusinessHealth } from "./content";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Business health",
  description: "How business-ready this product is, across nine areas.",
};

/**
 * Compatibility route for saved Business Health links.
 *
 * Business Health now lives at the project root. This route deliberately
 * renders the same server-owned states instead of redirecting, so fragments
 * and refreshes keep working without weakening the per-route access gate.
 */
export default async function LegacyBusinessHealthPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const access = await requireProjectAccess(projectId);

  return <ProjectBusinessHealth access={access} />;
}
