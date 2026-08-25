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
import { describeIncompleteness } from "@/modules/live-product-intelligence/human-view";
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
import { UnderstandingPanel, type UnderstandingSource } from "../understanding-panel";

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

  /**
   * The code half, in three honest states. A failed attempt only outranks
   * silence when no earlier successful read exists — data a founder can still
   * see is not erased by a later failure.
   */
  const codeSource: UnderstandingSource = repositorySnapshot?.result
    ? {
        id: "code",
        label: "Your code",
        state: "ready",
        detail: "Vibe has read what your repository builds.",
        href: `#${SCAN_ANCHOR}`,
        action: "View Product Scan",
      }
    : repositoryAttempt?.status === "failed"
      ? {
          id: "code",
          label: "Your code",
          state: "failed",
          detail: "Vibe couldn't read your code last time.",
          href: `#${SCAN_ANCHOR}`,
          action: "Scan again",
        }
      : {
          id: "code",
          label: "Your code",
          state: "none",
          detail: project.repository
            ? "Vibe hasn't read your code yet."
            : "No repository is connected yet.",
          href: project.repository ? `#${SCAN_ANCHOR}` : projectSectionHref(project.id, "settings"),
          action: project.repository ? "Scan my product" : "Connect a repository",
        };

  /**
   * The live half. `partial` is the state Sprint 0082 exists for: the site was
   * visited and could not be fully read — usually because pages build
   * themselves in the browser — and the note carries the same sentence the
   * full summary shows, from the one function that knows why.
   */
  const liveIncomplete = liveSnapshot?.result ? describeIncompleteness(liveSnapshot.result) : null;
  const liveSource: UnderstandingSource = liveSnapshot?.result
    ? {
        id: "live",
        label: "Your public product",
        state: liveIncomplete === null ? "ready" : "partial",
        detail:
          liveIncomplete === null
            ? "Vibe has visited what a first-time visitor reaches."
            : "Vibe visited your product, but couldn't read all of it.",
        note: liveIncomplete,
        href: `#${SCAN_ANCHOR}`,
        action: "View Product Scan",
      }
    : liveAttempt?.status === "failed"
      ? {
          id: "live",
          label: "Your public product",
          state: "failed",
          detail: "Vibe couldn't reach your product last time.",
          href: `#${SCAN_ANCHOR}`,
          action: "Scan again",
        }
      : {
          id: "live",
          label: "Your public product",
          state: "none",
          detail: project.productionUrl
            ? "Vibe hasn't visited your product yet."
            : "No production website is set yet.",
          href: project.productionUrl
            ? `#${SCAN_ANCHOR}`
            : projectSectionHref(project.id, "settings"),
          action: project.productionUrl ? "Scan my product" : "Add your website",
        };

  const sources: UnderstandingSource[] = [
    codeSource,
    liveSource,
    {
      id: "deep-scan",
      label: "Your signed-in product",
      state: deepScanSnapshot?.result ? "ready" : "none",
      detail: deepScanSnapshot?.result
        ? "Vibe has seen what your product looks like after signing in."
        : "Vibe hasn't seen past your sign-in yet.",
      // The only route to a page that is deliberately not in the navigation.
      href: projectSectionHref(project.id, "deep-scan"),
      action: "Deep Scan",
    },
    {
      id: "intent",
      label: "What you told Vibe",
      state: isEmptyFounderIntent(founderIntent.intent) ? "none" : "ready",
      detail: isEmptyFounderIntent(founderIntent.intent)
        ? "You haven't told Vibe anything about the business yet."
        : "Your own words about the business, which outrank anything derived.",
      href: `${projectSectionHref(project.id, "settings")}#founder-intent`,
      action: "Tell Vibe",
    },
  ];

  return (
    <WorkspaceSection
      id="my-product"
      title="My Product"
      description="Here's how Vibe understands your product."
    >
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
