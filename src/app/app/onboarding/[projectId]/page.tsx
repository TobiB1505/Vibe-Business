import { notFound, redirect } from "next/navigation";
import { ProductLogo } from "@/components/brand/product-logo";
import { VibeMark } from "@/components/brand/vibe-mark";
import { Notice } from "@/components/ui/states";
import { ProductScanExperience } from "@/components/product-scan/product-scan-experience";
import { createClient } from "@/lib/supabase/server";
import { recordAuditEvent } from "@/modules/audit-log/events";
import { requireSession } from "@/modules/auth/session";
import { getAuditReadiness } from "@/modules/business-audit/service";
import { getLatestSuccessfulAudit } from "@/modules/business-audit/store";
import { getOnboardingFirstMove } from "@/modules/action-plans/service";
import { ACTOR_LABELS, EXECUTION_SUPPORT_LABELS } from "@/modules/action-plans/schema";
import {
  getActiveOpportunityOperation,
  getLastFailedOperation,
} from "@/modules/operations/service";
import { resolveAuditCreditGate } from "@/modules/business-audit/entitlement";
import { getAuditAccessStatus } from "@/modules/business-audit/service";
import { NovaMoveButton, NovaMoveLink } from "@/components/nova/nova-move";
import { buildNovaFirstRunFeed, deriveNovaFirstRun } from "@/modules/nova/first-run";
import { novaRevealBundlesAudit } from "@/modules/nova/onboarding";
import { auditSurface } from "@/modules/onboarding/audit-surface";
import {
  markOnboardingMilestone,
  getProjectOnboarding,
  hasCompletedAnyOnboarding,
} from "@/modules/onboarding/store";
import { buildUnderstandingView } from "@/modules/product-understanding/view";
import { getProductScanEvents } from "@/modules/product-scan/store";
import { buildProductScanPresentation } from "@/modules/product-scan/presentation";
import { AuditAnalyzing, AuditPreparing } from "../../projects/[projectId]/audit-lifecycle";
import { NeedsUserPanel } from "../../projects/[projectId]/needs-user-panel";
import { OnboardingShell } from "../onboarding-shell";
import { completeOnboardingAction } from "./actions";
import { NovaFirstRun } from "./nova-first-run";
import { NovaOnboardingHeader } from "./nova-onboarding-header";
import { NovaOpeningScreen } from "../../projects/[projectId]/nova/nova-opening-screen";
import { NovaRail } from "../../projects/[projectId]/nova/nova-rail";
import { NovaRoom } from "@/components/nova/nova-room";
import { onboardingSteps } from "@/modules/onboarding/state";
import { novaPresenceState } from "@/components/system/status-vocabulary";
import { novaWorkingEntry } from "@/modules/nova/home-view";
import { operationPollPhase } from "@/modules/operations/view";
import { listAuditEventsForProject } from "@/modules/audit-log/queries";
import { buildActivityFeed } from "@/modules/audit-log/view";
import { getGithubIdentity } from "@/modules/github/identity";
import { NOVA_ONBOARDING_TIER } from "@/modules/nova/onboarding";
import { NovaOnboardingThread } from "./nova-onboarding-thread";
import { OnboardingAuditReveal } from "./audit-reveal";
import { AuditLivePrerequisite } from "./audit-live-prerequisite";
import { LiveSiteStep } from "./live-site-step";
import { OperationWatcher } from "./operation-watcher";
import { OnboardingOperationFailure, OnboardingStalled } from "./operation-states";
import { ProductConfirmation } from "./product-confirmation";
import { ProductRevealFacts } from "./reveal-facts";
import { FirstMoveDecision } from "./first-move-decision";
import { getHeaderCreditBalance } from "@/modules/billing/overview";
import { RetryProductScan, StartAudit } from "./phase-actions";
import { isUuid } from "@/lib/validation/uuid";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Setting up your product",
  description: "Vibe is getting to know your product.",
};

