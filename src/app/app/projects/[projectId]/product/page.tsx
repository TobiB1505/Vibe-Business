import { WorkspaceSection, projectSectionHref } from "@/components/layout/project-shell";
import { ProductScanExperience } from "@/components/product-scan/product-scan-experience";
import { EmptyState } from "@/components/ui/states";
import { getLatestSuccessfulAuthenticatedSnapshot } from "@/modules/authenticated-product-intelligence/store";
import {
  getActiveProductScanOperation,
  getLatestProductScanOperation,
} from "@/modules/operations/service";
import { getProductScanEvents } from "@/modules/product-scan/store";
import { buildProductScanPresentation } from "@/modules/product-scan/presentation";
import { getLatestProfile } from "@/modules/product-understanding/store";
import { buildUnderstandingView } from "@/modules/product-understanding/view";
import {
  getLatestLiveSnapshotAttempt,
  getLatestSuccessfulLiveSnapshot,
} from "@/modules/live-product-intelligence/store";
import { isEmptyFounderIntent } from "@/modules/projects/founder-intent";
import { getFounderIntent } from "@/modules/projects/founder-intent-store";
import { requireProjectAccess } from "@/modules/projects/workspace-context";
import {
  getLatestSnapshotAttempt,
  getLatestSuccessfulSnapshot,
} from "@/modules/repository-intelligence/store";
import { UnderstandingConfirm } from "../understanding-confirm";
import { UnderstandingPanel } from "../understanding-panel";
import { buildSourceCoverage } from "@/modules/provenance/source-coverage";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "My product",
  description: "What Vibe understands your product to be.",
};

/**
 * My Product — "what Vibe knows" (CORE-1 §26, §33; CORE-5; Stage D).
 *
 * ## What it holds, and why it grew
 *
 * The profile has always been here: what Vibe worked out the product is, what
 * a person can do with it, how it appears to work, and the brand it presents.
 *
 * CORE-5 added the other half, which used to be on Overview: **where that
 * understanding came from**, and the controls that produce it. Stage D merged
 * those controls into one: a founder scans their product, and Vibe reads the
 * code and visits the site. Which halves ran, and how completely, is the
 * source rows' job to say — honestly, in three states rather than a boolean.
 *
 * The Product Scan now owns the live discovery story. The durable profile and
 * its confirmation follow it; the legacy raw code/live summaries deliberately
 * do not continue below the confirmation boundary.
 *
 * ## Deep Scan
 *
 * A child route of this one and deliberately not in the navigation — it is a
 * source, not a destination, and it stays a separate, metered control.
 * The Product Understanding source cards are therefore the only way to reach
 * it, which is why every card carries a link.
 *
 * ## What it loads
 *
 * The profile, whether a run is in flight, and the small snapshot reads needed
 * to report source availability honestly. Raw snapshot summaries are no
 * longer rendered here. Nothing about the audit, the opportunities or
 * prepared changes reaches this route.
 */
export default async function MyProductPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  // Re-checked here, not inherited from the layout: an App Router layout does
  // not gate the routes beneath it.
  const { supabase, project } = await requireProjectAccess(projectId);

  const [
    latest,
    activeOperation,
    latestScanOperation,
    repositorySnapshot,
    repositoryAttempt,
    liveSnapshot,
    liveAttempt,
    deepScanSnapshot,
    founderIntent,
  ] = await Promise.all([
    getLatestProfile(supabase, projectId),
    getActiveProductScanOperation(supabase, projectId),
    getLatestProductScanOperation(supabase, projectId),
    getLatestSuccessfulSnapshot(supabase, projectId),
    getLatestSnapshotAttempt(supabase, projectId),
    getLatestSuccessfulLiveSnapshot(supabase, projectId),
    getLatestLiveSnapshotAttempt(supabase, projectId),
    getLatestSuccessfulAuthenticatedSnapshot(supabase, projectId),
    getFounderIntent(supabase, projectId),
  ]);

  const displayedScan = activeOperation ?? latestScanOperation;
  const scanEvents = displayedScan
    ? await getProductScanEvents(supabase, {
        projectId,
        operationId: displayedScan.operationId,
      })
    : [];

  const blockedReason = project.repository
    ? null
    : "Connect a repository first, and Vibe can start getting to know your product.";

  const view = latest ? buildUnderstandingView(latest.profile, latest.stored.synthesized) : null;
  const scanPresentation =
    latest && displayedScan?.resultId === latest.stored.id
      ? buildProductScanPresentation(latest.profile, latest.stored.synthesized, project.name)
      : null;

  const SCAN_ANCHOR = "product-scan";

  /*
   * What the understanding rests on (audit C8/R6).
   *
   * This was four objects assembled here — a hundred lines of nested
   * ternaries producing label, state, sentence, link and action per source,
   * with no room for the reason one stopped short, the amount it read, when,
   * or what the remedy costs. `buildSourceCoverage` owns all of it now, and
   * owns it once: the Provenance Strip renders the same four facts under a
   * priced control.
   */
  const sources = buildSourceCoverage({
    repository: {
      result: repositorySnapshot?.result ?? null,
      completedAt: repositorySnapshot?.completedAt ?? null,
      failed: repositoryAttempt?.status === "failed",
    },
    live: {
      result: liveSnapshot?.result ?? null,
      completedAt: liveSnapshot?.completedAt ?? null,
      failed: liveAttempt?.status === "failed",
    },
    deepScan: {
      result: deepScanSnapshot?.result ?? null,
      completedAt: deepScanSnapshot?.completedAt ?? null,
      pagesInspected: deepScanSnapshot?.pagesInspected ?? null,
    },
    founder: { told: !isEmptyFounderIntent(founderIntent.intent), at: null },
    hrefs: {
      scan: `#${SCAN_ANCHOR}`,
      deepScan: projectSectionHref(project.id, "deep-scan"),
      settings: projectSectionHref(project.id, "settings"),
      founderIntent: `${projectSectionHref(project.id, "settings")}#founder-intent`,
      connectRepository: projectSectionHref(project.id, "settings"),
      addWebsite: projectSectionHref(project.id, "settings"),
    },
    connected: {
      repository: Boolean(project.repository),
      productionUrl: Boolean(project.productionUrl),
    },
  });

  return (
    <WorkspaceSection id="my-product">
      <div className="flex flex-col gap-5">
        <div id={SCAN_ANCHOR} className="scroll-mt-6">
          <ProductScanExperience
            projectId={project.id}
            variant="workspace"
            initialOperation={displayedScan}
            initialEvents={scanEvents}
            initialPresentation={scanPresentation}
            productName={project.name}
            hasProfile={Boolean(view)}
            canStart={Boolean(project.repository)}
            blockedReason={blockedReason}
          />
        </div>

        {view && latest ? (
          <UnderstandingPanel
            view={view}
            projectId={project.id}
            confirmedAt={latest.stored.confirmedAt}
            understoodAt={latest.stored.completedAt ?? latest.stored.createdAt}
            founderIntent={founderIntent.intent}
            founderContextHref={`${projectSectionHref(project.id, "settings")}#founder-intent`}
            sources={sources}
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
            description="Start the Product Scan above. Vibe will read the connected sources, save each grounded discovery, and assemble a Product Profile for you to review."
          />
        )}

      </div>
    </WorkspaceSection>
  );
}
