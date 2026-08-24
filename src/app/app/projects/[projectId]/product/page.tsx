import { WorkspaceSection, projectSectionHref } from "@/components/layout/project-shell";
import { EmptyState } from "@/components/ui/states";
import { Surface } from "@/components/ui/surface";
import { MonoLabel } from "@/components/ui/typography";
import { getLatestSuccessfulAuthenticatedSnapshot } from "@/modules/authenticated-product-intelligence/store";
import { getActiveProductUnderstandingOperation } from "@/modules/operations/service";
import { getLatestProfile } from "@/modules/product-understanding/store";
import { buildUnderstandingView } from "@/modules/product-understanding/view";
import { getLatestSuccessfulLiveSnapshot } from "@/modules/live-product-intelligence/store";
import { isEmptyFounderIntent } from "@/modules/projects/founder-intent";
import { getFounderIntent } from "@/modules/projects/founder-intent-store";
import { requireProjectAccess } from "@/modules/projects/workspace-context";
import { getLatestSuccessfulSnapshot } from "@/modules/repository-intelligence/store";
import { InspectButton } from "../inspect-button";
import { InspectLiveButton } from "../inspect-live-button";
import { IntelligenceSummary, LIVE_PRODUCT_ANCHOR } from "../intelligence-summary";
import { LiveIntelligenceSummary } from "../live-intelligence-summary";
import { UnderstandingConfirm } from "../understanding-confirm";
import { UnderstandingPanel, type UnderstandingSource } from "../understanding-panel";
import { UnderstandingProgress } from "../understanding-progress";

