import { notFound } from "next/navigation";
import {
  PreparedChangesSection,
  type PreparedChangeCard,
} from "@/app/app/projects/[projectId]/prepared-changes-section";
import { IntelligenceSummary } from "@/app/app/projects/[projectId]/intelligence-summary";
import { AuditConclusion } from "@/app/app/projects/[projectId]/audit-conclusion";
import { NeedsUserPanel } from "@/app/app/projects/[projectId]/needs-user-panel";
import { E2E_AUDIT_SCENARIOS, isE2eAuditScenario } from "../audit-scenarios";
import { E2E_NEEDS_USER_SCENARIOS, isE2eNeedsUserScenario } from "../needs-user-scenarios";
import { E2E_SCENARIOS, isE2eScenario } from "../scenarios";
import { E2E_INTELLIGENCE_SCENARIOS, isE2eIntelligenceScenario } from "../intelligence-scenarios";
import {
  E2E_UNDERSTANDING_SCENARIOS,
  isE2eUnderstandingScenario,
} from "../understanding-scenarios";
import { UnderstandingPanel } from "@/app/app/projects/[projectId]/understanding-panel";
import { UnderstandingConfirm } from "@/app/app/projects/[projectId]/understanding-confirm";

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

  // "Vibe needs u" (CORE-2a.4 §30): the same panel the score route renders,
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
  if (isE2eAuditScenario(scenario)) {
    const auditResult = E2E_AUDIT_SCENARIOS[scenario]();
    return (
      <main className="mx-auto max-w-4xl p-8">
        {label}
        <AuditConclusion
          audit={auditResult}
          analyzedAt={auditResult.generatedAt}
          movesHref="/app/projects/project_e2e/moves"
          hasMoves
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
