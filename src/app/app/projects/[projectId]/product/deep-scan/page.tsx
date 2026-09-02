import { WorkspaceSection } from "@/components/layout/project-shell";
import { EmptyState } from "@/components/ui/states";
import { isBrowserProviderConfigured } from "@/modules/authenticated-product-intelligence/browserbase/client";
import { getDeepScanAccessStatus } from "@/modules/authenticated-product-intelligence/service";
import {
  getLatestSession,
  getLatestSuccessfulAuthenticatedSnapshot,
} from "@/modules/authenticated-product-intelligence/store";
import { detectAuthenticatedSurfaces } from "@/modules/authenticated-product-intelligence/surface-detection";
import { buildDeepScanViewModel } from "@/modules/authenticated-product-intelligence/view";
import { getLatestSuccessfulLiveSnapshot } from "@/modules/live-product-intelligence/store";
import { requireProjectAccess } from "@/modules/projects/workspace-context";
import { getLatestSuccessfulSnapshot } from "@/modules/repository-intelligence/store";
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
 * own budget is 90 seconds (`DEFAULT_AUTHENTICATED_BUDGETS.maxDurationMs`).
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
export const maxDuration = 120;

export default async function ProjectDeepScanPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const { supabase, userId, project } = await requireProjectAccess(projectId);

  const [deepScanAccess, latestSnapshot, latestLiveSnapshot, latestDeepScanSnapshot, latestSession] =
    await Promise.all([
      getDeepScanAccessStatus(supabase, {
        projectId,
        userId,
        owned: { productionUrl: project.productionUrl },
      }),
      getLatestSuccessfulSnapshot(supabase, projectId),
      getLatestSuccessfulLiveSnapshot(supabase, projectId),
      getLatestSuccessfulAuthenticatedSnapshot(supabase, projectId),
      getLatestSession(supabase, projectId),
    ]);

  // Deep Scan state is derived on the server (Sprint 5 §13): entitlement,
  // cooldown and eligibility are the domain's answers, not React's.
  const deepScanModel = deepScanAccess
    ? buildDeepScanViewModel({
        accessStatus: deepScanAccess,
        latestSnapshot: latestDeepScanSnapshot
          ? {
              result: latestDeepScanSnapshot.result,
              accessMode: latestDeepScanSnapshot.accessMode,
              completedAt: latestDeepScanSnapshot.completedAt,
              createdAt: latestDeepScanSnapshot.createdAt,
              pagesInspected: latestDeepScanSnapshot.pagesInspected,
            }
          : null,
        latestSession: latestSession
          ? { status: latestSession.status, failureCode: latestSession.failureCode }
          : null,
        surfaceDetection: detectAuthenticatedSurfaces({
          repository: latestSnapshot?.result ?? null,
          publicProduct: latestLiveSnapshot?.result ?? null,
        }),
        providerConfigured: isBrowserProviderConfigured(),
      })
    : null;

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
