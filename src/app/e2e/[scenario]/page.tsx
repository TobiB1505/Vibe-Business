import { Suspense } from "react";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { SkeletonSection } from "@/components/ui/skeleton";
import { PlanDetailPanel } from "@/app/app/projects/[projectId]/plan/plan-detail-panel";
import type { PreparedChangeWorkspaceItem } from "@/modules/execution/workspace";
import {
  AgentPreviewActions,
  AgentReviewDecision,
} from "@/app/app/projects/[projectId]/agent/agent-stage-actions";
import { preparedChangeAnchorId } from "@/components/layout/project-shell";
import { novaControlLabel } from "@/modules/nova/home-view";
import { IntelligenceSummary } from "@/app/app/projects/[projectId]/intelligence-summary";
import { AuditOverview } from "@/app/app/projects/[projectId]/audit-overview";
import { crossCheckIntelligence } from "@/modules/repository-intelligence/cross-check";
import { SourceCoverageStrip } from "@/components/system/source-coverage";
import { ProductRevealFacts } from "@/app/app/onboarding/[projectId]/reveal-facts";
import { buildSourceCoverage } from "@/modules/provenance/source-coverage";
import { buildBusinessBrainView } from "@/modules/projects/business-brain-view";
import { AuditCreditNotice } from "@/app/app/projects/[projectId]/audit-credit-notice";
import { RunAuditButton } from "@/app/app/projects/[projectId]/run-audit-button";
import { auditBlockedByCredits } from "@/modules/business-audit/entitlement";
import { NeedsUserPanel } from "@/app/app/projects/[projectId]/needs-user-panel";
import {
  AuditAnalyzing,
  AuditPreparing,
  AuditWaitingHeader,
} from "@/app/app/projects/[projectId]/audit-lifecycle";
import { creditsToUnits } from "@/modules/credits/units";
import { novaPresenceState } from "@/components/system/status-vocabulary";
import { FocusCard } from "../design-studies/legacy-focus-card";
import { AttentionStack } from "../design-studies/legacy-attention-stack";
import { WorkingStrip } from "../design-studies/legacy-working-strip";
import { ProductIdentity } from "../design-studies/legacy-product-identity";
import { HealthScore } from "../design-studies/legacy-health-score";
import { FindingCard } from "@/components/system/finding-card";
import { NOVA_ACTION_META } from "@/modules/nova/actions";
import { StudyShell } from "../design-studies/study-shell";
import { StudyNovaHome } from "../design-studies/study-nova-home";
import { StudyComposition } from "../design-studies/study-composition";
import { StudyVoice } from "../design-studies/study-voice";
import { StudyChat } from "../design-studies/study-chat";
import { StudyConsole } from "../design-studies/study-console";
import { StudyMoments } from "../design-studies/study-moments";
import { StudyBlocked } from "../design-studies/study-blocked";
import { StudyMove } from "../design-studies/study-move";
import { StudyBubble } from "../design-studies/study-bubble";
import { StudyWireframe } from "../design-studies/study-wireframe";
import { StudyBlock } from "../design-studies/study-block";
import { StudyRail } from "../design-studies/study-rail";
import { StudyOpening, StudyOpeningWalkthrough } from "../design-studies/study-opening";
import { StudyOnboarding } from "../design-studies/study-onboarding";
import { NovaOpeningScreen } from "@/app/app/projects/[projectId]/nova/nova-opening-screen";
import { NovaFirstRun } from "@/app/app/onboarding/[projectId]/nova-first-run";
import { NovaOnboardingHeader } from "@/app/app/onboarding/[projectId]/nova-onboarding-header";
import { NovaRail } from "@/app/app/projects/[projectId]/nova/nova-rail";
import { NOVA_THREAD_SURFACE, NovaRoom } from "@/components/nova/nova-room";
import { buildNovaFirstRunFeed } from "@/modules/nova/first-run";
import { onboardingSteps } from "@/modules/onboarding/state";
import { NovaOnboardingThread } from "@/app/app/onboarding/[projectId]/nova-onboarding-thread";
import { OnboardingAuditReveal } from "@/app/app/onboarding/[projectId]/audit-reveal";
import { FirstMoveDecision } from "@/app/app/onboarding/[projectId]/first-move-decision";
import { NovaMoveButton } from "@/components/nova/nova-move";
import { LiveSiteStep } from "@/app/app/onboarding/[projectId]/live-site-step";
import { ProductConfirmation } from "@/app/app/onboarding/[projectId]/product-confirmation";
import { VibeMark } from "@/components/brand/vibe-mark";
import { StudyLabels } from "../design-studies/study-labels";
import { StudyMono } from "../design-studies/study-mono";
import {
  ACTIONS_SCENARIO,
  BACKGROUND_SCENARIO,
  BLOCKED_SCENARIO,
  BLOCK_SCENARIO,
  BUBBLE_SCENARIO,
  BUTTON_LOOK_SCENARIO,
  BUTTON_SCENARIO,
  CHAT_ANSWERED_SCENARIO,
  COMPOSITION_DENSE_SCENARIO,
  COMPOSITION_SETTLED_SCENARIO,
  CONSOLE_IDLE_SCENARIO,
  CREDITS_SCENARIO,
  CTA_SCENARIO,
  DISCLOSURE_SCENARIO,
  DISMISS_SCENARIO,
  FIGURE_SCENARIO,
  FORMS_SCENARIO,
  ICON_ACTIONS_SCENARIO,
  INLINE_SCENARIO,
  LABELS_SCENARIO,
  LINKS_SCENARIO,
  MARK_SCENARIO,
  MOMENTS_SCENARIO,
  MONO_SCENARIO,
  MOVE_SCENARIO,
  ONBOARDING_BLOCKS_SCENARIO,
  ONBOARDING_SCENARIO,
  OPENING_SCENARIO,
  OPENING_WALKTHROUGH_SCENARIO,
  RAIL_SCENARIO,
  REPOSITORIES_SCENARIO,
  PROFILE_SCENARIO,
  PRODUCTS_SCENARIO,
  LANDING_SCENARIO,
  HERO_CARD_SCENARIO,
  HERO_SHAPE_SCENARIO,
  SHIPPED_FIRST_RUN_SCENARIO,
  SHIPPED_OPENING_SCENARIO,
  STUDIES,
  TYPE_SCENARIO,
  VOICE_DENSE_SCENARIO,
  VOICE_SETTLED_SCENARIO,
  WIREFRAME_OFFLINE_SCENARIO,
  chosenStudy,
  isChatScenario,
  isCompositionScenario,
  isConsoleScenario,
  isVoiceScenario,
  isWireframeScenario,
  studyByScenario,
} from "../design-studies/studies";
import {
  isE2eNovaScenario,
  novaScenarioHealth,
  novaScenarioView,
  NOVA_SCENARIO_PRIORITY,
} from "../nova-scenarios";
import { E2E_ACTION_PLAN_SCENARIOS, isE2eActionPlanScenario } from "../action-plan-scenarios";
import { E2E_AUDIT_SCENARIOS, isE2eAuditScenario } from "../audit-scenarios";
import {
  E2E_AGENT_SCENARIOS,
  E2E_HOME_SCENARIOS,
  isE2eAgentScenario,
  isE2eHomeScenario,
} from "../command-center-scenarios";
import { AgentPanel } from "@/app/app/projects/[projectId]/agent-panel";
import { HomeStatus } from "@/app/app/projects/[projectId]/home-status";
import { EXECUTION_REASON_LABELS } from "@/modules/execution-contract/view";
import { AgentPlanNextNotice } from "@/app/app/projects/[projectId]/agent/agent-plan-next-notice";
import { AgentStaleReadNotice } from "@/app/app/projects/[projectId]/agent/agent-stale-read-notice";
import { AgentWorkspaceChoice } from "@/app/app/projects/[projectId]/agent/agent-workspace-choice";
import { Button } from "@/components/ui/button";
import {
  ANSWERED_WORKSPACE_ROOT,
  E2E_WORKSPACE_CHOICE_SCENARIOS,
  isE2eWorkspaceChoiceScenario,
} from "../workspace-choice-scenarios";
import { OperatorConsole } from "@/app/app/internal/console";
import {
  E2E_INTERNAL_CONSOLE_SCENARIOS,
  isE2eInternalConsoleScenario,
} from "../internal-console-scenarios";
import { AppErrorPreview } from "../app-error-preview";
import BillingLoading from "@/app/app/(account)/settings/billing/loading";
import { E2E_AUDIT_CREDIT_SCENARIOS, isE2eAuditCreditScenario } from "../audit-credit-scenarios";
import { e2eProvenance, isE2eProvenanceScenario } from "../provenance-scenarios";
import {
  E2E_NOVA_VOICE_SCENARIOS,
  isE2eNovaVoiceScenario,
  novaVoiceEntry,
} from "../nova-voice-scenarios";
import { NovaFocusThread } from "@/app/app/projects/[projectId]/nova/nova-focus-thread";
import { ProvenancePanel } from "@/app/app/projects/[projectId]/provenance-panel";
import { E2E_AGENT_STAGE_SCENARIOS, isE2eAgentStageScenario } from "../agent-stage-scenarios";
import { AgentWorkspacePanel } from "@/app/app/projects/[projectId]/agent/agent-workspace-panel";
import { AgentActivity } from "@/app/app/projects/[projectId]/agent/agent-activity";
import { AgentValidationChecks } from "@/app/app/projects/[projectId]/agent/agent-validation-checks";
import { AgentFileActivity } from "@/app/app/projects/[projectId]/agent/agent-file-activity";
import { AgentRunFiles } from "@/app/app/projects/[projectId]/agent/agent-run-files";
import { ChangeHistoryTable } from "@/app/app/projects/[projectId]/agent/change-history-table";
import { WithheldPaths } from "@/app/app/projects/[projectId]/agent/withheld-paths";
import { ValidationDepthNote } from "@/app/app/projects/[projectId]/agent/validation-depth-note";
import { CostLine } from "@/components/system/cost-line";
import { AgentPreviewStage } from "@/app/app/projects/[projectId]/agent/agent-preview-stage";
import { PreviewPanel } from "@/app/app/projects/[projectId]/preview-panel";
import { AgentMergeStage } from "@/app/app/projects/[projectId]/agent/agent-merge-stage";
import { AgentCore } from "@/app/app/projects/[projectId]/agent/agent-core";
import { AgentBuildStage } from "@/app/app/projects/[projectId]/agent/agent-build-stage";
import { AgentValidateStage } from "@/app/app/projects/[projectId]/agent/agent-validate-stage";
import { AgentReadyStage } from "@/app/app/projects/[projectId]/agent/agent-ready-stage";
import { AgentRunTaskHeader } from "@/app/app/projects/[projectId]/agent/agent-run-task-header";
import { E2E_NEEDS_USER_SCENARIOS, isE2eNeedsUserScenario } from "../needs-user-scenarios";
import {
  E2E_PROFILE_SCENARIOS,
  isE2eProfileScenario,
  E2E_PRODUCTS_SCENARIOS,
  E2E_REPOSITORIES_SCENARIOS,
  isE2eProductsScenario,
  isE2eRepositoriesScenario,
} from "../account-scenarios";
import { ProfileView } from "@/app/app/(account)/settings/profile/profile-view";
import { DeleteAccountSection } from "@/app/app/(account)/settings/delete-account";
import { E2E_ERASURE_SCENARIOS, isE2eErasureScenario } from "../erasure-scenarios";
import { ProductsIndex } from "@/app/app/(account)/settings/products/products-index";
import { RepositoriesIndex } from "@/app/app/(account)/settings/repositories/repositories-index";
import { StudyActions } from "../design-studies/study-actions";
import { StudyButton } from "../design-studies/study-button";
import { StudyButtonLook } from "../design-studies/study-button-look";
import { StudyCta } from "../design-studies/study-cta";
import { StudyRepositories } from "../design-studies/study-repositories";
import { StudyProfile } from "../design-studies/study-profile";
import { StudyProducts } from "../design-studies/study-products";
import { StudyLanding } from "../design-studies/study-landing";
import { StudyHeroCard } from "../design-studies/study-hero-card";
import { StudyHeroShape } from "../design-studies/study-hero-shape";
import { StudyIconActions } from "../design-studies/study-icon-actions";
import { StudyMark } from "../design-studies/study-mark";
import { StudyDismiss } from "../design-studies/study-dismiss";
import { StudyInline } from "../design-studies/study-inline";
import { StudyDisclosure } from "../design-studies/study-disclosure";
import { StudyBackground } from "../design-studies/study-background";
import { StudyCredits } from "../design-studies/study-credits";
import { StudyForms } from "../design-studies/study-forms";
import { StudyType } from "../design-studies/study-type";
import { StudyFigure } from "../design-studies/study-figure";
import { StudyLinks } from "../design-studies/study-links";
import { AccountShell, SettingsRail } from "@/components/layout/account-shell";
import { AppFrame, RailBrand, RailFooter } from "@/components/layout/app-frame";
import {
  PROJECT_SECTIONS,
  ProjectBreadcrumb,
  ProjectShell,
  ProjectRail,
  WorkspaceSection,
  projectSectionHref,
  type ProjectNavItem,
} from "@/components/layout/project-shell";
import {
  E2E_CHANGE_HISTORY,
  E2E_CHANGE_HISTORY_MOVES,
} from "../change-history-scenarios";
import { E2E_SCENARIOS, isE2eScenario } from "../scenarios";
import { E2E_INTELLIGENCE_SCENARIOS, isE2eIntelligenceScenario } from "../intelligence-scenarios";
import {
  E2E_UNDERSTANDING_SCENARIOS,
  isE2eUnderstandingScenario,
} from "../understanding-scenarios";
import { UnderstandingPanel } from "@/app/app/projects/[projectId]/understanding-panel";
import { UnderstandingConfirm } from "@/app/app/projects/[projectId]/understanding-confirm";
import { UnderstandingProgress } from "@/app/app/projects/[projectId]/understanding-progress";
import { ProductScanExperience } from "@/components/product-scan/product-scan-experience";
import { E2E_PRODUCT_SCAN_SCENARIOS, isE2eProductScanScenario } from "../product-scan-scenarios";
import { ProductScanRevealFixture } from "../product-scan-reveal-fixture";
import { AuditLivePrerequisite } from "@/app/app/onboarding/[projectId]/audit-live-prerequisite";
import {
  OnboardingOperationFailure,
  OnboardingStalled,
} from "@/app/app/onboarding/[projectId]/operation-states";
import { RetryProductScan } from "@/app/app/onboarding/[projectId]/phase-actions";
import { UnderstandingStatus } from "@/app/app/onboarding/[projectId]/understanding-status";
import { AgentStartRefusalNotice } from "@/app/app/projects/[projectId]/agent/agent-start-refusal-notice";
import { ActionPlanWorkspace } from "@/app/app/projects/[projectId]/plan/action-plan-workspace";
import { MovesRefreshBar } from "@/app/app/projects/[projectId]/plan/moves-refresh-bar";
import type { ActionPlanReadiness } from "@/modules/action-plans/service";
import { ProductLogo } from "@/components/brand/product-logo";
import { BillingView } from "@/app/app/(account)/settings/billing/billing-view";
import { E2E_BILLING_SCENARIOS, isE2eBillingScenario } from "../billing-scenarios";
import { DeepScanPanel } from "@/app/app/projects/[projectId]/deep-scan-panel";
import { AtmosphereField } from "@/components/layout/atmosphere";
import { CookieSettings } from "@/components/consent/cookie-settings";
import { Surface } from "@/components/ui/surface";
import { ProjectSettingsView } from "@/app/app/projects/[projectId]/settings/project-settings-view";
import { ScanHandoff } from "@/app/app/projects/[projectId]/scan-handoff";
import { DeepScanDialogFixture } from "./deep-scan-dialog-fixture";
import {
  E2E_DEEP_SCAN_SCENARIOS,
  E2E_ONBOARDING_DEEP_SCAN_SCENARIOS,
  E2E_DEEP_SCAN_SPOTLIGHT_SCENARIOS,
  isE2eDeepScanScenario,
  isE2eDeepScanSpotlightScenario,
} from "../deep-scan-scenarios";
import { DeepScanSpotlight } from "@/app/app/projects/[projectId]/product/deep-scan-spotlight";
import { buildDeepScanSpotlight } from "@/modules/authenticated-product-intelligence/spotlight";
import { E2E_MOVES_SCENARIOS, isE2eMovesScenario } from "../moves-scenarios";
import { agentReadyForecastNotes } from "../agent-stage-scenarios";
import {
  E2E_ONBOARDING_SCENARIOS,
  isE2eOnboardingScenario,
  isE2eOnboardingStaticScenario,
} from "../onboarding-scenarios";

