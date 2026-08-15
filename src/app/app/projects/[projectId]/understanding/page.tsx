import { WorkspaceSection } from "@/components/layout/project-shell";
import { EmptyState } from "@/components/ui/states";
import { getActiveProductUnderstandingOperation } from "@/modules/operations/service";
import { getLatestProfile } from "@/modules/product-understanding/store";
import { buildUnderstandingView } from "@/modules/product-understanding/view";
import { getLatestSuccessfulLiveSnapshot } from "@/modules/live-product-intelligence/store";
import { requireProjectAccess } from "@/modules/projects/workspace-context";
import { getLatestSuccessfulSnapshot } from "@/modules/repository-intelligence/store";
import { UnderstandingConfirm } from "../understanding-confirm";
import { UnderstandingPanel } from "../understanding-panel";
import { UnderstandingProgress } from "../understanding-progress";

/**
 * Product understanding — "what Vibe knows" (CORE-1 §26, §33).
 *
 * ## Why this is a route rather than a panel on Overview
 *
 * It is the first thing a new project should look at and the thing a founder
 * comes back to when they want to check what Vibe believes. Both of those need
 * a URL. It sits first in the workspace navigation for the same reason: every
 * other section reasons *from* this one.
 *
 * ## What it loads
 *
 * The profile, whether a run is in flight, and the two snapshot existence
 * checks that decide whether starting is even possible. Nothing else — no
 * audit, no opportunities, no prepared changes. This route is about one
 * question and pays for one question (the UI-2 route-split discipline).
 */
export default async function ProductUnderstandingPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  // Re-checked here, not inherited from the layout: an App Router layout does
  // not gate the routes beneath it.
  const { supabase, project } = await requireProjectAccess(projectId);

  const [latest, activeOperation, repositorySnapshot, liveSnapshot] = await Promise.all([
    getLatestProfile(supabase, projectId),
    getActiveProductUnderstandingOperation(supabase, projectId),
    getLatestSuccessfulSnapshot(supabase, projectId),
    getLatestSuccessfulLiveSnapshot(supabase, projectId),
  ]);

  // Either source is enough. A product with no public site yet is exactly the
  // kind this flow exists to describe (CORE-1 §43).
  const hasEvidence = Boolean(repositorySnapshot?.result) || Boolean(liveSnapshot?.result);

  const blockedReason = hasEvidence
    ? null
    : project.repository
      ? "Vibe needs to read your code or visit your product first. Both live on the Overview tab."
      : "Connect a repository first, and Vibe can start getting to know your product.";

  const view = latest ? buildUnderstandingView(latest.profile, latest.stored.synthesized) : null;

  return (
    <WorkspaceSection
      id="understanding"
      title="Product"
      description="What Vibe understands about the product you built, and where that understanding came from."
      actions={
        // The start control lives in the header when a profile already exists,
        // so re-checking is available without scrolling past the answer.
        view ? (
          <UnderstandingProgress
            projectId={project.id}
            hasProfile
            activeOperation={activeOperation}
            canStart={hasEvidence}
            blockedReason={blockedReason}
          />
        ) : null
      }
    >
      {view && latest ? (
        <UnderstandingPanel
          view={view}
          projectId={project.id}
          confirmedAt={latest.stored.confirmedAt}
          actions={
            <UnderstandingConfirm
              projectId={project.id}
              profileId={latest.stored.id}
              values={{
                name: latest.profile.identity.name.value ?? "",
                shortDescription: latest.profile.identity.shortDescription.value ?? "",
                understanding: latest.profile.identity.understanding.value ?? "",
                mainPurpose: latest.profile.identity.mainPurpose.value ?? "",
                mainPromise: latest.profile.identity.mainPromise.value ?? "",
                primaryAudience: latest.profile.audience.primaryAudience.value ?? "",
                problemSolved: latest.profile.audience.problemSolved.value ?? "",
              }}
            />
          }
        />
      ) : (
        <EmptyState
          title="Vibe hasn't got to know your product yet."
          description="Vibe reads your code and looks at your public product, then tells you — in one paragraph — what it thinks you built. You get to say whether it's right."
          action={
            <UnderstandingProgress
              projectId={project.id}
              hasProfile={false}
              activeOperation={activeOperation}
              canStart={hasEvidence}
              blockedReason={blockedReason}
            />
          }
        />
      )}
    </WorkspaceSection>
  );
}