export default async function ProjectOnboardingPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  // VB-028, as in `requireProjectAccess`: a malformed id is not-found, not a
  // 500. This route resolves its own context rather than going through that
  // guard, so it needs the check too.
  if (!isUuid(projectId)) notFound();

  const session = await requireSession();
  const supabase = await createClient();
  const onboarding = await getProjectOnboarding(supabase, { projectId, userId: session.userId });
  if (!onboarding) notFound();
  if (onboarding.state === "complete") redirect(`/app/projects/${projectId}`);

  /*
   * Nova's own two screens come before the rest of setup (NOVA-3).
   *
   * Derived from `deriveOnboardingState`'s answer rather than replacing it —
   * the ten states, their reconciliation and their tests are untouched. When
   * the first run is behind us this is `handoff`, the feed is empty, and every
   * screen below renders exactly as it did.
   *
   * It returns before the reads underneath because none of them is needed to
   * say hello: an introduction describes what Vibe does, not what it has
   * found, so a founder seeing it should not wait on an audit stamp.
   *
   * The introduction branch makes two reads of its own — the event log, for
   * the rail the choreography fills, and who the founder is, so she can say
   * hello to somebody. Both are beats of the sequence rather than facts about
   * the product, and they are why those two are worth a query here and nothing
   * else is.
   */
  const firstRun = deriveNovaFirstRun({
    onboardingState: onboarding.state,
    novaIntroducedAt: onboarding.novaIntroducedAt,
    novaWorkflowStatus: onboarding.novaWorkflowStatus,
  });

  /*
   * The introduction is the choreography, not a screen with the same words on
   * it (§O.6).
   *
   * `NovaOpeningScreen` is the one that assembles: the mark alone at full
   * size, travelling into the rail while the room is drawn around it.
   * That is Nova building the environment the rest of setup happens in, which
   * is why it comes before the first step rather than after it — and why the
   * room it builds has to be the room that is still there on the next render.
   *
   * The same component the project route mounts for a project that finished
   * setup without ever meeting her. One choreography, two entry points.
   */
  if (firstRun === "introduce") {
    /*
     * One read, for the one beat that would otherwise show nothing.
     *
     * The choreography strokes the rail and then fills it — and a project that
     * has reached onboarding has already connected an installation and been
     * created, so there is genuinely something to arrive. With an empty list
     * that beat draws an empty box, which is a moment of the sequence spent on
     * nothing.
     *
     * It is the one read this branch makes. The rest of the page's wave stays
     * below it, because an introduction still has no reason to wait on an
     * audit stamp.
     */
    /*
     * And who to say hello to.
     *
     * `identity-view.ts` holds the rule: never invent a name. The GitHub login
     * is a name a person chose and authenticated with, so it is one; an email
     * address is an address and is not shortened into a first name here.
     * `null` is an ordinary answer — `novaGreeting` has a nameless form that
     * is a greeting rather than a gap.
     */
    const [introActivity, identity] = await Promise.all([
      listAuditEventsForProject(supabase, { projectId, userId: session.userId, limit: 4 }),
      getGithubIdentity(supabase, session.userId),
    ]);

    return (
      <OnboardingShell
        email={session.email}
        state={onboarding.state}
        projectName={onboarding.projectName}
        canLeave
      >
        <NovaOpeningScreen
          projectId={projectId}
          productName={onboarding.projectName}
          connected={onboarding.repository !== null}
          greetingName={identity?.githubLogin ?? null}
          setup={onboardingSteps(onboarding.state)}
          activity={buildActivityFeed(introActivity.events).reverse()}
        />
      </OnboardingShell>
    );
  }

  /*
   * Everything else she says at her own positions. Built after the branch
   * above returns, because the introduction's greeting needs a read this does
   * not — and a feed built for a branch that already returned is a query
   * nobody looks at.
   */
  const firstRunEntries = buildNovaFirstRunFeed(firstRun);

  if (firstRunEntries.length > 0) {
    /*
     * The same read the introduction makes, and for the same reason.
     *
     * This branch passed `[]` on the argument that "a project that has not
     * been introduced to Nova has nothing in its log worth a query" — and the
     * project has been introduced by the time this renders. `nova.introduced`
     * is in the log, and so is everything the opening's rail had just shown.
     *
     * So the empty list was not a saved query, it was the room losing its
     * contents on the handover: two rows of *Earlier* during the choreography,
     * an empty box the moment she stopped speaking. The whole argument for the
     * opening is that the room it builds is still there afterwards.
     */
    const handoverActivity = await listAuditEventsForProject(supabase, {
      projectId,
      userId: session.userId,
      limit: 4,
    });

    return (
      <OnboardingShell
        email={session.email}
        state={onboarding.state}
        projectName={onboarding.projectName}
        canLeave
      >
        <NovaRoom
          /*
            The room the opening just built, rather than a bare page under it.
            The mark settled into this row a moment ago; a screen without it
            would take back the thing the choreography was for — which is why
            both screens compose `NovaRoom` rather than each drawing a grid.
          */
          header={
            <NovaOnboardingHeader
              state={onboarding.state}
              projectId={projectId}
              projectName={onboarding.projectName}
              connected={onboarding.repository !== null}
              operation={null}
            />
          }
          rail={
            <NovaRail
              presence="listening"
              seed={projectId}
              working={null}
              /* No Action Plan during setup — there is none yet. What the
                 column holds instead is setup's own four steps. */
              checklist={null}
              setup={onboardingSteps(onboarding.state)}
              activity={buildActivityFeed(handoverActivity.events).reverse()}
            />
          }
        >
          <NovaFirstRun projectId={projectId} entries={firstRunEntries} />
        </NovaRoom>
      </OnboardingShell>
    );
  }

  /*
   * Everything the current step needs, in one wave (PERF-006).
   *
   * Each of these is gated on `onboarding`, which is already in hand, and none
   * of them depends on another — so awaiting them in sequence bought nothing
   * and cost a round trip each. Most states switch on only one or two, but the
   * ones that overlap are exactly the states this route is polled in every
   * 2.5 seconds while a scan runs.
   *
   * The gates themselves are unchanged. A read that was conditional is still
   * conditional; it now resolves to `null` in the same wave rather than being
   * skipped in its own step.
   *
   * `revealedAudit` is the scored document, and the reason it is gated at all
   * (VB-022): `getProjectOnboarding` returns only a stamp — that an audit
   * exists, and when — because this route is polled and the document is large.
   * This is the one state that needs its contents.
   *
   * `firstMovePlan` cannot exist the first time anyone reaches that state: a
   * plan requires an explicit, paid "Plan this move" click from the workspace,
   * which is reachable only after onboarding completes. It is read for whoever
   * returns with one already in place (Rule 60: this page never starts that
   * paid call itself), and every field it produces is nullable by design.
   */
  const [
    scanEvents,
    auditReadiness,
    revealedAudit,
    opportunityOperation,
    firstMovePlan,
    understandingFailure,
    auditAccess,
    balance,
    auditEvents,
  ] = await Promise.all([
    onboarding.understandingOperation
      ? getProductScanEvents(supabase, {
          projectId,
          operationId: onboarding.understandingOperation.operationId,
        })
      : [],
    onboarding.productProfile?.stored.confirmedAt && !onboarding.audit
      ? getAuditReadiness(supabase, projectId)
      : null,
    onboarding.state === "audit_reveal" ? getLatestSuccessfulAudit(supabase, projectId) : null,
    onboarding.state === "first_move" ? getActiveOpportunityOperation(supabase, projectId) : null,
    onboarding.state === "first_move" ? getOnboardingFirstMove(supabase, projectId) : null,
    /*
     * The last attempt, when it failed and the founder has not been told
     * (UI-S1 §15). Read only for the step that is on screen: a failed
     * understanding run is irrelevant once a profile exists.
     */
    onboarding.state === "product_scanning" && !onboarding.understandingOperation
      ? getLastFailedOperation(supabase, { projectId, operationType: "product_scan" })
      : null,
    /*
     * What the next audit costs, read only on the screen that asks (§O.3).
     *
     * It decides whether confirming the product may carry the audit with it:
     * one press while the audit is free, two once it is priced. Read in this
     * wave rather than inside the component, because the answer is a server
     * fact and the control that depends on it must not be able to guess.
     */
    onboarding.state === "product_reveal"
      ? getAuditAccessStatus(supabase, { projectId, userId: session.userId })
      : null,
    /*
     * The balance, only on the screen that offers a priced decision.
     *
     * A missing balance never suppresses a price — `CostDisclosure` states one
     * either way — so a failure here costs the affordability sentence and
     * nothing else.
     */
    onboarding.state === "first_move"
      ? getHeaderCreditBalance(supabase, { userId: session.userId }).catch(() => null)
      : null,
    /*
     * What has already happened, for the rail (§O.4).
     *
     * Unconditional, and the one read in this wave that is: the rail is on
     * screen in every state, and a column that emptied while a scan ran would
     * be the one part of Nova's environment that disappears exactly when she
     * is working. Six rows with a limit, the same read Home makes — the
     * expensive things on this route are the documents above, and they are
     * still gated.
     */
    listAuditEventsForProject(supabase, { projectId, userId: session.userId, limit: 6 }),
  ]);

  /* The Move onboarding ends on, when the Opportunity Engine produced one. */
  const firstOpportunity = onboarding.opportunities?.set.opportunities[0] ?? null;

  /*
   * `not_applicable` is exactly "nothing is owed" — the included first audit,
   * or a refresh Vibe owes. Anything else means Credits, and rule 60 keeps the
   * audit out of a question about whether Vibe read the product correctly.
   */
  const novaBundlesAudit =
    auditAccess !== null && novaRevealBundlesAudit(resolveAuditCreditGate(auditAccess));

  /*
   * Nova's sentence above the screens she narrates (§L Slice 4).
   *
   * The screens themselves are unchanged — `ProductScanExperience` still owns
   * the named stages, and the reveal card still owns what was understood and
   * the bounded correction form. What Nova adds is the sentence that says what
   * is happening and why she is asking, which is the half a founder reads
   * first and the half that was previously a heading.
   *
   * It was two screens when only two states had a sentence. All ten do now, so
   * `deriveNovaOnboarding`'s three-way position is no longer what decides
   * whether she speaks — the state itself is, through the table.
   */
  /*
   * Nova's sentence is no longer assembled here.
   *
   * `buildNovaScanFeed` and `buildNovaRevealFeed` produced a feed for two of
   * the ten states, and the page filtered it down to the messages and rendered
   * them in a box above the section. The thread reads `NOVA_ONBOARDING_MESSAGE`
   * for all ten instead — the same table those two functions now take their
   * own text from, so nothing was rewritten and the two cannot disagree.
   *
   * What did not move is the control under the reveal. `ProductConfirmation`
   * owns it, because it owns the correction form beside it: a bounded,
   * allowlisted set of fields Nova has no way to render and no business
   * restating. Both still read the same gate through `novaBundlesAudit`.
   */

  /*
   * What the audit step should show (UI-S1 §9–§12).
   *
   * Derived from the canonical records — what the founder said about a live
   * product, and whether Vibe holds a successful reading of one — rather than
   * from a stored flag. The completion action re-derives the same thing from
   * the same predicate, so "the screen offered it" and "the server allowed it"
   * cannot disagree.
   */
  const surface =
    onboarding.state === "audit_preparing" || onboarding.state === "audit_running"
      ? auditSurface({
          auditOperationActive: onboarding.auditOperation !== null,
          liveSiteStatus: onboarding.liveSiteStatus,
          hasLiveProductIntelligence: auditReadiness?.hasLiveProductIntelligence ?? false,
        })
      : null;

  /*
   * The one read that is genuinely sequential: it is gated on `surface`, which
   * is derived from `auditReadiness` above. A failed audit is irrelevant while
   * one is running, so the gate is the point rather than an obstacle.
   */
  const auditFailure =
    surface === "ready_to_start"
      ? await getLastFailedOperation(supabase, { projectId, operationType: "business_audit" })
      : null;

  if (
    onboarding.state === "first_move" &&
    onboarding.firstMoveViewedAt === null &&
    (Boolean(onboarding.opportunities?.set.opportunities[0]) || opportunityOperation === null)
  ) {
    const firstView = await markOnboardingMilestone(supabase, {
      projectId,
      milestone: "first_move_viewed_at",
    });
    if (firstView) {
      await recordAuditEvent(supabase, {
        userId: session.userId,
        projectId,
        eventType: "onboarding.first_move_viewed",
        metadata: {
          projectId,
          hasMove: (onboarding.opportunities?.set.opportunities.length ?? 0) > 0,
        },
      });
    }
  }

  /*
   * Whether this founder has a workspace to go back to. The same predicate the
   * dashboard uses to decide whether to redirect here, so a visible exit can
   * never bounce off `/app` and land back on this page.
   */
  const canLeave = await hasCompletedAnyOnboarding(supabase, session.userId);

  const understanding = onboarding.productProfile
    ? buildUnderstandingView(
        onboarding.productProfile.profile,
        onboarding.productProfile.stored.synthesized,
      )
    : null;
  const scanPresentation =
    onboarding.productProfile &&
    onboarding.understandingOperation?.resultId === onboarding.productProfile.stored.id
      ? buildProductScanPresentation(
          onboarding.productProfile.profile,
          onboarding.productProfile.stored.synthesized,
          onboarding.projectName,
        )
      : null;

  /*
   * The run in flight, whichever it is. One setup state has at most one, so
   * the header takes an operation rather than a list to choose between.
   */
  const runningOperation = onboarding.understandingOperation ?? onboarding.auditOperation ?? null;

  return (
    <OnboardingShell
      email={session.email}
      state={onboarding.state}
      projectName={onboarding.projectName}
      canLeave={canLeave}
    >
      <NovaRoom
        /*
          The row Nova assembled, and the reason the opening's choreography is
          not decoration: the mark travels into this header and the rail is
          drawn beside it. Both have to still be here afterwards, or the
          founder watched something be built and thrown away — so this is the
          same `NovaRoom` the opening composes, not a second grid that looks
          like it.

          The header is deliberately unwrapped: it is `sticky top-0`, and a
          sticky element only sticks inside its own containing block — the
          same thing that made Home's header scroll away with the thread.
        */
        header={
          <NovaOnboardingHeader
            state={onboarding.state}
            projectId={projectId}
            projectName={onboarding.projectName}
            connected={onboarding.repository !== null}
            operation={runningOperation}
          />
        }
        rail={
          /*
            Her side of the room. No Action Plan — there is none until the
            audit has run — and in its place setup's own four steps, in the
            same marks the plan uses.

            That list was removed once, from a nav above the thread, on the
            argument that it was "a to-do list about Vibe's process rather
            than anything a founder decides". It is not a decision, and it was
            never meant to be: Nova's sentence says where we are, and this is
            the only thing on the screen that says how much of it there is.
            The mistake was the position, not the list.
          */
          <NovaRail
            presence={novaPresenceState({
              tier: NOVA_ONBOARDING_TIER[onboarding.state],
              phase: operationPollPhase(runningOperation),
            })}
            seed={projectId}
            working={novaWorkingEntry(
              runningOperation
                ? {
                    type:
                      runningOperation === onboarding.auditOperation
                        ? "business_audit"
                        : "product_scan",
                    view: runningOperation,
                  }
                : null,
            )}
            checklist={null}
            setup={onboardingSteps(onboarding.state)}
            activity={buildActivityFeed(auditEvents.events).reverse()}
          />
        }
      >
        <div className="flex flex-col gap-6">
          {onboarding.state === "connect_source" && (
            <NovaOnboardingThread
              state="connect_source"
              control={<NovaMoveLink href="/app/connect/github" label="Connect GitHub" />}
            />
          )}

          {onboarding.state === "add_live_product" && (
            <NovaOnboardingThread
              state="add_live_product"
              blockLabel="Where your product runs"
              block={
                <div className="flex flex-col gap-5">
                  {/*
                The repository, as a fact rather than a sentence. Its name is
                repository-derived and therefore untrusted (rule 25): rendered
                as text, never interpolated into a href or a class.
              */}
                  {onboarding.repository && (
                    <div className="border-line-2 bg-surface-2 rounded-nav flex flex-wrap items-center justify-between gap-3 border px-3 py-2">
                      <span className="text-fg-body text-sm font-medium">
                        {onboarding.repository.fullName}
                      </span>
                      <span className="text-fg-meta font-mono text-xs">
                        {onboarding.repository.defaultBranch} · connected
                      </span>
                    </div>
                  )}
                  <LiveSiteStep
                    projectId={projectId}
                    currentUrl={onboarding.productionUrl}
                    liveScanFailed={onboarding.liveSiteStatus === "scan_failed"}
                  />
                </div>
              }
            />
          )}

          {onboarding.state === "product_scanning" && (
            <NovaOnboardingThread
              state="product_scanning"
              /*
            The scan writes its own "Product scan · live", so the frame does
            not write it again. `variant="onboarding"` stays: it is not only
            framing — it also owns the pause before this route refreshes on a
            completed run, and the submit this flow ends on.
          */
              blockNamesItself
              blockLabel="Product scan"
              block={
                onboarding.understandingOperation ? (
                  <>
                    <ProductScanExperience
                      projectId={projectId}
                      variant="onboarding"
                      initialOperation={onboarding.understandingOperation}
                      initialEvents={scanEvents}
                      initialPresentation={scanPresentation}
                      productName={onboarding.projectName}
                    />
                    {onboarding.understandingOperation.stalled && (
                      <OnboardingStalled
                        what="getting to know your product"
                        action={<RetryProductScan projectId={projectId} />}
                      />
                    )}
                  </>
                ) : understandingFailure ? (
                  <OnboardingOperationFailure
                    what="getting to know your product"
                    operation={understandingFailure}
                    action={<RetryProductScan projectId={projectId} />}
                  />
                ) : (
                  /*
                No run and no failure: the repository is connected and nothing
                has read it yet. The reassurance is the block's, because it is
                about the repository rather than about Nova.
              */
                  <div className="flex flex-col gap-4">
                    <p className="text-fg-body text-sm">
                      Your repository stays connected. Nothing else needs repeating.
                    </p>
                    <RetryProductScan projectId={projectId} />
                  </div>
                )
              }
            />
          )}

          {onboarding.state === "product_reveal" && understanding && onboarding.productProfile && (
            <NovaOnboardingThread
              state="product_reveal"
              blockLabel="What I understood"
              block={
                <div className="flex flex-col items-center gap-7 text-center">
                  {understanding.brand.logo ? (
                    <ProductLogo
                      src={understanding.brand.logo.url}
                      alt={understanding.brand.logo.alt}
                      size={44}
                    />
                  ) : (
                    <VibeMark size={44} />
                  )}
                  <div className="flex flex-col gap-3">
                    {/* The product's own headline, which is what the block is about.
                  Nova's sentence is above the block and does not repeat it. */}
                    <h2 className="text-fg text-title leading-snug font-semibold">
                      {understanding.headline.title}
                    </h2>
                    {understanding.headline.productName && (
                      <p className="text-fg-body text-xl font-semibold">
                        {understanding.headline.productName}
                      </p>
                    )}
                    {understanding.headline.understanding && (
                      <p className="text-fg-prose mx-auto max-w-[62ch] leading-relaxed">
                        {understanding.headline.understanding}
                      </p>
                    )}
                  </div>
                  <ProductRevealFacts facts={understanding.audience.slice(0, 2)} />

                  <div className="border-line-2 w-full border-t pt-6">
                    <h3 className="text-fg-body mb-4 font-semibold">Did Vibe get this right?</h3>
                    <ProductConfirmation
                      projectId={projectId}
                      profileId={onboarding.productProfile.stored.id}
                      bundlesAudit={novaBundlesAudit}
                      values={{
                        name: onboarding.productProfile.profile.identity.name.value ?? "",
                        shortDescription:
                          onboarding.productProfile.profile.identity.shortDescription.value ?? "",
                        understanding:
                          onboarding.productProfile.profile.identity.understanding.value ?? "",
                        mainPurpose:
                          onboarding.productProfile.profile.identity.mainPurpose.value ?? "",
                        mainPromise:
                          onboarding.productProfile.profile.identity.mainPromise.value ?? "",
                        primaryAudience:
                          onboarding.productProfile.profile.audience.primaryAudience.value ?? "",
                        problemSolved:
                          onboarding.productProfile.profile.audience.problemSolved.value ?? "",
                      }}
                    />
                  </div>
                </div>
              }
            />
          )}

          {(onboarding.state === "audit_preparing" || onboarding.state === "audit_running") && (
            <NovaOnboardingThread
              state={onboarding.state}
              blockLabel="Business audit"
              block={
                surface === "running" && onboarding.auditOperation ? (
                  <>
                    <OperationWatcher projectId={projectId} operation={onboarding.auditOperation} />
                    {onboarding.auditOperation.stage === "running_ai" ? (
                      <AuditAnalyzing />
                    ) : (
                      <AuditPreparing />
                    )}
                    {onboarding.auditOperation.stalled && (
                      <OnboardingStalled
                        what="looking at your business"
                        action={
                          onboarding.productProfile ? (
                            <StartAudit
                              projectId={projectId}
                              profileId={onboarding.productProfile.stored.id}
                            />
                          ) : undefined
                        }
                      />
                    )}
                  </>
                ) : surface === "parked_no_live_product" ? (
                  <AuditLivePrerequisite projectId={projectId} mode="parked" />
                ) : surface === "awaiting_live_product" ? (
                  <AuditLivePrerequisite projectId={projectId} mode="awaiting" />
                ) : auditFailure ? (
                  <OnboardingOperationFailure
                    what="looking at your business"
                    operation={auditFailure}
                    action={
                      onboarding.productProfile ? (
                        <StartAudit
                          projectId={projectId}
                          profileId={onboarding.productProfile.stored.id}
                        />
                      ) : undefined
                    }
                  />
                ) : onboarding.productProfile ? (
                  <StartAudit
                    projectId={projectId}
                    profileId={onboarding.productProfile.stored.id}
                  />
                ) : null
              }
            />
          )}

          {onboarding.state === "audit_needs_user" && onboarding.pausedAudit && (
            <NovaOnboardingThread
              state="audit_needs_user"
              tone="waiting"
              blockLabel="Needs your answer"
              block={
                <NeedsUserPanel projectId={projectId} question={onboarding.pausedAudit.question} />
              }
            />
          )}

          {onboarding.state === "audit_reveal" && revealedAudit?.result && (
            <NovaOnboardingThread
              state="audit_reveal"
              /* The reveal writes its own heading and its own reading. */
              blockNamesItself
              blockLabel="Business audit"
              block={<OnboardingAuditReveal audit={revealedAudit.result} projectId={projectId} />}
            />
          )}

          {onboarding.state === "first_move" && (
            <>
              <OperationWatcher projectId={projectId} operation={opportunityOperation} />
              <NovaOnboardingThread
                state="first_move"
                blockLabel="Where I would start"
                block={
                  onboarding.opportunities?.set.opportunities[0] ? (
                    <div className="flex flex-col gap-4">
                      <h2 className="text-fg text-title font-semibold">
                        {onboarding.opportunities.set.opportunities[0].title}
                      </h2>
                      <p className="text-fg-prose leading-relaxed">
                        {onboarding.opportunities.set.opportunities[0].problem}
                      </p>
                      <div className="border-line-2 border-t pt-4">
                        <p className="text-fg-meta mb-1 text-xs">Why this comes first</p>
                        <p className="text-fg-secondary text-sm leading-relaxed">
                          {onboarding.opportunities.set.opportunities[0].whyNow}
                        </p>
                      </div>
                      {firstMovePlan?.firstActionableStep && (
                        <div className="border-line-2 border-t pt-4">
                          <p className="text-fg-meta mb-1 text-xs">
                            Vibe already has a plan — starting with
                          </p>
                          <p className="text-fg-body text-sm font-medium">
                            {firstMovePlan.firstActionableStep.title}
                          </p>
                          <p className="text-fg-muted mt-1 text-xs">
                            {ACTOR_LABELS[firstMovePlan.firstActionableStep.actor]} ·{" "}
                            {
                              EXECUTION_SUPPORT_LABELS[
                                firstMovePlan.firstActionableStep.executionSupport
                              ]
                            }
                          </p>
                        </div>
                      )}
                    </div>
                  ) : opportunityOperation ? (
                    <div className="flex flex-col gap-3" role="status">
                      <p className="text-fg-body text-sm">
                        You can leave and come back. No Move will be invented while this runs.
                      </p>
                    </div>
                  ) : (
                    <Notice tone="info" label="Your Audit is ready">
                      Vibe knows where the business needs attention first. No actual Next Move is
                      available yet, so onboarding will not pretend one exists.
                    </Notice>
                  )
                }
                control={
                  !opportunityOperation ? (
                    <>
                      {/*
                Onboarding ends on a decision, not a door (audit Slice 6).
                
                The founder has just read the one Move Vibe would start with
                and why it comes first; offering only a way out of the flow
                spent the whole of onboarding on a recommendation nobody could
                act on from the screen that made it. The price is on the
                control, and leaving stays free.
                
                Named for where it goes: this opens *this project's* workspace,
                not the global dashboard — "Go to dashboard" sent people
                looking for a screen they had not been taken to (UI-S1 §16).
              */}
                      {firstOpportunity ? (
                        <FirstMoveDecision
                          projectId={projectId}
                          opportunityId={firstOpportunity.id}
                          balance={balance}
                          skip={
                            <button
                              type="submit"
                              formAction={completeOnboardingAction.bind(null, projectId)}
                              className="text-fg-secondary hover:text-fg rounded-sm text-sm underline underline-offset-4 transition-interactive"
                            >
                              Go to my workspace
                            </button>
                          }
                        />
                      ) : (
                        <form action={completeOnboardingAction.bind(null, projectId)} noValidate>
                          <NovaMoveButton type="submit" label="Go to my workspace" />
                        </form>
                      )}
                    </>
                  ) : undefined
                }
              />
            </>
          )}
        </div>
      </NovaRoom>
    </OnboardingShell>
  );
}
