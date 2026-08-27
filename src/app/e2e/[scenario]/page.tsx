import { notFound } from "next/navigation";
import { PlanDetailPanel } from "@/app/app/projects/[projectId]/plan/plan-detail-panel";
import {
  PreparedChangesSection,
  type PreparedChangeCard,
} from "@/app/app/projects/[projectId]/prepared-changes-section";
import { IntelligenceSummary } from "@/app/app/projects/[projectId]/intelligence-summary";
import { AuditOverview } from "@/app/app/projects/[projectId]/audit-overview";
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
import {
  E2E_ACTION_PLAN_SCENARIOS,
  isE2eActionPlanScenario,
} from "../action-plan-scenarios";
import { E2E_AUDIT_SCENARIOS, isE2eAuditScenario } from "../audit-scenarios";
import {
  E2E_AGENT_SCENARIOS,
  E2E_HOME_SCENARIOS,
  isE2eAgentScenario,
  isE2eHomeScenario,
} from "../command-center-scenarios";
import { AgentPanel } from "@/app/app/projects/[projectId]/agent-panel";
import { HomeStatus } from "@/app/app/projects/[projectId]/home-status";
import { AppErrorPreview } from "../app-error-preview";
import {
  E2E_AUDIT_CREDIT_SCENARIOS,
  isE2eAuditCreditScenario,
} from "../audit-credit-scenarios";
import {
  E2E_AGENT_STAGE_SCENARIOS,
  isE2eAgentStageScenario,
} from "../agent-stage-scenarios";
import { AgentWorkspacePanel } from "@/app/app/projects/[projectId]/agent/agent-workspace-panel";
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
import {
  E2E_PRODUCT_SCAN_SCENARIOS,
  isE2eProductScanScenario,
} from "../product-scan-scenarios";
import { ProductScanRevealFixture } from "../product-scan-reveal-fixture";
import { AuditLivePrerequisite } from "@/app/app/onboarding/[projectId]/audit-live-prerequisite";
import {
  OnboardingOperationFailure,
  OnboardingStalled,
} from "@/app/app/onboarding/[projectId]/operation-states";
import { RetryProductScan } from "@/app/app/onboarding/[projectId]/phase-actions";
import { UnderstandingStatus } from "@/app/app/onboarding/[projectId]/understanding-status";
import { ActionPlanWorkspace } from "@/app/app/projects/[projectId]/plan/action-plan-workspace";
import { MovesRefreshBar } from "@/app/app/projects/[projectId]/plan/moves-refresh-bar";
import type { ActionPlanReadiness } from "@/modules/action-plans/service";
import { ProductLogo } from "@/components/brand/product-logo";
import { BillingView } from "@/app/app/(account)/billing/billing-view";
import { E2E_BILLING_SCENARIOS, isE2eBillingScenario } from "../billing-scenarios";
import { E2E_MOVES_SCENARIOS, isE2eMovesScenario } from "../moves-scenarios";
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
 */

export const dynamic = "force-dynamic";

function fixturesEnabled(): boolean {
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
  if (isE2eBillingScenario(scenario)) {
    const fixture = E2E_BILLING_SCENARIOS[scenario];
    return (
      <main className="mx-auto max-w-5xl p-8">
        {label}
        <BillingView
          overview={fixture.overview}
          stripeReady={fixture.stripeReady}
          checkoutState={"checkoutState" in fixture ? fixture.checkoutState : undefined}
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
          validationSummaries={{}}
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
        {scenario === "onboarding_logo_broken" ? (
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
        section.id === "my-product"
          ? currentHref
          : projectSectionHref("project_e2e", section.id),
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
            }
          />
        }
      >
        <div className="sr-only">{label}</div>
        <ProjectBreadcrumb projectName="Acme" />
        <WorkspaceSection
          id="my-product"
          title="My Product"
          description="Here's how Vibe understands your product."
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
            {
              id: "code",
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
              href: "#product-evidence",
              action: "See what it read",
            },
            {
              id: "live",
              label: "Your public product",
              state: fixture.view.sources.some(
                (source) => source.label === "Your public product" && source.used,
              )
                ? "ready"
                : "none",
              detail: fixture.view.sources.some(
                (source) => source.label === "Your public product" && source.used,
              )
                ? "Vibe has visited what a first-time visitor reaches."
                : "Your public product has not been checked yet.",
              href: "#product-evidence",
              action: "See what it saw",
            },
            {
              id: "deep-scan",
              label: "Your signed-in product",
              detail: "Your signed-in product has not been checked yet.",
              state: "none",
              href: "#product-evidence",
              action: "Deep Scan",
            },
            {
              id: "intent",
              label: "What you told Vibe",
              detail: "Your stated stage, monetization intent and primary goal.",
              state: "ready",
              href: "#founder-context",
              action: "View context",
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
    const { steps, core, caption } = E2E_AGENT_STAGE_SCENARIOS[scenario]();
    return (
      <main className="mx-auto max-w-[90rem] p-8">
        {label}
        <AgentWorkspacePanel stages={steps} core={core} caption={caption} />
      </main>
    );
  }

  if (isE2eAuditCreditScenario(scenario)) {
    const { gate } = E2E_AUDIT_CREDIT_SCENARIOS[scenario];
    return (
      <main className="mx-auto max-w-3xl space-y-4 p-8">
        {label}
        <RunAuditButton
          projectId="project_e2e"
          hasAudit
          disabled={auditBlockedByCredits(gate)}
          // The included audit is spent in every scenario here, so the price is
          // always shown — which is precisely what made the old copy a lie.
          billable
          activeOperation={null}
        />
        <AuditCreditNotice gate={gate} />
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

  if (isE2eAgentScenario(scenario)) {
    return (
      <main className="mx-auto max-w-[70rem] p-8">
        {label}
        <AgentPanel
          context={E2E_AGENT_SCENARIOS[scenario]()}
          preparedCount={scenario === "agent-ready" ? 2 : 0}
          planHref="/app/projects/project_e2e/plan"
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
        {view ? (
          <AuditOverview
            view={view}
            movesHref="/app/projects/project_e2e/plan"
            hasMoves={hasMoves}
          />
        ) : (
          <p>This fixture predates the Business Brain.</p>
        )}
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
          readiness={fixture.readiness}
          planView={fixture.planView}
          activeOperation={fixture.activeOperation}
          auditHref="/app/projects/project_e2e#business-audit"
          understandingHref="/app/projects/project_e2e/product"
        />
      </main>
    );
  }

  if (!isE2eScenario(scenario)) notFound();

  const change: PreparedChangeCard = E2E_SCENARIOS[scenario]();

  return (
    <main className="mx-auto max-w-4xl p-8">
      {label}
      <PreparedChangesSection projectId="project_e2e" changes={[change]} />
    </main>
  );
}
