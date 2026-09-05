import { Suspense } from "react";
import { notFound } from "next/navigation";
import { SkeletonSection } from "@/components/ui/skeleton";
import { PlanDetailPanel } from "@/app/app/projects/[projectId]/plan/plan-detail-panel";
import type { PreparedChangeWorkspaceItem } from "@/modules/execution/workspace";
import { ChangeGates } from "@/app/app/projects/[projectId]/agent/change-gates";
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
import { FocusCard } from "@/app/app/projects/[projectId]/nova/focus-card";
import { AttentionStack } from "@/app/app/projects/[projectId]/nova/attention-stack";
import { WorkingStrip } from "@/app/app/projects/[projectId]/nova/working-strip";
import { ProductIdentity } from "@/app/app/projects/[projectId]/nova/product-identity";
import { HealthScore } from "@/app/app/projects/[projectId]/nova/health-score";
import { FindingCard } from "@/components/system/finding-card";
import { NOVA_ACTION_META } from "@/modules/nova/actions";
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
import BillingLoading from "@/app/app/(account)/billing/loading";
import { E2E_AUDIT_CREDIT_SCENARIOS, isE2eAuditCreditScenario } from "../audit-credit-scenarios";
import { e2eProvenance, isE2eProvenanceScenario } from "../provenance-scenarios";
import { ProvenancePanel } from "@/app/app/projects/[projectId]/provenance-panel";
import { E2E_AGENT_STAGE_SCENARIOS, isE2eAgentStageScenario } from "../agent-stage-scenarios";
import { AgentWorkspacePanel } from "@/app/app/projects/[projectId]/agent/agent-workspace-panel";
import { AgentActivity } from "@/app/app/projects/[projectId]/agent/agent-activity";
import { AgentValidationChecks } from "@/app/app/projects/[projectId]/agent/agent-validation-checks";
import { AgentFileActivity } from "@/app/app/projects/[projectId]/agent/agent-file-activity";
import { AgentRunFiles } from "@/app/app/projects/[projectId]/agent/agent-run-files";
import { AgentRunHistory } from "@/app/app/projects/[projectId]/agent/agent-run-history";
import { WalletChip } from "@/components/system/wallet-chip";
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
  E2E_ACCOUNT_SCENARIOS,
  E2E_PRODUCTS_SCENARIOS,
  E2E_REPOSITORIES_SCENARIOS,
  isE2eAccountScenario,
  isE2eProductsScenario,
  isE2eRepositoriesScenario,
} from "../account-scenarios";
import { AccountHome } from "@/app/app/account-home";
import { DeleteAccountSection } from "@/app/app/(account)/settings/delete-account";
import { E2E_ERASURE_SCENARIOS, isE2eErasureScenario } from "../erasure-scenarios";
import { ProductsIndex } from "@/app/app/(account)/products/products-index";
import { RepositoriesIndex } from "@/app/app/(account)/repositories/repositories-index";
import { AccountMenu } from "@/components/layout/account-menu";
import { AccountShell, AccountSidebar } from "@/components/layout/account-shell";
import {
  PROJECT_SECTIONS,
  ProjectBreadcrumb,
  ProjectShell,
  ProjectSidebar,
  WorkspaceSection,
  projectSectionHref,
  type ProjectNavItem,
} from "@/components/layout/project-shell";
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
import { BillingView } from "@/app/app/(account)/billing/billing-view";
import { E2E_BILLING_SCENARIOS, isE2eBillingScenario } from "../billing-scenarios";
import { DeepScanPanel } from "@/app/app/projects/[projectId]/deep-scan-panel";
import { E2E_DEEP_SCAN_SCENARIOS, isE2eDeepScanScenario } from "../deep-scan-scenarios";
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
    <p className="mb-4 text-xs text-zinc-600" data-testid="e2e-scenario">
      {scenario}
    </p>
  );

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
          balance={{ availableCredits: creditsToUnits(420), display: "420" }}
          consequence={priced?.confirmationNote ?? undefined}
          control={
            control.kind === "none" ? undefined : (
              <Button variant="primary">
                {control.kind === "elsewhere" ? control.label : control.option.label}
              </Button>
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
          /*
            The two events that belong to no product, which the project-scoped
            read filters out by construction — so this is the only place a
            browser can see them (audit R24).
          */
          accountActivity={[
            {
              id: "a1",
              eventType: "credit_grant.posted",
              at: "2026-08-16T10:00:00.000Z",
              title: "Credits added",
              tone: "success",
              facts: [],
            },
            {
              id: "a2",
              eventType: "github.installation.connected",
              at: "2026-08-10T09:00:00.000Z",
              title: "GitHub installation connected",
              tone: "success",
              facts: [],
            },
          ]}
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
      <ProjectShell
        sidebar={
          <ProjectSidebar
            projectId="project_e2e"
            projectName="Acme"
            repositoryFullName="acme/acme"
            connected
            switcherItems={[
              { id: "project_e2e", name: "Acme", href: currentHref },
              {
                id: "project_e2e_planner",
                name: "Planner Agent",
                href: "/app/projects/project_e2e_planner",
              },
            ]}
            items={navItems}
            footer={
              <div className="flex flex-col gap-3">
                {/*
                  The balance, where the real rail carries it (audit R22) — so
                  the browser proves a founder can see what they have from a
                  project route, not only from Billing.
                */}
                <WalletChip
                  balance={{ availableCredits: creditsToUnits(35), display: "35 Credits" }}
                  href="/app/billing"
                />
                <AccountMenu
                  identity={{
                    displayName: "Tobi",
                    initials: "TB",
                    avatarUrl: null,
                    fromGithub: true,
                  }}
                  subtitle="Founder"
                  placement="above"
                />
              </div>
            }
          />
        }
      >
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
    scenario === "agent-plan-next-refused"
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
      },
      "agent-plan-next-waiting": {
        shape: "not_vibes" as const,
        stepOrder: 2,
        stepTitle: "Confirm the plan structure checkout should charge",
        reason: EXECUTION_REASON_LABELS.founder_decision_required,
      },
      "agent-plan-next-refused": {
        shape: "policy" as const,
        stepOrder: 3,
        stepTitle: "Build or complete the checkout and subscription flow",
        reason: EXECUTION_REASON_LABELS.risk_class_prohibited,
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
                startAction={
                  <div className="flex w-full flex-col gap-3">
                    {startRefusal && (
                      <AgentStartRefusalNotice
                        detail={startRefusal}
                        repositoryReadHref="/app/projects/project_e2e/product"
                      />
                    )}
                    {/*
                      Stand-in buttons, deliberately: the real control binds a
                      server action, and what these scenarios exist to show is
                      what a founder is offered — two prices, both named, and
                      the single step still reachable.
                    */}
                    {chainOffer && (
                      <button type="button" className="w-full rounded-full px-5 py-3">
                        {`Build all ${chainOffer.memberCount} steps — ${chainOffer.chainCredits}`}
                      </button>
                    )}
                    <button type="button" className="w-full rounded-full px-5 py-3">
                      {chainOffer
                        ? `Build just this step — ${chainOffer.stepCredits}`
                        : "Run with Vibe"}
                    </button>
                    {chainOffer && (
                      <p className="text-fg-meta text-xs" data-testid="agent-chain-boundary">
                        {chainOffer.boundary}
                      </p>
                    )}
                  </div>
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
              <WithheldPaths paths={files.filter((f) => f.withheldBy !== null).map((f) => f.path)} />
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
  if (isE2eAccountScenario(scenario)) {
    return (
      <AccountShell
        sidebar={
          <AccountSidebar
            credits="2,480"
            footer={
              <AccountMenu
                identity={{
                  displayName: "Tobi",
                  initials: "TB",
                  avatarUrl: null,
                  fromGithub: true,
                }}
              />
            }
          />
        }
      >
        <div className="sr-only">{label}</div>
        <AccountHome projects={E2E_ACCOUNT_SCENARIOS[scenario]()} />
      </AccountShell>
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
      <AccountShell
        sidebar={
          <AccountSidebar
            credits="2,480"
            footer={
              <AccountMenu
                identity={{
                  displayName: "Tobi",
                  initials: "TB",
                  avatarUrl: null,
                  fromGithub: true,
                }}
              />
            }
          />
        }
      >
        <div className="sr-only">{label}</div>
        <DeleteAccountSection state={E2E_ERASURE_SCENARIOS[scenario]()} />
      </AccountShell>
    );
  }

  if (isE2eProductsScenario(scenario)) {
    return (
      <AccountShell
        sidebar={
          <AccountSidebar
            credits="2,480"
            footer={
              <AccountMenu
                identity={{
                  displayName: "Tobi",
                  initials: "TB",
                  avatarUrl: null,
                  fromGithub: true,
                }}
              />
            }
          />
        }
      >
        <div className="sr-only">{label}</div>
        <ProductsIndex products={E2E_PRODUCTS_SCENARIOS[scenario]()} />
      </AccountShell>
    );
  }

  if (isE2eRepositoriesScenario(scenario)) {
    return (
      <AccountShell
        sidebar={
          <AccountSidebar
            credits="2,480"
            footer={
              <AccountMenu
                identity={{
                  displayName: "Tobi",
                  initials: "TB",
                  avatarUrl: null,
                  fromGithub: true,
                }}
              />
            }
          />
        }
      >
        <div className="sr-only">{label}</div>
        <RepositoriesIndex
          repositories={E2E_REPOSITORIES_SCENARIOS[scenario]()}
          githubLogin={scenario === "account-repositories-empty" ? null : "TobiB1505"}
        />
      </AccountShell>
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
   * The run list on its own (audit R29). The Agent route needs a session and a
   * project to reach, so without this the one screen that lets a founder find
   * an earlier run would have no browser coverage.
   */
  if (scenario === "agent-run-history") {
    return (
      <main className="mx-auto max-w-[70rem] p-8">
        {label}
        <AgentRunHistory
          runs={[
            {
              id: "run_3",
              status: "completed",
              startedAt: "2026-08-27T10:44:00.000Z",
              completedAt: "2026-08-27T10:51:00.000Z",
              changedFileCount: 4,
              preparedChangeId: "change_3",
            },
            {
              id: "run_2",
              status: "failed",
              startedAt: "2026-08-24T09:12:00.000Z",
              completedAt: "2026-08-24T09:14:00.000Z",
              changedFileCount: null,
              preparedChangeId: null,
            },
            {
              id: "run_1",
              status: "cancelled",
              startedAt: "2026-08-20T16:03:00.000Z",
              completedAt: "2026-08-20T16:05:00.000Z",
              changedFileCount: null,
              preparedChangeId: null,
            },
          ]}
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
        The component the Agent route mounts, given the same card. A fixture
        that assembled the panels itself would drift from the route the moment
        either changed, and these scenarios exist to catch exactly that.
      */}
      <ChangeGates
        projectId="project_e2e"
        change={change}
        planHref="/app/projects/project_e2e/plan"
      />
    </main>
  );
}

/** Stands in for the merge preflight: slow, and nothing above it waits. */
async function SlowPreparedChanges() {
  await new Promise((resolve) => setTimeout(resolve, 1_000));

  return (
    <ChangeGates
      projectId="project_e2e"
      change={E2E_SCENARIOS.change_awaiting_approval()}
      planHref="/app/projects/project_e2e/plan"
    />
  );
}