/**
 * The browser harness's only entry point (Sprint 11C.1).
 *
 * ## Why this route exists
 *
 * Because the Merge panel is the most consequential screen this product has,
 * and until now every claim about what it displays rested on assertions about
 * its *source*. Sprint 11A ended with four defects in a row where the domain
 * was correct and the screen was not — a running preview reported as absent,
 * stored screenshots reported as loading, a completed stop reported as nothing.
 * On a Merge panel that class of defect is a person pressing a button believing
 * something different from what it does.
 *
 * ## Why it renders fixtures rather than a database
 *
 * Honestly: because there is no isolated database available here. The machine
 * this was built on has no container runtime, so `supabase start` cannot run,
 * and pointing the suite at the production database was ruled out and stays
 * ruled out.
 *
 * So this route hands the **real** panels the same server-decided card objects
 * the real page builds, and the browser does the rest for real: server render,
 * hydration, the confirmation dialog, a full reload. What that proves is what
 * the components do with a given state. What it does **not** prove is the
 * wiring in `page.tsx` that produces the state, or RLS — and the 11A defects
 * lived in exactly that wiring, so this is a floor, not a ceiling. See
 * `docs/sprints/0011c1-merge-ui-e2e.md`.
 *
 * ## Why it cannot exist in production
 *
 * `VIBE_E2E_FIXTURES` is set by the Playwright web server and by nothing else —
 * not in `.env`, not in Vercel, not in any deployment. Without it this route is
 * a 404 on every scenario, so a deployed build has no fixture surface at all.
 *
 * That argument rests on an environment variable staying unset forever, in a
 * dashboard, by everyone (VB-043). It is a good argument and it is one
 * mistyped variable name away from being wrong — so production refuses this
 * route on its own terms as well, regardless of what any flag says. Two
 * independent reasons for the same 404: the flag, and the platform's own
 * statement about where the code is running.
 */

export const dynamic = "force-dynamic";

function fixturesEnabled(): boolean {
  // `VERCEL_ENV` is set by the platform, not by this repository, and a
  // production deployment cannot unset it. Checked first because it is the one
  // that does not depend on anybody remembering anything.
  if (process.env.VERCEL_ENV === "production") return false;
  return process.env.VIBE_E2E_FIXTURES === "1";
}

function FixtureRail({ credits, children }: { credits: number; children: ReactNode }) {
  return (
    <>
      <RailBrand />
      {children}
      {/*
        The balance, where the real rail carries it (audit R22) — so the
        browser proves a founder can see what they have from a project route,
        not only from Billing.
      */}
      <RailFooter
        credits={creditsToUnits(credits)}
        identity={{
          displayName: "Tobi",
          initials: "TB",
          avatarUrl: null,
          fromGithub: true,
          chosen: false,
        }}
      />
    </>
  );
}

function FixtureSettingsRail() {
  return (
    <FixtureRail credits={2480}>
      <SettingsRail back={{ href: "/app/projects/project_e2e", label: "Back to Acme" }} />
    </FixtureRail>
  );
}

