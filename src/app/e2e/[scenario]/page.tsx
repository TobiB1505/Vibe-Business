import { notFound } from "next/navigation";
import { ActionPlanPanel } from "@/app/app/projects/[projectId]/action-plan-panel";
import {
  PreparedChangesSection,
  type PreparedChangeCard,
} from "@/app/app/projects/[projectId]/prepared-changes-section";
import { IntelligenceSummary } from "@/app/app/projects/[projectId]/intelligence-summary";
import { AuditOverview } from "@/app/app/projects/[projectId]/audit-overview";
import { BusinessHealth } from "@/app/app/projects/[projectId]/business-health";
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
import { AppErrorPreview } from "../app-error-preview";
import {
  E2E_AUDIT_CREDIT_SCENARIOS,
  isE2eAuditCreditScenario,
} from "../audit-credit-scenarios";
import { E2E_NEEDS_USER_SCENARIOS, isE2eNeedsUserScenario } from "../needs-user-scenarios";
import { E2E_SCENARIOS, isE2eScenario } from "../scenarios";
import { E2E_INTELLIGENCE_SCENARIOS, isE2eIntelligenceScenario } from "../intelligence-scenarios";
import {
  E2E_UNDERSTANDING_SCENARIOS,
  isE2eUnderstandingScenario,
} from "../understanding-scenarios";
import { UnderstandingPanel } from "@/app/app/projects/[projectId]/understanding-panel";
import { UnderstandingConfirm } from "@/app/app/projects/[projectId]/understanding-confirm";
import { AuditLivePrerequisite } from "@/app/app/onboarding/[projectId]/audit-live-prerequisite";
import {
  OnboardingOperationFailure,
  OnboardingStalled,
} from "@/app/app/onboarding/[projectId]/operation-states";
import { RetryProductScan } from "@/app/app/onboarding/[projectId]/phase-actions";
import { UnderstandingStatus } from "@/app/app/onboarding/[projectId]/understanding-status";
import { OpportunitiesPanel } from "@/app/app/projects/[projectId]/opportunities-panel";
import { ProductLogo } from "@/components/brand/product-logo";
import { BillingView } from "@/app/app/billing/billing-view";
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

  // The Moves surface (UI-S2 §41, §42): the same panel the moves route renders,
  // given lineage the real resolver produced from a real audit shape.
  if (isE2eMovesScenario(scenario)) {
    const fixture = E2E_MOVES_SCENARIOS[scenario]();
    return (
      <main className="mx-auto max-w-4xl p-8">
        {label}
        <OpportunitiesPanel
          projectId="project_e2e"
          opportunities={fixture.opportunities}
          executionStates={fixture.executionStates}
          branchUrls={{}}
          validationSummaries={{}}
          stale={fixture.stale}
          activeOperation={null}
          blockedReason={fixture.blockedReason}
          auditHref="/app/projects/project_e2e/health"
          blockedDestinations={{
            product: "/app/projects/project_e2e/product",
            audit: "/app/projects/project_e2e/health",
            moves: "/app/projects/project_e2e/plan",
            repository: "/app/projects/project_e2e/settings",
          }}
          lineage={fixture.lineage}
          movesContext={fixture.movesContext}
          movesHref="/app/projects/project_e2e/plan"
          preparedHref="/app/projects/project_e2e/agent"
          plannedOpportunityId={null}
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
    return (
      <main className="mx-auto max-w-4xl p-8">
        {label}
        <UnderstandingPanel
          view={fixture.view}
          projectId="project_e2e"
          confirmedAt={fixture.confirmedAt}
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
      </main>
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

  if (isE2eAuditScenario(scenario)) {
    const auditResult = E2E_AUDIT_SCENARIOS[scenario]();
    const hasMoves = scenario !== "audit-synthesis-no-moves";
    return (
      <main className="mx-auto max-w-[90rem] p-8">
        {label}
        <AuditOverview
          audit={auditResult}
          generatedAt={auditResult.generatedAt}
          movesHref="/app/projects/project_e2e/plan"
          hasMoves={hasMoves}
          /*
           * The lineage the real page computes (UI-S2 §8). Two Moves on the
           * top blocker and one on the second, so the browser can check that
           * the primary priority carries its key, that a secondary priority
           * gets a quieter link, and that a blocker with nothing behind it
           * gets no link at all.
           */
          movesByConclusion={hasMoves ? { "blocker-1": 2, "blocker-2": 1 } : {}}
        />
        {/*
          The same pair the real Business Health route renders. Included here
          because the "unknown is never drawn as zero" rule (CLAUDE.md rule 44)
          is a claim about pixels, and this component is where a dimension's
          number becomes a bar width.
        */}
        <BusinessHealth audit={auditResult} />
      </main>
    );
  }

  // The Action Plan panel (ACTION PLANNER UI-1): the same component the
  // /moves route renders, given the exact read-model shape
  // `getActionPlanReadiness` / `getLatestActionPlan` /
  // `getActiveActionPlanOperation` produce. No AI call backs any of it.
  if (isE2eActionPlanScenario(scenario)) {
    const fixture = E2E_ACTION_PLAN_SCENARIOS[scenario]();
    return (
      <main className="mx-auto max-w-4xl p-8">
        {label}
        <ActionPlanPanel
          projectId="project_e2e"
          opportunityId={fixture.opportunityId}
          moveTitle={fixture.moveTitle}
          defaultMoveTitle={fixture.defaultMoveTitle}
          readiness={fixture.readiness}
          planView={fixture.planView}
          activeOperation={fixture.activeOperation}
          auditHref="/app/projects/project_e2e/health"
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