/**
 * My Product — "what Vibe knows" (CORE-1 §26, §33; CORE-5).
 *
 * ## What it holds, and why it grew
 *
 * The profile has always been here: what Vibe worked out the product is, what
 * a person can do with it, how it appears to work, and the brand it presents.
 *
 * CORE-5 added the other half, which used to be on Overview: **where that
 * understanding came from**, and the controls that produce it. Splitting the
 * conclusion from its sources across two screens meant a founder reading a
 * thin profile had no way to see that Vibe had only ever read the code, and no
 * way to fix it from where they were standing.
 *
 * Order is answer-first: the profile, then what Vibe learned it from, then the
 * raw intelligence surfaces themselves.
 *
 * ## Deep Scan
 *
 * A child route of this one and deliberately not in the navigation — it is a
 * source, not a destination. The Product Understanding source cards are
 * therefore the only way to reach it, which is why every card carries a link.
 *
 * ## What it loads
 *
 * The profile, whether a run is in flight, the three snapshot existence checks
 * and the founder intent flag. All cheap. Nothing about the audit, the
 * opportunities or prepared changes reaches this route.
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

  const [latest, activeOperation, repositorySnapshot, liveSnapshot, deepScanSnapshot, founderIntent] =
    await Promise.all([
      getLatestProfile(supabase, projectId),
      getActiveProductUnderstandingOperation(supabase, projectId),
      getLatestSuccessfulSnapshot(supabase, projectId),
      getLatestSuccessfulLiveSnapshot(supabase, projectId),
      getLatestSuccessfulAuthenticatedSnapshot(supabase, projectId),
      getFounderIntent(supabase, projectId),
    ]);

  // Either source is enough. A product with no public site yet is exactly the
  // kind this flow exists to describe (CORE-1 §43).
  const hasEvidence = Boolean(repositorySnapshot?.result) || Boolean(liveSnapshot?.result);

  const blockedReason = hasEvidence
    ? null
    : project.repository
      ? "Vibe needs to read your code or visit your product first. Both are below."
      : "Connect a repository first, and Vibe can start getting to know your product.";

  const view = latest ? buildUnderstandingView(latest.profile, latest.stored.synthesized) : null;

  /**
   * The four sources, in the founder's words (CORE-1 §34, §45).
   *
   * `ready` is derived from a snapshot that exists or does not — nothing here
   * is inferred, and "not yet" is never dressed up as a problem.
   */
  const sources: UnderstandingSource[] = [
    {
      id: "code",
      label: "Your code",
      detail: "Vibe has read what your repository builds.",
      ready: Boolean(repositorySnapshot?.result),
      pending: project.repository
        ? "Vibe hasn't read your code yet."
        : "No repository is connected yet.",
      href: project.repository ? "#repository-intelligence" : projectSectionHref(project.id, "settings"),
      action: project.repository ? "See what it read" : "Connect a repository",
    },
    {
      id: "live",
      label: "Your public product",
      detail: "Vibe has visited what a first-time visitor reaches.",
      ready: Boolean(liveSnapshot?.result),
      pending: project.productionUrl
        ? "Vibe hasn't visited your product yet."
        : "No production website is set yet.",
      href: project.productionUrl ? `#${LIVE_PRODUCT_ANCHOR}` : projectSectionHref(project.id, "settings"),
      action: project.productionUrl ? "See what it saw" : "Add your website",
    },
    {
      id: "deep-scan",
      label: "Your signed-in product",
      detail: "Vibe has seen what your product looks like after signing in.",
      ready: Boolean(deepScanSnapshot?.result),
      pending: "Vibe hasn't seen past your sign-in yet.",
      // The only route to a page that is deliberately not in the navigation.
      href: projectSectionHref(project.id, "deep-scan"),
      action: "Deep Scan",
    },
    {
      id: "intent",
      label: "What you told Vibe",
      detail: "Your stated stage, monetization intent and primary goal.",
      ready: !isEmptyFounderIntent(founderIntent.intent),
      pending: "You haven't told Vibe anything about the business yet.",
      href: `${projectSectionHref(project.id, "settings")}#founder-intent`,
      action: "Tell Vibe",
    },
  ];

  return (
    <WorkspaceSection
      id="my-product"
      title="My Product"
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
      <div className="flex flex-col gap-5">
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

        {project.productionUrl && (
          <Surface
            // The anchor repository findings link to when only a live check
            // could settle the question (UI-3.6 §39). `scroll-mt` clears the
            // sticky workspace header, as `WorkspaceSection` does.
            id={LIVE_PRODUCT_ANCHOR}
            level="section"
            padding="lg"
            className="scroll-mt-40 flex flex-col gap-4 lg:scroll-mt-32"
          >
            {liveSnapshot?.result ? (
              <LiveIntelligenceSummary
                snapshot={liveSnapshot.result}
                analyzedAt={liveSnapshot.completedAt ?? liveSnapshot.createdAt}
              />
            ) : (
              <div className="flex flex-col gap-1">
                <MonoLabel>What Vibe sees when it visits your product · Live product check</MonoLabel>
                <h3 className="text-fg text-base font-semibold">
                  Vibe hasn&apos;t visited your product yet.
                </h3>
                <p className="text-fg-muted max-w-[70ch] text-sm">
                  A live check shows what a visitor can actually reach — which is the only way to
                  confirm what your code suggests.
                </p>
              </div>
            )}
            <div>
              <InspectLiveButton
                projectId={project.id}
                hasSnapshot={Boolean(liveSnapshot?.result)}
              />
            </div>
          </Surface>
        )}

        {project.repository && (
          <Surface
            // Targeted by the "Your code" row above, which is how a founder
            // gets from "Vibe hasn't read your code" to the control that
            // changes that.
            id="repository-intelligence"
            level="section"
            padding="lg"
            className="scroll-mt-40 flex flex-col gap-4 lg:scroll-mt-32"
          >
            {repositorySnapshot?.result ? (
              <IntelligenceSummary
                snapshot={repositorySnapshot.result}
                analyzedAt={repositorySnapshot.createdAt}
                projectId={project.id}
                // Passed only so the two layers can be compared where they
                // disagree (UI-3.6 §11). Live results are rendered above.
                liveSnapshot={liveSnapshot?.result ?? null}
              />
            ) : (
              <div className="flex flex-col gap-1">
                <MonoLabel>What Vibe learned from your code · Repository intelligence</MonoLabel>
                <h3 className="text-fg text-base font-semibold">
                  Vibe hasn&apos;t read your code yet.
                </h3>
                <p className="text-fg-muted max-w-[70ch] text-sm">
                  Reading it is how Vibe works out what your product already does, and what it is
                  missing.
                </p>
              </div>
            )}
            <div>
              <InspectButton
                projectId={project.id}
                hasSnapshot={Boolean(repositorySnapshot?.result)}
              />
            </div>
          </Surface>
        )}
      </div>
    </WorkspaceSection>
  );
}
