import { WorkspaceSection } from "@/components/layout/project-shell";
import { EmptyState } from "@/components/ui/states";
import { loadDeepScanViewModel } from "@/modules/authenticated-product-intelligence/service";
import { requireProjectAccess } from "@/modules/projects/workspace-context";
import { DeepScanPanel } from "../../deep-scan-panel";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Deep scan",
  description: "What Vibe sees once it is signed in to your product.",
};

/**
 * Deep Scan (Sprint UI-2 Part 2).
 *
 * The Deep Scan analysis runs inside this route segment's function, and its
 * own budget is 180 seconds (`DEFAULT_AUTHENTICATED_BUDGETS.maxDurationMs`).
 * Without this the platform default (15s on Pro) would kill the function
 * mid-analysis — the user would have signed in, been charged for a browser
 * session, and got nothing back.
 *
 * Set above the analysis budget so the budget stays the thing that ends a
 * scan, rather than the platform.
 *
 * This is now the *only* route carrying that ceiling. Before the split it sat
 * on the single project page, which meant every section of the workspace ran
 * under a 120-second function.
 */
export const maxDuration = 240;

export default async function ProjectDeepScanPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const { supabase, userId, project } = await requireProjectAccess(projectId);

  /*
   * Entitlement, the live session, the last snapshot and the recommendation
   * evidence are one question with one answer, and My Product's spotlight asks
   * it too. Assembled in the module so the two cannot drift apart.
   */
  const deepScanModel = await loadDeepScanViewModel(supabase, {
    projectId,
    userId,
    owned: { productionUrl: project.productionUrl },
  });

  return (
    <WorkspaceSection id="deep-scan">
      {deepScanModel ? (
        <DeepScanPanel projectId={project.id} model={deepScanModel} />
      ) : (
        <EmptyState
          title="Deep Scan is unavailable for this project"
          description="Deep Scan needs a connected repository and a configured production website before it can sign in to anything."
        />
      )}
    </WorkspaceSection>
  );
}