export default async function E2eScenarioPage({
  params,
}: {
  params: Promise<{ scenario: string }>;
}) {
  // Checked before the scenario is even read, so an unset flag produces the
  // same 404 for a valid name and a probe.
  if (!fixturesEnabled()) notFound();

  const { scenario } = await params;

  /* The scenario name is rendered so a failing trace says which fixture was on
     screen, rather than leaving that to be inferred. */
  const label = (
    <p className="mb-4 text-caption text-fg-meta" data-testid="e2e-scenario">
      {scenario}
    </p>
  );

  /*
    A direction study renders its own shell — atmosphere, scope attribute and
    fonts — so it is checked before every other branch and deliberately does
    not draw the scenario label above the screen. The label belongs to a test
    trace; a study is a picture somebody looks at, and a stray line of debug
    text at the top of it is the first thing a reviewer would ask about.
  */
  /* The two follow-up comparisons both render in the chosen direction. */
  if (scenario === LABELS_SCENARIO || scenario === MONO_SCENARIO) {
    const chosen = STUDIES.find((entry) => entry.chosen);
    if (chosen) {
      return (
        <StudyShell study={chosen}>
          {scenario === LABELS_SCENARIO ? (
            <StudyLabels study={chosen} />
          ) : (
            <StudyMono study={chosen} />
          )}
        </StudyShell>
      );
    }
  }

  /* The composition studies vary rank rather than material, so they are always
     drawn in the direction that won — otherwise a reader cannot tell which of
     the two axes moved. */
  if (isWireframeScenario(scenario)) {
    const chosen = chosenStudy();
    return (
      <StudyShell study={chosen}>
        <StudyWireframe study={chosen} offline={scenario === WIREFRAME_OFFLINE_SCENARIO} />
      </StudyShell>
    );
  }

  if (scenario === BLOCK_SCENARIO) {
    const chosen = chosenStudy();
    return (
      <StudyShell study={chosen}>
        <StudyBlock study={chosen} />
      </StudyShell>
    );
  }

  if (scenario === RAIL_SCENARIO) {
    const chosen = chosenStudy();
    return (
      <StudyShell study={chosen}>
        <StudyRail study={chosen} />
      </StudyShell>
    );
  }

  if (scenario === OPENING_SCENARIO) {
    const chosen = chosenStudy();
    return (
      <StudyShell study={chosen}>
        <StudyOpening study={chosen} />
      </StudyShell>
    );
  }

  if (scenario === ONBOARDING_SCENARIO) {
    const chosen = chosenStudy();
    return (
      <StudyShell study={chosen}>
        <StudyOnboarding study={chosen} />
      </StudyShell>
    );
  }

  if (scenario === SHIPPED_OPENING_SCENARIO) {
    const chosen = chosenStudy();
    return (
      <StudyShell study={chosen}>
        {/*
          `OnboardingShell`'s own container, to the class.

          It was `max-w-2xl` — 672px — and that is the defect this fixture
          existed to prevent: a reviewer looking at a 300px rail beside a
          370px thread and calling the layout finished, while the screen a
          founder meets is 1216px wide. A fixture at the wrong width reviews
          a screen nobody has.
        */}
        <div className="mx-auto w-full max-w-[76rem] px-5 py-7 sm:px-8 sm:py-10">
          {/*
            The product's own component, in replay — so the button records
            nothing and the fixture needs no session. `projectId` is never used
            on that path.
          */}
          {/*
            `connected={false}`, because that is what the screen this fixture
            reviews actually shows: the introduction runs before anything is
            connected, so the header's "Disconnected" is a fact rather than a
            placeholder. Reviewing it as connected would review a state no
            founder meets here.
          */}
          <NovaOpeningScreen
            projectId="fixture-project"
            productName="Vibe Business"
            connected={false}
            /* A login, because that is the only kind of name this product
               ever has — never a first name derived from an address. */
            greetingName="ada-lovelace"
            setup={onboardingSteps("connect_source")}
            activity={[
              {
                id: "e1",
                eventType: "github.installation.connected",
                at: "2026-09-07T21:40:00.000Z",
                title: "GitHub installation connected",
                tone: "neutral",
                facts: [],
              },
              {
                id: "e2",
                eventType: "project.created",
                at: "2026-09-07T21:41:00.000Z",
                title: "Project created",
                tone: "neutral",
                facts: [],
              },
            ]}
            replay
          />
        </div>
      </StudyShell>
    );
  }

  if (scenario === ONBOARDING_BLOCKS_SCENARIO) {
    const chosen = chosenStudy();
    return (
      <StudyShell study={chosen}>
        <div className="mx-auto flex w-full max-w-[76rem] flex-col gap-8 px-5 py-7 sm:px-8 sm:py-10">
          {/*
            Setup's blocks with the shipped components inside them, at the
            thread's own width, so what is reviewed is the block *and* its
            body — which is where every one of these went wrong: a panel
            inside a panel, a poster heading under a frame that already had
            one, a control a level deeper than every other control.

            The bodies bind real Server Actions. Pressing does nothing useful
            in a fixture and is not the point; the point is that nobody had
            ever seen any of these on a screen.
          */}
          <BlockCase title="add_live_product">
            <NovaOnboardingThread
              state="add_live_product"
              blockLabel="Where your product runs"
              block={
                <div className="flex flex-col gap-5">
                  <div className="border-line-2 bg-surface-2 rounded-nav flex flex-wrap items-center justify-between gap-3 border px-3 py-2">
                    <span className="text-fg-body text-body font-medium">acme/acme-app</span>
                    <span className="text-fg-meta font-mono text-caption">main · connected</span>
                  </div>
                  <LiveSiteStep projectId="project_e2e" currentUrl={null} liveScanFailed={false} />
                </div>
              }
            />
          </BlockCase>

          <BlockCase title="product_scanning">
            <NovaOnboardingThread
              state="product_scanning"
              blockNamesItself
              blockLabel="Product scan"
              block={
                <ProductScanExperience
                  projectId="project_e2e"
                  variant="onboarding"
                  initialOperation={E2E_PRODUCT_SCAN_SCENARIOS.product_scan_complete.operation}
                  initialEvents={[...E2E_PRODUCT_SCAN_SCENARIOS.product_scan_complete.events]}
                  initialPresentation={
                    E2E_PRODUCT_SCAN_SCENARIOS.product_scan_complete.presentation
                  }
                  productName="Acme"
                />
              }
            />
          </BlockCase>

          <BlockCase title="product_reveal">
            <NovaOnboardingThread
              state="product_reveal"
              blockLabel="What I understood"
              block={<RevealBlockFixture />}
            />
          </BlockCase>

          {/*
            The signed-in step, in both readings.

            Which one a founder gets is decided by evidence rather than by a
            question — the public crawl either saw a path bounce to a login or
            it did not — and the two were never on a screen together, which is
            how the recommended one came to repeat Nova's own sentence back at
            her inside her own block.
          */}
          <BlockCase title="add_signed_in_product · a login was found">
            <NovaOnboardingThread
              state="add_signed_in_product"
              blockNamesItself
              blockLabel="Your signed-in product"
              block={
                <DeepScanPanel
                  projectId="project_e2e"
                  model={E2E_ONBOARDING_DEEP_SCAN_SCENARIOS.recommended}
                  presentation="block"
                />
              }
              control={
                <Button type="button" variant="secondary">
                  Not now — go on without it
                </Button>
              }
            />
          </BlockCase>

          <BlockCase title="add_signed_in_product · nothing found either way">
            <NovaOnboardingThread
              state="add_signed_in_product"
              blockNamesItself
              blockLabel="Your signed-in product"
              block={
                <DeepScanPanel
                  projectId="project_e2e"
                  model={E2E_ONBOARDING_DEEP_SCAN_SCENARIOS.not_recommended}
                  presentation="block"
                />
              }
              control={
                <Button type="button" variant="secondary">
                  Not now — go on without it
                </Button>
              }
            />
          </BlockCase>

          {/*
            The beat that was missing: what a founder sees after the browser
            closes. Setup used to answer ninety seconds of signing in with the
            next step's screen, because a completed snapshot ended the step —
            and a completed snapshot says Vibe read the product, not that
            anybody was shown the reading.
          */}
          <BlockCase title="signed_in_reveal">
            <NovaOnboardingThread
              state="signed_in_reveal"
              blockNamesItself
              blockLabel="Your signed-in product"
              block={
                <DeepScanPanel
                  projectId="project_e2e"
                  model={E2E_ONBOARDING_DEEP_SCAN_SCENARIOS.read}
                  presentation="block"
                />
              }
              control={<NovaMoveButton type="button" label="Go on to the audit" />}
            />
          </BlockCase>

          <BlockCase title="audit_preparing">
            <NovaOnboardingThread
              state="audit_preparing"
              blockLabel="Business audit"
              block={<AuditPreparing presentation="block" />}
            />
          </BlockCase>

          <BlockCase title="audit_running">
            <NovaOnboardingThread
              state="audit_running"
              blockLabel="Business audit"
              block={<AuditAnalyzing presentation="block" />}
            />
          </BlockCase>

          <BlockCase title="audit_needs_user">
            <NovaOnboardingThread
              state="audit_needs_user"
              tone="waiting"
              blockLabel="Needs your answer"
              block={
                <NeedsUserPanel
                  projectId="project_e2e"
                  question={E2E_NEEDS_USER_SCENARIOS.needs_user_first_customer()}
                  presentation="block"
                />
              }
            />
          </BlockCase>

          <BlockCase title="audit_reveal">
            <NovaOnboardingThread
              state="audit_reveal"
              blockLabel="Business audit"
              block={<OnboardingAuditReveal audit={E2E_AUDIT_SCENARIOS["audit-synthesis"]()} />}
              control={<NovaMoveButton label="Show me where to start" />}
            />
          </BlockCase>

          <BlockCase title="first_move">
            <NovaOnboardingThread
              state="first_move"
              blockLabel="Where I would start"
              block={
                <div className="flex flex-col gap-4">
                  <h2 className="text-fg text-title font-semibold">Give people a way to pay</h2>
                  <p className="text-fg-prose leading-relaxed">
                    There is no pricing page and no checkout anywhere on the live product.
                  </p>
                </div>
              }
              control={
                <FirstMoveDecision
                  projectId="project_e2e"
                  opportunityId="opportunity_e2e"
                  skip={
                    <button
                      type="button"
                      className="text-fg-secondary hover:text-fg transition-interactive rounded-inline text-body underline underline-offset-4"
                    >
                      Go to my workspace
                    </button>
                  }
                />
              }
            />
          </BlockCase>
        </div>
      </StudyShell>
    );
  }

  if (scenario === SHIPPED_FIRST_RUN_SCENARIO) {
    const chosen = chosenStudy();
    return (
      <StudyShell study={chosen}>
        <div className="mx-auto w-full max-w-[76rem] px-5 py-7 sm:px-8 sm:py-10">
          {/*
            `OnboardingShell`'s container and `NovaRoom`, so this is the screen
            the page renders rather than an arrangement that resembles it —
            the same header, the same rail, the same thread column.

            In replay: pressing records nothing. The walkthrough itself never
            wrote anything anyway, which is the point of the fixture — it is
            reachable here as many times as a reviewer needs.
          */}
          <NovaRoom
            header={
              <NovaOnboardingHeader
                state="connect_source"
                projectId="fixture-project"
                projectName="Vibe Business"
                connected={false}
                operation={null}
              />
            }
            rail={
              <NovaRail
                presence="listening"
                seed="fixture-project"
                working={null}
                checklist={null}
                setup={onboardingSteps("connect_source")}
                /* What the opening's rail had just shown, plus the row the
                   introduction itself wrote. The room does not empty out
                   between the two screens, and this fixture reviews that. */
                activity={[
                  {
                    id: "e1",
                    eventType: "github.installation.connected",
                    at: "2026-09-07T21:40:00.000Z",
                    title: "GitHub installation connected",
                    tone: "neutral",
                    facts: [],
                  },
                  {
                    id: "e2",
                    eventType: "project.created",
                    at: "2026-09-07T21:41:00.000Z",
                    title: "Project created",
                    tone: "neutral",
                    facts: [],
                  },
                ]}
              />
            }
          >
            <NovaFirstRun
              projectId="fixture-project"
              entries={buildNovaFirstRunFeed("explain_workflow")}
              replay
            />
          </NovaRoom>
        </div>
      </StudyShell>
    );
  }

  if (scenario === OPENING_WALKTHROUGH_SCENARIO) {
    const chosen = chosenStudy();
    return (
      <StudyShell study={chosen}>
        <StudyOpeningWalkthrough study={chosen} />
      </StudyShell>
    );
  }

  if (scenario === BUBBLE_SCENARIO) {
    const chosen = chosenStudy();
    return (
      <StudyShell study={chosen}>
        <StudyBubble study={chosen} />
      </StudyShell>
    );
  }

  if (scenario === MOVE_SCENARIO) {
    const chosen = chosenStudy();
    return (
      <StudyShell study={chosen}>
        <StudyMove study={chosen} />
      </StudyShell>
    );
  }

  if (scenario === BLOCKED_SCENARIO) {
    const chosen = chosenStudy();
    return (
      <StudyShell study={chosen}>
        <StudyBlocked study={chosen} />
      </StudyShell>
    );
  }

  if (scenario === MOMENTS_SCENARIO) {
    const chosen = chosenStudy();
    return (
      <StudyShell study={chosen}>
        <StudyMoments study={chosen} />
      </StudyShell>
    );
  }

  if (isConsoleScenario(scenario)) {
    const chosen = chosenStudy();
    return (
      <StudyShell study={chosen}>
        <StudyConsole study={chosen} idle={scenario === CONSOLE_IDLE_SCENARIO} />
      </StudyShell>
    );
  }

  if (isChatScenario(scenario)) {
    const chosen = chosenStudy();
    return (
      <StudyShell study={chosen}>
        <StudyChat study={chosen} answered={scenario === CHAT_ANSWERED_SCENARIO} />
      </StudyShell>
    );
  }

  if (isVoiceScenario(scenario)) {
    const chosen = chosenStudy();
    return (
      <StudyShell study={chosen}>
        <StudyVoice
          study={chosen}
          settled={scenario === VOICE_SETTLED_SCENARIO}
          dense={scenario === VOICE_DENSE_SCENARIO}
        />
      </StudyShell>
    );
  }

  if (isCompositionScenario(scenario)) {
    const chosen = chosenStudy();
    return (
      <StudyShell study={chosen}>
        <StudyComposition
          study={chosen}
          settled={scenario === COMPOSITION_SETTLED_SCENARIO}
          dense={scenario === COMPOSITION_DENSE_SCENARIO}
        />
      </StudyShell>
    );
  }

  const FOLLOW_UPS = {
    [LABELS_SCENARIO]: StudyLabels,
    [MONO_SCENARIO]: StudyMono,
    [ACTIONS_SCENARIO]: StudyActions,
    [BUTTON_SCENARIO]: StudyButton,
    [BUTTON_LOOK_SCENARIO]: StudyButtonLook,
    [CTA_SCENARIO]: StudyCta,
    [REPOSITORIES_SCENARIO]: StudyRepositories,
    [PROFILE_SCENARIO]: StudyProfile,
    [PRODUCTS_SCENARIO]: StudyProducts,
    [LANDING_SCENARIO]: StudyLanding,
    [HERO_CARD_SCENARIO]: StudyHeroCard,
    [HERO_SHAPE_SCENARIO]: StudyHeroShape,
    [ICON_ACTIONS_SCENARIO]: StudyIconActions,
    [MARK_SCENARIO]: StudyMark,
    [DISMISS_SCENARIO]: StudyDismiss,
    [INLINE_SCENARIO]: StudyInline,
    [DISCLOSURE_SCENARIO]: StudyDisclosure,
    [LINKS_SCENARIO]: StudyLinks,
    [BACKGROUND_SCENARIO]: StudyBackground,
    [CREDITS_SCENARIO]: StudyCredits,
    [FORMS_SCENARIO]: StudyForms,
    [TYPE_SCENARIO]: StudyType,
    [FIGURE_SCENARIO]: StudyFigure,
  } as const;
  const FollowUp = FOLLOW_UPS[scenario as keyof typeof FOLLOW_UPS];
  if (FollowUp) {
    const chosen = STUDIES.find((entry) => entry.chosen);
    if (chosen) {
      return (
        <StudyShell study={chosen}>
          <FollowUp study={chosen} />
        </StudyShell>
      );
    }
  }

  const study = studyByScenario(scenario);
  if (study) {
    return (
      <StudyShell study={study}>
        <StudyNovaHome study={study} />
      </StudyShell>
    );
  }

  if (isE2eNovaScenario(scenario)) {
    const view = novaScenarioView(scenario);
    const health = novaScenarioHealth(scenario);
    const entry = view.primary;
    const control = entry.control;
    const priced = control.kind === "server_action" ? control.option : null;
    /*
      Derived exactly as production derives it. A fixture that set the mark by
      hand could show a turning aperture over a scenario with nothing running,
      which is the claim `novaPresenceState` exists to make impossible.
    */
    const presence = novaPresenceState({
      tier: entry.tier,
      phase: view.working?.phase ?? "idle",
    });

    return (
      <main className="mx-auto flex max-w-3xl flex-col gap-8 p-8 max-sm:p-4">
        {label}

        {/*
          Mirrors `nova-home.tsx`, which opts this one screen into the
          contained field. The fixture composes Nova Home's parts by hand, so
          a part it leaves out is a part no browser test can see — and the
          ground is the part that decides whether the glass above it is glass.
        */}
        <AtmosphereField />

        <ProductIdentity
          name="Payflow"
          logoUrl={null}
          category="Developer tool"
          understood="confirmed"
          productHref="/app/projects/project_e2e/product"
        />

        {/*
          The real card, given the real view model. The control is a plain
          button rather than a live form: this fixture is about what a founder
          can see before pressing, and the price beside an unpressed control is
          exactly the claim under test.
        */}
        <FocusCard
          entry={entry}
          presence={presence}
          seed="project_e2e"
          operation={priced ? NOVA_ACTION_META[priced.actionId].price : null}
          /*
            Built through `creditsToUnits` rather than cast. A raw `420` is
            420 *internal units* — 0.42 Credits — and reads as unaffordable
            beside a 35-Credit price. The brand exists to catch exactly that,
            and casting past it is how a fixture ends up asserting a bug.
          */
          consequence={priced?.confirmationNote ?? undefined}
          /* The same label the button carries, so the fixture exercises the
             footnote's refusal to repeat it rather than rendering past it. */
          controlLabel={novaControlLabel(control) ?? undefined}
          control={
            /* Null covers both "nothing to press" and "answered in the card",
               and this fixture renders neither — it is the Focus Card's shape,
               not the answering flow. */
            novaControlLabel(control) === null ? undefined : (
              <Button variant="primary">{novaControlLabel(control)}</Button>
            )
          }
        />

        <WorkingStrip working={view.working} presence={presence} seed="project_e2e" />

        <AttentionStack
          entries={view.secondary}
          hrefFor={() => "/app/projects/project_e2e/agent"}
        />

        {health && (
          <HealthScore
            score={health.score}
            stateLabel={health.stateLabel}
            scoredLenses={health.scoredLenses}
            eligibleLenses={health.eligibleLenses}
            insufficientCoverageReason={health.insufficientCoverageReason}
            healthHref="/app/projects/project_e2e/health"
          />
        )}

        {health && (
          <FindingCard
            variant="priority"
            rank={1}
            title={NOVA_SCENARIO_PRIORITY.headline}
            explanation={NOVA_SCENARIO_PRIORITY.explanation}
            whyItMatters={NOVA_SCENARIO_PRIORITY.whyItMatters}
            severity={NOVA_SCENARIO_PRIORITY.severity}
            citations={NOVA_SCENARIO_PRIORITY.citations}
          />
        )}
      </main>
    );
  }

  if (isE2eProductScanScenario(scenario)) {
    const fixture = E2E_PRODUCT_SCAN_SCENARIOS[scenario];
    return (
      <main className="mx-auto max-w-7xl p-8 max-sm:p-4">
        {label}
        {scenario === "product_scan_reveal" ? (
          <ProductScanRevealFixture
            operation={fixture.operation}
            events={fixture.events}
            presentation={fixture.presentation}
          />
        ) : (
          <ProductScanExperience
            projectId="project_e2e"
            variant="workspace"
            initialOperation={fixture.operation}
            initialEvents={[...fixture.events]}
            initialPresentation={fixture.presentation}
            productName={fixture.presentation.name}
            hasProfile
            canStart
          />
        )}
      </main>
    );
  }

  // Repository intelligence (UI-3.6): the same component the overview route
  // renders, given the same snapshot shape a real analysis produces.
  if (isE2eIntelligenceScenario(scenario)) {
    const fixture = E2E_INTELLIGENCE_SCENARIOS[scenario]();
    return (
      <main className="mx-auto max-w-4xl p-8">
        {label}
        <IntelligenceSummary
          snapshot={fixture.snapshot}
          analyzedAt={fixture.analyzedAt}
          projectId="project_e2e"
          liveSnapshot={fixture.live}
        />
      </main>
    );
  }

  /*
   * The billing screen (BILLING CORE-2 §93). The same `BillingView` the real
   * route renders, given a complete `BillingOverview` written by hand from the
   * read model's own types — no database, no Stripe request, no AI call.
   */
  /*
   * The operator console renders from a complete snapshot, so the component
   * cannot tell this from production. Its own polling still runs and its
   * action still refuses — an unauthenticated fixture is not an operator — so
   * what this proves is the first frame, which is what a person opens during
   * an incident.
   */
  if (isE2eInternalConsoleScenario(scenario)) {
    return (
      <>
        {label}
        <OperatorConsole initial={E2E_INTERNAL_CONSOLE_SCENARIOS[scenario]} />
      </>
    );
  }

  if (isE2eBillingScenario(scenario)) {
    const fixture = E2E_BILLING_SCENARIOS[scenario];
    return (
      <main className="mx-auto max-w-5xl p-8">
        {label}
        <BillingView
          overview={fixture.overview}
          stripeReady={fixture.stripeReady}
          checkoutState={"checkoutState" in fixture ? fixture.checkoutState : undefined}
          at={"at" in fixture ? new Date(fixture.at) : undefined}
        />
      </main>
    );
  }

  /*
   * The Moves half of the Action Plan workspace (UI-S2 §41, §42; ACTION PLAN
   * UI-2). The same component the route renders, given lineage the real
   * resolver produced from a real audit shape.
   *
   * The plan half is deliberately at its offer state here: these scenarios are
   * about the list, and a fixture plan would put a second story on the screen.
   * The plan's own states have their own scenarios below.
   */
  if (isE2eMovesScenario(scenario)) {
    const fixture = E2E_MOVES_SCENARIOS[scenario]();
    const blocked = fixture.blockedReason !== null;
    const planReadinessByOpportunity: Record<string, ActionPlanReadiness> = Object.fromEntries(
      fixture.opportunities.map<[string, ActionPlanReadiness]>((opportunity, index) => [
        opportunity.id,
        {
          ready: !blocked,
          blockedReason: blocked ? "audit_missing" : null,
          auditId: null,
          opportunityId: opportunity.id,
          isDefaultMove: index === 0,
          conclusionKey: null,
          conclusionLineage: null,
          unresolvedSourceReason: null,
        },
      ]),
    );
    return (
      <main className="mx-auto max-w-[90rem] p-8">
        {label}
        <div className="mb-6 flex justify-end">
          <MovesRefreshBar
            projectId="project_e2e"
            generatedAt={null}
            hasOpportunities={fixture.opportunities.length > 0}
            blocked={blocked}
          />
        </div>
        <ActionPlanWorkspace
          projectId="project_e2e"
          opportunities={fixture.opportunities}
          executionStates={fixture.executionStates}
          branchUrls={{}}
          stale={fixture.stale}
          movesOperation={fixture.movesOperation}
          movesBlockedReason={fixture.blockedReason}
          lineage={fixture.lineage}
          movesContext={fixture.movesContext}
          movesHref="/app/projects/project_e2e/plan"
          preparedHref="/app/projects/project_e2e/agent"
          blockedDestinations={{
            product: "/app/projects/project_e2e/product",
            audit: "/app/projects/project_e2e#business-audit",
            moves: "/app/projects/project_e2e/plan",
            repository: "/app/projects/project_e2e/settings",
          }}
          selectedOpportunityId={fixture.opportunities[0]?.id ?? null}
          defaultMoveTitle={fixture.opportunities[0]?.title ?? null}
          planReadinessByOpportunity={planReadinessByOpportunity}
          handoffStepKey={null}
          repositoryFullName="TobiB1505/Vibe-Business"
          responsibilityByStepKey={{}}
          planView={null}
          planOperation={null}
          planOperationOpportunityId={null}
          auditHref="/app/projects/project_e2e#business-audit"
          understandingHref="/app/projects/project_e2e/product"
        />
      </main>
    );
  }

  // Onboarding's changed states (UI-S1 §23). The same components the setup
  // flow renders, given operation views the real builder produced.
  if (isE2eOnboardingScenario(scenario)) {
    const { operation } = E2E_ONBOARDING_SCENARIOS[scenario]();
    const failed = operation.status === "failed";
    return (
      <main className="mx-auto max-w-4xl p-8">
        {label}
        <div className="flex flex-col gap-4">
          {failed ? (
            <OnboardingOperationFailure
              what="getting to know your product"
              operation={operation}
              action={<RetryProductScan projectId="project_e2e" />}
            />
          ) : (
            <>
              <UnderstandingStatus operation={operation} liveSiteStatus="provided" />
              {operation.stalled && (
                <OnboardingStalled
                  what="getting to know your product"
                  action={<RetryProductScan projectId="project_e2e" />}
                />
              )}
            </>
          )}
        </div>
      </main>
    );
  }

  if (isE2eOnboardingStaticScenario(scenario)) {
    return (
      <main className="mx-auto max-w-4xl p-8">
        {label}
        {scenario === "onboarding_product_reveal" ? (
          /*
            The same component the reveal renders, on the same understanding
            view the real page builds — so what a browser proves here is what a
            founder is shown before answering "did Vibe get this right?".
          */
          <ProductRevealFacts
            facts={E2E_UNDERSTANDING_SCENARIOS.understanding_ready().view.audience.slice(0, 2)}
          />
        ) : scenario === "onboarding_logo_broken" ? (
          // The host does not exist, so the browser's load genuinely fails —
          // which is the only way to prove the fallback rather than assert it.
          <ProductLogo src="https://acme.test/logo.png" alt="Acme logo" size={44} />
        ) : (
          <AuditLivePrerequisite
            projectId="project_e2e"
            mode={scenario === "onboarding_audit_parked" ? "parked" : "awaiting"}
          />
        )}
      </main>
    );
  }

  // Product understanding (CORE-1 §51): the same panel the understanding route
  // renders, given a profile the real pipeline produced.
  if (isE2eUnderstandingScenario(scenario)) {
    const fixture = E2E_UNDERSTANDING_SCENARIOS[scenario]();
    const currentHref = `/e2e/${scenario}`;
    const navItems: ProjectNavItem[] = PROJECT_SECTIONS.map((section) => ({
      id: section.id,
      label: section.label,
      icon: section.icon,
      href:
        section.id === "my-product" ? currentHref : projectSectionHref("project_e2e", section.id),
      count: section.id === "action-plan" ? 3 : section.id === "agent" ? 13 : null,
      countTone: section.id === "action-plan" ? "accent" : "neutral",
    }));

    return (
      <AppFrame
        rail={
          <FixtureRail credits={35}>
            <ProjectRail
              projectId="project_e2e"
              projectName="Acme"
              connected
              planName="Free"
              switcherItems={[
                {
                  id: "project_e2e",
                  name: "Acme",
                  href: currentHref,
                  repositoryFullName: "acme/acme",
                },
                {
                  id: "project_e2e_planner",
                  name: "Planner Agent",
                  href: "/app/projects/project_e2e_planner",
                },
              ]}
              items={navItems}
            />
          </FixtureRail>
        }
      >
        <ProjectShell>
          <div className="sr-only">{label}</div>
          <ProjectBreadcrumb projectName="Acme" />
          <WorkspaceSection
            id="my-product"
            actions={
              <UnderstandingProgress
                projectId="project_e2e"
                hasProfile
                activeOperation={null}
                canStart
                blockedReason={null}
              />
            }
          >
            <UnderstandingPanel
              view={fixture.view}
              projectId="project_e2e"
              confirmedAt={fixture.confirmedAt}
              understoodAt="2026-08-15T12:00:00.000Z"
              founderIntent={{
                stage: "active_users",
                monetizationModel: "subscription",
                primaryGoal: "grow_revenue",
              }}
              founderContextHref="#founder-context"
              sources={[
                /*
                  The fixture states the same four sources the real page builds,
                  at the shape `SourceCoverage` fixed — including a partial read
                  with its reason and its measured count, which is the state the
                  grid of cards had no room for and no fixture ever showed.
                */
                {
                  source: "repository",
                  label: "Your code",
                  state: fixture.view.sources.some(
                    (source) => source.label === "Your code" && source.used,
                  )
                    ? "ready"
                    : "none",
                  detail: fixture.view.sources.some(
                    (source) => source.label === "Your code" && source.used,
                  )
                    ? "Vibe has read what your repository builds."
                    : "Vibe hasn't read your code yet.",
                  reasons: [],
                  measured: { files: 128 },
                  at: "2026-08-14T08:22:59.917Z",
                  remedy: {
                    label: "See what it read",
                    href: "#product-evidence",
                    operation: "product_understanding",
                  },
                },
                {
                  source: "live",
                  label: "Your public product",
                  state: fixture.view.sources.some(
                    (source) => source.label === "Your public product" && source.used,
                  )
                    ? "partial"
                    : "none",
                  detail: fixture.view.sources.some(
                    (source) => source.label === "Your public product" && source.used,
                  )
                    ? "Vibe visited your product, but couldn't read all of it."
                    : "Your public product has not been checked yet.",
                  reasons: fixture.view.sources.some(
                    (source) => source.label === "Your public product" && source.used,
                  )
                    ? [
                        "Two pages on your site build themselves in your visitor's browser, so Vibe saw an empty shell for those.",
                      ]
                    : [],
                  measured: { pages: 6 },
                  at: "2026-08-14T08:24:11.000Z",
                  remedy: {
                    label: "See what it saw",
                    href: "#product-evidence",
                    operation: "product_understanding",
                  },
                },
                {
                  source: "deep_scan",
                  label: "Your signed-in product",
                  detail: "Your signed-in product has not been checked yet.",
                  state: "none",
                  reasons: [],
                  measured: {},
                  at: null,
                  remedy: {
                    label: "Deep Scan",
                    href: "#product-evidence",
                    operation: "deep_scan",
                  },
                },
                {
                  source: "founder",
                  label: "What you told Vibe",
                  detail: "Your stated stage, monetization intent and primary goal.",
                  state: "ready",
                  reasons: [],
                  measured: {},
                  at: null,
                  remedy: { label: "View context", href: "#founder-context", operation: null },
                },
              ]}
              actions={
                <UnderstandingConfirm
                  projectId="project_e2e"
                  profileId="profile_e2e"
                  values={{
                    name: fixture.view.headline.productName ?? "",
                    shortDescription: "",
                    understanding: fixture.view.headline.understanding ?? "",
                    mainPurpose: "",
                    mainPromise: "",
                    primaryAudience: "",
                    problemSolved: "",
                  }}
                />
              }
            />
          </WorkspaceSection>
        </ProjectShell>
      </AppFrame>
    );
  }

  // The audit's lifecycle states (AUDIT UI-1 §28–§37). Rendered from the same
  // components the score route uses, so what a browser sees here is what a
  // waiting or running audit actually shows.
  if (scenario === "audit-preparing") {
    return (
      <main className="mx-auto max-w-4xl p-8">
        {label}
        <AuditPreparing />
      </main>
    );
  }

  if (scenario === "audit-analyzing") {
    return (
      <main className="mx-auto max-w-4xl p-8">
        {label}
        <AuditAnalyzing />
      </main>
    );
  }

  if (scenario === "audit-waiting") {
    return (
      <main className="mx-auto max-w-4xl p-8">
        {label}
        <div className="flex flex-col gap-4">
          <AuditWaitingHeader />
          <NeedsUserPanel
            projectId="project_e2e"
            question={E2E_NEEDS_USER_SCENARIOS.needs_user_first_customer()}
          />
        </div>
      </main>
    );
  }

  /*
   * The refusal that renders no control at all (Stufe 4).
   *
   * Nothing to configure — the notice reads its own sentence and its own note
   * from the shared tables, so a fixture that passed either in would be testing
   * the fixture. The link target is the only thing the route decides.
   */
  if (scenario === "agent-stale-read") {
    return (
      <main className="mx-auto max-w-4xl p-8">
        {label}
        <AgentStaleReadNotice
          productHref={`${projectSectionHref("project_e2e", "my-product")}#product-scan`}
        />
      </main>
    );
  }

  /*
   * The refusal a founder actually hit, in both of its shapes (Sprint 0141).
   *
   * Same failure mode as the notice above and a different cause: the plan's
   * next step is not one Vibe can run, so nothing resolves agentic and the
   * screen drew an empty call-to-action block. The two scenes differ only in
   * whether the founder can clear the step themselves, and that single word is
   * the whole value of the notice — so it is proved in a browser rather than
   * asserted about a prop.
   */
  /*
   * The notice on the real stage, which is where it was actually broken.
   *
   * The three refusal scenes above render the notice on its own and cannot see
   * the defect a founder photographed: passed as `startAction`, it went through
   * `AgentStartCta` — a control treatment that clips its child to
   * `rounded-full` under `overflow-hidden` and runs a highlight sweep across
   * it. The notice was clipped into an ellipse with its own sentence cut in
   * half, under a lock line promising what happens "before starting".
   *
   * So this scene asserts the structure rather than the words: a notice brings
   * no start treatment with it.
   */
  if (scenario === "agent-stage-notice") {
    return (
      <main className="mx-auto max-w-[90rem] p-8">
        {label}
        <AgentReadyStage
          task={{
            title: "Give a visitor a working path to pay",
            problem: "Three prices are published and none of them can be paid.",
            whyNow: null,
            impact: null,
            effort: null,
            lens: null,
            step: null,
            steps: [],
          }}
          planHref="/e2e/action-plan-ranked"
          repository="TobiB1505/Vibe-Business"
          liveUrl="https://vibebusiness.de"
          caption="This Move is selected. Its next step is not one Vibe can run, so nothing starts here yet."
          notice={
            <AgentPlanNextNotice
              stepOrder={3}
              stepTitle="Build or complete the checkout and subscription flow"
              reasonLabel={EXECUTION_REASON_LABELS.risk_class_prohibited}
              planHref={projectSectionHref("project_e2e", "action-plan")}
              shape="policy"
            />
          }
        />
      </main>
    );
  }

  if (
    scenario === "agent-plan-next-confirm" ||
    scenario === "agent-plan-next-waiting" ||
    scenario === "agent-plan-next-refused" ||
    scenario === "agent-plan-next-handoff"
  ) {
    /*
     * Three outlooks, because the third one is what a founder actually hit and
     * the first version of this notice got wrong: a step Vibe refuses by policy
     * was rendered with "an earlier step comes first" over "becomes available
     * once that step is done". Both false, and the second one made the founder
     * wait for something that was never coming.
     */
    const scene = {
      "agent-plan-next-confirm": {
        shape: "capability" as const,
        stepOrder: 1,
        stepTitle: "Establish what the existing billing route actually does",
        reason: EXECUTION_REASON_LABELS.change_kind_not_executable,
        handoff: false,
      },
      "agent-plan-next-waiting": {
        shape: "not_vibes" as const,
        stepOrder: 2,
        stepTitle: "Confirm the plan structure checkout should charge",
        reason: EXECUTION_REASON_LABELS.founder_decision_required,
        handoff: false,
      },
      "agent-plan-next-refused": {
        shape: "policy" as const,
        stepOrder: 3,
        stepTitle: "Build or complete the checkout and subscription flow",
        reason: EXECUTION_REASON_LABELS.risk_class_prohibited,
        handoff: false,
      },
      "agent-plan-next-handoff": {
        shape: "policy" as const,
        stepOrder: 3,
        stepTitle: "Build or complete the checkout and subscription flow",
        reason: EXECUTION_REASON_LABELS.risk_class_prohibited,
        handoff: true,
      },
    }[scenario];

    return (
      <main className="mx-auto max-w-4xl p-8">
        {label}
        <AgentPlanNextNotice
          stepOrder={scene.stepOrder}
          stepTitle={scene.stepTitle}
          reasonLabel={scene.reason}
          planHref={projectSectionHref("project_e2e", "action-plan")}
          shape={scene.shape}
          handoffAvailable={"handoff" in scene ? scene.handoff : false}
        />
      </main>
    );
  }

  /*
   * The three ways a preview is not offered, side by side in the browser.
   *
   * They are one branch apart in the panel and one word apart in the card, and
   * that is exactly why they are proved separately: the failure this state
   * exists to prevent is a true sentence shown to the wrong founder. The
   * browser is the only place that distinction is visible, because all three
   * render the same shape — a heading, a sentence, and no control.
   */
  if (
    scenario === "preview-not-supported" ||
    scenario === "preview-repository-not-ready" ||
    scenario === "preview-workspace-not-previewable"
  ) {
    return (
      <main className="mx-auto max-w-4xl p-8">
        {label}
        <PreviewPanel
          projectId="project_e2e"
          preparedChangeId="prepared_e2e"
          card={{
            state:
              scenario === "preview-not-supported"
                ? "not_supported"
                : scenario === "preview-repository-not-ready"
                  ? "repository_not_ready"
                  : "workspace_not_previewable",
            previewSessionId: null,
            operationRunId: null,
            stage: null,
            failureCode: null,
            failureMessage: null,
            expiresAt: null,
            readyAt: null,
          }}
          serverOrigin={null}
          productionUrl={null}
          approved={false}
          merged={false}
        />
      </main>
    );
  }

  if (isE2eWorkspaceChoiceScenario(scenario)) {
    const candidates = E2E_WORKSPACE_CHOICE_SCENARIOS[scenario]();
    const chosen = scenario === "workspace-choice-answered" ? ANSWERED_WORKSPACE_ROOT : null;

    /*
     * A plain button rather than the real submit control, for the same reason
     * every fixture here stops short of a server action: a component bound to a
     * real project cannot mount in this harness. What the browser has to prove
     * is the shape of the question — two applications, told apart, and no field
     * to type a third into — and that is entirely presentational.
     */
    return (
      <main className="mx-auto max-w-4xl p-8">
        {label}
        <AgentWorkspaceChoice
          candidates={candidates}
          chosen={chosen}
          action={(candidate) => (
            <Button
              type="button"
              variant={candidate.workspaceRoot === chosen ? "secondary" : "primary"}
              disabled={candidate.workspaceRoot === chosen}
              data-testid="agent-workspace-choose"
              data-workspace-root={candidate.workspaceRoot}
            >
              {candidate.workspaceRoot === chosen ? "Working on this" : "Work on this"}
            </Button>
          )}
        />
      </main>
    );
  }

  // "Vibe needs you" (CORE-2a.4 §30): the same panel the score route renders,
  // given a question the real gate produced.
  if (isE2eNeedsUserScenario(scenario)) {
    const question = E2E_NEEDS_USER_SCENARIOS[scenario]();
    return (
      <main className="mx-auto max-w-4xl p-8">
        {label}
        <NeedsUserPanel projectId="project_e2e" question={question} />
      </main>
    );
  }

  // The human-first Business Audit (CORE-2 §14): the same component the score
  // route renders, given an audit the real scoring produced.
  /*
   * The spent-entitlement gate (BILLING CORE-2 §39, §43).
   *
   * Deliberately renders the button *and* the notice together, in the order the
   * score page puts them, because the defect was never in either one alone: a
   * disabled control, a 35-Credit price and "credits … aren't available yet" all
   * appeared on one screen and contradicted each other.
   *
   * `disabled` comes from the real `auditBlockedByCredits` rather than from the
   * fixture, so the browser sees whatever the page would see.
   */
  /*
   * The Agent rail and core, driven by the real `agentStageSteps`.
   *
   * Mounted without the stage bodies: the claim under test is whether the five
   * states are distinguishable and whether motion respects the media query, and
   * a live view full of fixture events would only make that harder to see.
   */
  if (isE2eAgentStageScenario(scenario)) {
    const {
      steps,
      core,
      caption,
      activity,
      task,
      checks,
      validationDepth,
      cost,
      fileEvents,
      currentAction,
      files,
      previewChanges,
      previewImages,
      mergeFiles,
      mergeSummary,
      startRefusal,
      chainOffer,
    } = E2E_AGENT_STAGE_SCENARIOS[scenario]();
    /* The orb turns for a live run and for nothing else. */
    const live = core === "working" || core === "waiting";
    return (
      <main className="mx-auto flex max-w-[90rem] flex-col gap-6 p-8">
        {label}
        <AgentWorkspacePanel
          stages={steps}
          initialStage={
            steps.find((step) => step.state === "active" || step.state === "paused")?.stage ?? null
          }
          header={<AgentRunTaskHeader task={task} stage="Scenario state" filesChanged={8} />}
          bodies={{
            understand: (
              <AgentReadyStage
                task={task}
                planHref="/e2e/action-plan-ranked"
                repository="TobiB1505/Vibe-Business"
                liveUrl="https://vibebusiness.de"
                caption={caption}
                creditEstimate="100"
                /*
                 * What stands behind that ceiling (ADR 0072). Rendered from the
                 * real forecast against the real run history rather than from
                 * hand-written strings: the sentence that says a ceiling is
                 * policy rather than a measurement is the one a fixture must
                 * not be able to soften.
                 */
                forecastNotes={agentReadyForecastNotes()}
                /*
                  Stand-in buttons, deliberately: the real control binds a
                  server action, and what these scenarios exist to show is what
                  a founder is offered — two prices, both named, and the single
                  step still reachable.

                  Split across the two slots the way `agentStartControls`
                  splits them. Only the primary control may go in `startAction`:
                  that slot clips to a pill and sweeps a highlight across it,
                  and passing the whole group through it squeezed the decline
                  and the boundary sentence into the same pill and cut the
                  sentence in half — which is what the scenarios drew until a
                  phone-width render of the same offer in Nova's thread showed
                  it.
                */
                startAction={
                  <div className="flex w-full flex-col gap-3">
                    {startRefusal && (
                      <AgentStartRefusalNotice
                        detail={startRefusal}
                        repositoryReadHref="/app/projects/project_e2e/product"
                      />
                    )}
                    <button type="button" className="w-full rounded-full px-5 py-3">
                      {chainOffer
                        ? `Build all ${chainOffer.memberCount} steps — ${chainOffer.chainCredits}`
                        : "Run with Vibe"}
                    </button>
                  </div>
                }
                startBeneath={
                  chainOffer ? (
                    <div className="flex w-full flex-col gap-2">
                      <button type="button" className="w-full rounded-full px-5 py-3">
                        {`Build just this step — ${chainOffer.stepCredits}`}
                      </button>
                      <p className="text-fg-meta text-caption" data-testid="agent-chain-boundary">
                        {chainOffer.boundary}
                      </p>
                    </div>
                  ) : undefined
                }
              />
            ),
            build: (
              <AgentBuildStage
                task={task}
                live={live}
                core={
                  <AgentCore
                    state={core}
                    caption={(live ? currentAction : null) ?? caption}
                    size="compact"
                  />
                }
                activity={
                  fileEvents.length > 0 ? (
                    <div className="flex flex-col gap-5">
                      <AgentFileActivity events={fileEvents} title="Live activity" live={live} />
                      <AgentRunFiles files={files} />
                    </div>
                  ) : (
                    <AgentActivity steps={activity} title="Agent progress" live={live} />
                  )
                }
              />
            ),
            validate: (
              <AgentValidateStage
                running={live}
                checks={
                  <div className="flex flex-col gap-3">
                    <AgentValidationChecks checks={checks} />
                    <ValidationDepthNote depth={validationDepth} />
                  </div>
                }
              />
            ),
            preview: (
              <AgentPreviewStage
                images={previewImages}
                changes={previewChanges}
                filesChanged={8}
                linesAdded={mergeSummary.linesAdded}
                linesRemoved={mergeSummary.linesRemoved}
                filesHref="#"
              />
            ),
            review: (
              <>
                {/*
                The paths policy refused, on the stage a person decides from.
                `AgentPreviewActions` binds real server actions and cannot be
                mounted here, so the part that is new — naming what is not in
                the change — is rendered on its own.
              */}
                <WithheldPaths
                  paths={files.filter((f) => f.withheldBy !== null).map((f) => f.path)}
                />
                <AgentMergeStage
                  summary={mergeSummary}
                  files={mergeFiles}
                  allChecksPassed
                  branchName="vibe/feat-pricing-visibility"
                  baseBranch="main"
                  commitSha="4f1c9a2b7de3115902d9f43161aa87dc5ebe6872"
                  compareUrl="https://github.com/example/repo/compare/main...vibe/feat-pricing-visibility"
                  backHref="#"
                  canMerge
                  decision={<CostLine cost={cost} />}
                />
              </>
            ),
          }}
        />
      </main>
    );
  }

  /*
   * The provenance panel on its own, because what it has to get right is
   * visual: an outdated link that is not visible is the incident again.
   */
  if (isE2eProvenanceScenario(scenario)) {
    return (
      <main className="mx-auto max-w-3xl p-8">
        {label}
        <ProvenancePanel provenance={e2eProvenance(scenario)} projectId="project_e2e" />
      </main>
    );
  }

  if (isE2eNovaVoiceScenario(scenario)) {
    const { voice, aside } = E2E_NOVA_VOICE_SCENARIOS[scenario];
    return (
      <main className="mx-auto max-w-2xl p-8">
        {label}
        <NovaFocusThread
          entry={novaVoiceEntry()}
          voice={voice}
          asides={aside === null ? [] : [aside]}
        />
      </main>
    );
  }

  if (isE2eAuditCreditScenario(scenario)) {
    const { gate } = E2E_AUDIT_CREDIT_SCENARIOS[scenario];
    return (
      <main className="mx-auto max-w-[90rem] p-8">
        {label}
        <WorkspaceSection
          id="business-audit"
          eyebrow="Business intelligence"
          variant="intelligence"
          actions={
            <RunAuditButton
              projectId="project_e2e"
              hasAudit
              disabled={auditBlockedByCredits(gate)}
              // The included audit is spent in every scenario here, so the price is
              // always shown — which is precisely what made the old copy a lie.
              billable
              activeOperation={null}
            />
          }
          headerStatus={<AuditCreditNotice gate={gate} />}
        >
          <div />
        </WorkspaceSection>
      </main>
    );
  }

  /*
   * The signed-in error boundary.
   *
   * Rendered whole rather than as a fragment, because what it has to get right
   * is that a founder is not stranded: a header they recognise, a retry, and a
   * way back — none of which needs a query to draw, since this screen exists
   * for the case where querying is what broke.
   */
  if (scenario === "app-error" || scenario === "app-error-no-digest") {
    return <AppErrorPreview digest={scenario === "app-error" ? "1813753987@E394" : undefined} />;
  }

  /*
   * The billing skeleton, so "unknown is not zero" is checkable rather than
   * merely intended.
   *
   * `loading.tsx` is a route convention, which means nothing in the browser
   * suite could ever see it — and the failure it guards against is a *visual*
   * one: a placeholder shaped like a figure reads as a balance, and a customer
   * who glances at a loading billing page and sees "0" has been told something
   * false about their money. Rendering the real component here lets the suite
   * assert what a person would actually see.
   */
  if (scenario === "billing-loading") {
    return (
      <main className="mx-auto max-w-5xl p-8">
        {label}
        <BillingLoading />
      </main>
    );
  }

  /*
   * The Command Center's two new surfaces (CORE-5).
   *
   * Both render the real component over a view model the real builder
   * produced, so what the browser checks is the same decision the unit tests
   * check — one layer further out.
   */
  /*
   * The account dashboard, rendered through the same component `/app` renders.
   * The density budget in `e2e/account-dashboard.spec.ts` counts this screen,
   * so a composition assembled here instead would measure nothing real.
   */

  /*
   * Profile, through the component `/app/profile` renders. It takes the
   * session's email and the connection row as props precisely so this can
   * supply both — the harness has neither.
   */
  if (isE2eProfileScenario(scenario)) {
    const fixture = E2E_PROFILE_SCENARIOS[scenario]();
    return (
      <AppFrame rail={<FixtureSettingsRail />}>
        <AccountShell>
          <div className="sr-only">{label}</div>
          <ProfileView
            email={fixture.email}
            github={fixture.github}
            founderName={fixture.founderName ?? null}
          />
        </AccountShell>
      </AppFrame>
    );
  }

  /**
   * The account erasure control, rendered through the same component
   * `/app/settings` renders. Composing a lookalike here would test a screen
   * that exists nowhere, and this is the one control whose copy is a decision
   * rather than a description (ADR 0056 §4, §9).
   */
  if (isE2eErasureScenario(scenario)) {
    return (
      <AppFrame rail={<FixtureSettingsRail />}>
        <AccountShell>
          <div className="sr-only">{label}</div>
          <DeleteAccountSection state={E2E_ERASURE_SCENARIOS[scenario]()} />
        </AccountShell>
      </AppFrame>
    );
  }

  /**
   * The frame on a route that has no navigation.
   *
   * Onboarding and the GitHub connect flow render nothing into the `@rail`
   * slot, and the `<aside>` is hidden by `empty:hidden` rather than by a
   * conditional the layout would have to reason its way to. That rule is one
   * CSS declaration between a founder's first screen and 256px of empty
   * chrome beside it, and the only place it can be checked is a browser.
   */
  if (scenario === "shell-without-a-rail") {
    return (
      <AppFrame rail={null}>
        <main className="mx-auto w-full max-w-[40rem] p-8">
          <div className="sr-only">{label}</div>
          <h1 className="text-fg text-display font-bold">A focused flow</h1>
        </main>
      </AppFrame>
    );
  }

  /*
   * Project settings (UI-21).
   *
   * The route needs a session and a project in Supabase, which the browser
   * suite deliberately does not have — so the one screen carrying "disconnect
   * this repository" and "delete this product" had no browser coverage at all.
   * Both states are rendered here, because the page is a different page
   * without a repository: the disconnect row is gone and a connect link takes
   * its place.
   */
  if (scenario === "project-settings" || scenario === "project-settings-disconnected") {
    const connected = scenario === "project-settings";
    const settingsHref = projectSectionHref("project_e2e", "settings");

    return (
      <AppFrame
        rail={
          <FixtureRail credits={35}>
            <ProjectRail
              projectId="project_e2e"
              projectName="Acme"
              connected={connected}
              planName="Free"
              switcherItems={[
                {
                  id: "project_e2e",
                  name: "Acme",
                  href: settingsHref,
                  repositoryFullName: connected ? "acme/acme" : null,
                },
              ]}
              items={PROJECT_SECTIONS.map((section) => ({
                id: section.id,
                label: section.label,
                icon: section.icon,
                href:
                  section.id === "settings"
                    ? settingsHref
                    : projectSectionHref("project_e2e", section.id),
                count: null,
                countTone: "neutral" as const,
              }))}
            />
          </FixtureRail>
        }
      >
        <ProjectShell>
          <div className="sr-only">{label}</div>
          <ProjectBreadcrumb projectName="Acme" />
          <ProjectSettingsView
            projectId="project_e2e"
            projectName="Acme"
            repository={
              connected
                ? {
                    fullName: "acme/acme",
                    htmlUrl: "https://github.com/acme/acme",
                    defaultBranch: "main",
                  }
                : null
            }
            productionUrl={connected ? "https://acme.example" : null}
            founderIntent={{ stage: null, monetizationModel: null, primaryGoal: null }}
            reconnectHref="/app/connect/github"
          />
        </ProjectShell>
      </AppFrame>
    );
  }

  /*
   * The cookie panel from Settings → General (UI-23).
   *
   * The settings route needs a session, and consent is the one screen where
   * "the switches match the cookie" has to be true in a browser rather than in
   * a unit test — the whole feature is a browser fact.
   */
  if (scenario === "cookie-settings") {
    return (
      <main className="mx-auto max-w-3xl p-8">
        {label}
        <h1 className="text-fg mb-6 text-display font-bold">General</h1>
        <Surface level="panel" padding="md">
          <CookieSettings />
        </Surface>
      </main>
    );
  }

  if (isE2eProductsScenario(scenario)) {
    return (
      <AppFrame rail={<FixtureSettingsRail />}>
        <AccountShell>
          <div className="sr-only">{label}</div>
          <ProductsIndex products={E2E_PRODUCTS_SCENARIOS[scenario]()} />
        </AccountShell>
      </AppFrame>
    );
  }

  if (isE2eRepositoriesScenario(scenario)) {
    return (
      <AppFrame rail={<FixtureSettingsRail />}>
        <AccountShell>
          <div className="sr-only">{label}</div>
          <RepositoriesIndex
            repositories={E2E_REPOSITORIES_SCENARIOS[scenario]()}
            githubLogin={scenario === "account-repositories-empty" ? null : "TobiB1505"}
          />
        </AccountShell>
      </AppFrame>
    );
  }

  if (isE2eHomeScenario(scenario)) {
    return (
      <main className="mx-auto max-w-[70rem] p-8">
        {label}
        <HomeStatus
          view={E2E_HOME_SCENARIOS[scenario]()}
          planHref="/app/projects/project_e2e/plan"
          agentHref="/app/projects/project_e2e/agent"
          productHref="/app/projects/project_e2e/product"
          healthHref="/app/projects/project_e2e#business-audit"
        />
      </main>
    );
  }

  /*
   * The Agent route's own render shape, so streaming can be observed (VB-023).
   *
   * The real route cannot be driven here — it needs a signed-in session against
   * a Supabase project the browser suite deliberately does not have. What this
   * reproduces is the structure the route now uses: the panel built from cheap
   * reads, then the prepared changes inside a `<Suspense>` boundary with the
   * same fallback.
   *
   * The delay is artificial and exists only to make the boundary observable —
   * in the route it is a GitHub merge preflight. What the browser test proves
   * is real either way: the panel and the skeleton reach the client while the
   * slow half is still resolving, which before this could not happen at all.
   */
  /*
   * The change history on its own (audit R29). The Agent route needs a session
   * and a project to reach, so without this the one screen that lets a founder
   * find an earlier change would have no browser coverage.
   *
   * Six rows, one per outcome worth seeing side by side: a merge that landed,
   * a write that stopped without an answer, a change somebody said no to, one
   * whose checks failed, one still waiting, and one whose Move is gone from
   * the latest set — which falls back to the branch name.
   */
  if (scenario === "agent-change-history") {
    return (
      <main className="mx-auto max-w-[70rem] p-8">
        {label}
        <ChangeHistoryTable
          entries={E2E_CHANGE_HISTORY}
          moveTitles={E2E_CHANGE_HISTORY_MOVES}
          changeHref={(id) => `/app/projects/project_e2e/agent?change=${id}`}
        />
      </main>
    );
  }

  if (scenario === "agent-streaming") {
    return (
      <main className="mx-auto max-w-[70rem] p-8">
        {label}
        <AgentPanel
          {...E2E_AGENT_SCENARIOS["agent-ready"]()}
          preparedCount={1}
          planHref="/app/projects/project_e2e/plan"
          agentHref="/app/projects/project_e2e/agent"
          productHref="/app/projects/project_e2e/product"
          executionHref={null}
        />
        <Suspense fallback={<SkeletonSection />}>
          <SlowPreparedChanges />
        </Suspense>
      </main>
    );
  }

  if (isE2eAgentScenario(scenario)) {
    return (
      <main className="mx-auto max-w-[70rem] p-8">
        {label}
        <AgentPanel
          {...E2E_AGENT_SCENARIOS[scenario]()}
          preparedCount={scenario === "agent-ready" ? 2 : 0}
          planHref="/app/projects/project_e2e/plan"
          agentHref="/app/projects/project_e2e/agent"
          productHref="/app/projects/project_e2e/product"
          executionHref={null}
        />
      </main>
    );
  }

  if (isE2eAuditScenario(scenario)) {
    const auditResult = E2E_AUDIT_SCENARIOS[scenario]();
    const hasMoves = scenario !== "audit-synthesis-no-moves";
    const view = buildBusinessBrainView({
      audit: auditResult,
      lastScanAt: auditResult.generatedAt,
      auditReadings: [],
      movesByConclusion: hasMoves ? { "blocker-1": 2, "blocker-2": 1 } : {},
      moveByConclusion: hasMoves
        ? {
            "blocker-1": {
              title: "Make pricing visible",
              impact: "high",
              effort: "medium",
            },
            "blocker-2": {
              title: "Measure the customer journey",
              impact: "medium",
              effort: "medium",
            },
          }
        : {},
      usedSignedInEvidence: true,
    });
    return (
      <main className="mx-auto max-w-[90rem] p-8">
        {label}
        <WorkspaceSection
          id="business-audit"
          eyebrow="Business intelligence"
          variant="intelligence"
        >
          {view ? (
            <>
              {/*
              The strip the Business Health route renders under its priced
              audit control, from the same builder — without it this density
              had no browser coverage at all.
            */}
              <SourceCoverageStrip
                sources={buildSourceCoverage({
                  repository: {
                    result:
                      E2E_INTELLIGENCE_SCENARIOS.repository_intelligence_contradiction().snapshot,
                    completedAt: "2026-08-14T08:22:59.917Z",
                  },
                  live: {
                    result: E2E_INTELLIGENCE_SCENARIOS.repository_intelligence_contradiction().live,
                    completedAt: "2026-08-14T08:24:11.000Z",
                  },
                  deepScan: { result: null },
                  founder: { told: true, at: null },
                  hrefs: {
                    scan: "/app/projects/project_e2e/my-product",
                    deepScan: "/app/projects/project_e2e/deep-scan",
                    settings: "/app/projects/project_e2e/settings",
                    founderIntent: "/app/projects/project_e2e/settings#founder-intent",
                    connectRepository: "/app/projects/project_e2e/settings",
                    addWebsite: "/app/projects/project_e2e/settings",
                  },
                  connected: { repository: true, productionUrl: true },
                })}
                className="mb-4"
              />
              <AuditOverview
                view={view}
                movesHref="/app/projects/project_e2e/plan"
                hasMoves={hasMoves}
                /*
                 * The same comparison My Product renders, built from the same
                 * fixtures rather than restated — the Brain carries it as
                 * evidence about the business, and without this the branch had
                 * no browser coverage at all.
                 */
                contradictions={
                  crossCheckIntelligence(
                    E2E_INTELLIGENCE_SCENARIOS.repository_intelligence_contradiction().snapshot,
                    E2E_INTELLIGENCE_SCENARIOS.repository_intelligence_contradiction().live,
                  ).checks
                }
              />
            </>
          ) : (
            <p>This fixture predates the Business Brain.</p>
          )}
        </WorkspaceSection>
      </main>
    );
  }

  /*
   * The planned-work panel (ACTION PLANNER UI-1; ACTION PLAN UI-2): the same
   * component the Action Plan route renders below the active Move, given the
   * exact read-model shape `getActionPlanReadiness` / `getLatestActionPlan` /
   * `getActiveActionPlanOperation` produce. No AI call backs any of it.
   */
  if (isE2eActionPlanScenario(scenario)) {
    const fixture = E2E_ACTION_PLAN_SCENARIOS[scenario]();
    return (
      <main className="mx-auto max-w-2xl p-8">
        {label}
        <PlanDetailPanel
          projectId="project_e2e"
          opportunityId={fixture.opportunityId}
          moveTitle={fixture.moveTitle}
          moveRank={fixture.opportunityId ? 1 : null}
          moveLens={fixture.opportunityId ? "Acquisition" : null}
          defaultMoveTitle={fixture.defaultMoveTitle}
          handoffStepKey={fixture.handoffStepKey ?? null}
          repositoryFullName="TobiB1505/Vibe-Business"
          nextMove={fixture.nextMove ?? null}
          responsibilityByStepKey={fixture.responsibilityByStepKey ?? {}}
          readiness={fixture.readiness}
          planView={fixture.planView}
          activeOperation={fixture.activeOperation}
          auditHref="/app/projects/project_e2e#business-audit"
          understandingHref="/app/projects/project_e2e/product"
        />
      </main>
    );
  }

  /*
   * The Deep Scan panel (`launch-v1`). The same component the project page
   * renders, given a complete `DeepScanViewModel` written by hand from the read
   * model's own types. No browser provider, no session, no Credit hold — the
   * panel's start action is a Server Action these fixtures never reach.
   */
  /*
   * The handoff animation, alone in a box.
   *
   * It cannot be reached through the panel here — it renders while an analysis
   * Vibe actually started is running, and that is a Server Action these
   * fixtures never call. It still has to be reachable in a browser, because
   * the defect it shipped with was a render loop: every source assertion about
   * it passed while the component threw on mount and a founder watched 42
   * seconds of live browser where it should have been.
   */
  /*
   * The sign-in dialog, in the two states it only reaches through a real
   * browser session and a real analysis result.
   *
   * The panel opens this on a click and drives it with Server Actions the
   * fixtures never call, so every state below was unreachable to any test —
   * which is how a countdown and a closing check both shipped without
   * appearing on screen.
   */
  if (
    scenario === "deep-scan-dialog-awaiting-login" ||
    scenario === "deep-scan-dialog-sealing" ||
    scenario === "deep-scan-dialog-expired" ||
    scenario === "deep-scan-dialog-expired-over-picture"
  ) {
    return (
      <main className="mx-auto max-w-3xl p-8">
        {label}
        <DeepScanDialogFixture
          sealing={scenario === "deep-scan-dialog-sealing"}
          expired={scenario.startsWith("deep-scan-dialog-expired")}
          liveViewUrl={
            scenario === "deep-scan-dialog-expired-over-picture" ? "wss://127.0.0.1:9/live" : null
          }
        />
      </main>
    );
  }

  /* The closing check, which cannot be reached without a real analysis result. */
  if (scenario === "deep-scan-handoff-sealed") {
    return (
      <main className="mx-auto max-w-3xl p-8">
        {label}
        <div
          data-testid="handoff-box"
          className="border-line-2 bg-surface-2 rounded-card relative aspect-[16/10] w-full overflow-hidden border"
        >
          <ScanHandoff running succeeded />
        </div>
      </main>
    );
  }

  if (scenario === "deep-scan-handoff") {
    return (
      <main className="mx-auto max-w-3xl p-8">
        {label}
        <div
          data-testid="handoff-box"
          className="border-line-2 bg-surface-2 rounded-card relative aspect-[16/10] w-full overflow-hidden border"
        >
          <ScanHandoff running progress={{ pagesInspected: 7, maxPages: 25 }} />
        </div>
      </main>
    );
  }

  if (isE2eDeepScanSpotlightScenario(scenario)) {
    return (
      <main className="mx-auto max-w-3xl p-8">
        {label}
        {/*
          Through the real derivation, never around it: a fixture that handed
          the component a hand-written spotlight would prove the card renders
          and nothing about what it is allowed to say.
        */}
        <DeepScanSpotlight
          spotlight={buildDeepScanSpotlight(E2E_DEEP_SCAN_SPOTLIGHT_SCENARIOS[scenario])}
          href="/app/projects/project_e2e/product/deep-scan"
        />
      </main>
    );
  }

  if (isE2eDeepScanScenario(scenario)) {
    return (
      <main className="mx-auto max-w-3xl p-8">
        {label}
        <DeepScanPanel projectId="project_e2e" model={E2E_DEEP_SCAN_SCENARIOS[scenario]} />
      </main>
    );
  }

  if (!isE2eScenario(scenario)) notFound();

  const change: PreparedChangeWorkspaceItem = E2E_SCENARIOS[scenario]();

  return (
    <main className="mx-auto max-w-4xl p-8">
      {label}
      {/*
        Every gate for this card, from the two compositions the product mounts.

        It was `ChangeGates`, which drew all of them itself and was deleted:
        the Agent workspace had replaced every gate in it, and the file kept
        compiling only because this route mounted it. So every panel guarantee
        in the suites below was being asserted against a screen no founder
        could reach.

        `AgentPreviewActions` and `AgentReviewDecision` are those screens'
        actual contents — the same components `agent/page.tsx` puts in its
        stage bodies and `ReviewBlock` puts in the thread. Both are mounted
        here, with the same card, because a panel suite needs the panel on
        screen and the product shows one stage at a time behind a rail. Which
        stage a founder lands on is a different question and belongs to
        `agent-stages.spec.ts`; what these scenarios pin is what each panel
        says once it is there.

        Not an assembly of panels: change either component and this route
        changes with it, which is the drift the old comment was worried about.
      */}
      <div
        id={preparedChangeAnchorId(change.id)}
        data-prepared-change-id={change.id}
        data-testid="prepared-change"
        className="scroll-mt-24"
      >
        {/*
          The change's own sentence, as the thread carries it.

          `deriveChangeProgress` writes it and `NovaFocusThread` draws it as the
          aside beside the block — `home-view.ts` takes it straight from the
          candidate's `headline`. It is rendered here rather than left out
          because the surface is not the block alone: a founder meets the
          sentence and the block together, and a fixture that dropped it would
          make the block answer a question nobody asked.

          A live region for the same reason it was one on `ChangeGates`: this
          is the one line that changes as the change advances, and replacing
          visible text announces nothing.
        */}
        <p role="status" className="text-fg mb-4 text-body font-medium">
          {change.progress.headline}
        </p>

        <div className="flex flex-col gap-6">
          <AgentPreviewActions
            projectId="project_e2e"
            change={change}
            planHref="/app/projects/project_e2e/plan"
          />
          <AgentReviewDecision
            projectId="project_e2e"
            change={change}
            planHref="/app/projects/project_e2e/plan"
          />
        </div>
      </div>
    </main>
  );
}

/** Stands in for the merge preflight: slow, and nothing above it waits. */
async function SlowPreparedChanges() {
  await new Promise((resolve) => setTimeout(resolve, 1_000));

  return (
    <div data-testid="prepared-change">
      <AgentReviewDecision
        projectId="project_e2e"
        change={E2E_SCENARIOS.change_awaiting_approval()}
        planHref="/app/projects/project_e2e/plan"
      />
    </div>
  );
}

/**
 * One block, with the state it belongs to written above it.
 *
 * The label is the `OnboardingState`, not a title — a reviewer looking at
 * three blocks needs to know which branch of the page drew each one, and a
 * friendly name would be one more piece of copy nobody wrote for a founder.
 */
function BlockCase({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <p className="text-label text-fg-meta font-mono tracking-[0.16em] uppercase">{title}</p>
      {/* The thread's own floor, from the room rather than retyped — the
          block sits on the ground it will sit on in the product. */}
      <div className={NOVA_THREAD_SURFACE}>{children}</div>
    </section>
  );
}

/**
 * The reveal's block body, on the understanding the real pipeline produced.
 *
 * A copy of the page's markup, and the one case in this fixture that is. The
 * page builds it inline from four different reads — the profile, the view, the
 * audit gate, the stored id — and there is no component to mount instead. What
 * the copy is for is the *frames*: whether a logo, a headline, two facts and a
 * confirmation form read as one block or as four things in a box.
 *
 * If it drifts from the page, this is the file that is wrong.
 */
function RevealBlockFixture() {
  const view = E2E_UNDERSTANDING_SCENARIOS.understanding_ready().view;

  return (
    <div className="flex flex-col items-center gap-7 text-center">
      <VibeMark size={44} />
      <div className="flex flex-col gap-3">
        {view.headline.productName && (
          <p className="text-fg-body text-moment font-semibold">{view.headline.productName}</p>
        )}
        {view.headline.understanding && (
          <p className="text-fg-prose mx-auto max-w-[62ch] leading-relaxed">
            {view.headline.understanding}
          </p>
        )}
      </div>
      <ProductRevealFacts facts={view.audience.slice(0, 2)} />

      <div className="border-line-2 w-full border-t pt-6">
        <h3 className="text-fg-body mb-4 font-semibold">Did Vibe get this right?</h3>
        <ProductConfirmation
          projectId="project_e2e"
          profileId="profile_e2e"
          bundlesAudit
          values={{
            name: "Acme",
            shortDescription: "A web application for small product teams.",
            understanding: "Visitors can create an account and reach a signed-in workspace.",
            mainPurpose: "Give small teams one place to run their product work.",
            mainPromise: "Less time spent keeping track of what is happening.",
            primaryAudience: "Software founders and builders",
            problemSolved: "Work scattered across tools nobody keeps up to date.",
          }}
        />
      </div>
    </div>
  );
}
