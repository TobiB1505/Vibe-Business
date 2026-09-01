import type { BusinessConclusion, BusinessReadinessAudit } from "@/modules/business-audit/schema";
import type { OpportunityActionState } from "@/modules/execution/view";
import {
  resolveMoveLineage,
  resolveMovesContext,
  type MoveLineageMap,
  type MovesContext,
} from "@/modules/opportunities/lineage";
import type { BusinessOpportunity } from "@/modules/opportunities/schema";
import type { OperationView } from "@/modules/operations/view";

/**
 * The Audit → Moves → Prepared handoff in a real browser (UI-S2 §41, §42).
 *
 * ## Why the lineage is *resolved* rather than written
 *
 * Every fixture below runs the real `resolveMoveLineage` and
 * `resolveMovesContext` over a real audit shape. So a change to the identity
 * rule changes what the browser sees, rather than leaving a hand-written map to
 * drift quietly away from the rule it is supposed to demonstrate — which is the
 * whole failure mode this suite exists to catch.
 *
 * ## What it cannot prove
 *
 * That `moves/page.tsx` assembles the right props. The route's own wiring is
 * covered by source assertions and by the lineage unit tests; this is a floor,
 * not a ceiling, and the same documented gap every suite here carries.
 */

function conclusion(headline: string): BusinessConclusion {
  return {
    rootProblem: "",
    headline,
    explanation: `${headline} Vibe found no evidence of the surface a customer would need.`,
    lenses: ["offer"],
    evidenceIds: [],
  } as unknown as BusinessConclusion;
}

const PAYMENT = "People don't yet have a clear way to pay you.";
const AUDIENCE = "It isn't clear who your product is for.";

const AUDIT = {
  synthesis: {
    blockers: [conclusion(PAYMENT), conclusion(AUDIENCE)],
    strengths: [],
    lenses: [],
  },
} as unknown as BusinessReadinessAudit;

function move(overrides: Partial<BusinessOpportunity>): BusinessOpportunity {
  return {
    id: "move-default",
    rank: 1,
    sourceConclusionKey: "blocker-1",
    title: "Decide how customers pay",
    problem:
      "Your product is live and people can sign up, but nothing on it says what anything costs or how to buy.",
    whyNow:
      "Every visitor you attract until this exists is a visitor who could not have paid you even if they wanted to.",
    impact: "high",
    effort: "medium",
    confidence: "high",
    category: "monetization",
    primaryLens: "revenue_economics",
    secondaryLenses: ["conversion"],
    evidenceIds: ["live.surface.pricing"],
    executionType: "business_decision",
    executionReadiness: "needs_user_input",
    dependencies: [],
    ...overrides,
  };
}

/** The four Moves every scenario draws from, one per readiness situation. */
const MOVES: BusinessOpportunity[] = [
  move({
    id: "move-pricing-decision",
    rank: 1,
    sourceConclusionKey: "blocker-1",
    title: "Decide how customers pay",
    executionReadiness: "needs_user_input",
  }),
  move({
    id: "move-pricing-page",
    rank: 2,
    sourceConclusionKey: "blocker-1",
    title: "Add a pricing surface people can reach",
    problem: "There is no page a visitor can open to find out what your product costs.",
    whyNow: "A decision nobody can see has the same effect on revenue as no decision.",
    executionType: "code_change",
    executionReadiness: "ready",
    dependencies: ["Decide how customers pay"],
    impact: "high",
    effort: "low",
  }),
  move({
    id: "move-audience-copy",
    rank: 3,
    sourceConclusionKey: "blocker-2",
    title: "Say who the product is for",
    problem: "Your landing page describes what the product does but never who it is for.",
    whyNow: "Everything downstream — acquisition, conversion, pricing — depends on that answer.",
    executionType: "content_change",
    executionReadiness: "ready",
    impact: "medium",
    effort: "low",
  }),
  move({
    id: "move-outreach",
    rank: 4,
    // Legacy: prioritized before v2 recorded the relationship. Renders normally
    // and simply claims no source, which is what "unknown" has to look like.
    sourceConclusionKey: null,
    title: "Talk to ten people who have this problem",
    problem: "Nothing in the product or the repository shows contact with a real customer yet.",
    whyNow: "The cheapest way to find out whether any of this is worth building.",
    executionType: "manual_external_action",
    executionReadiness: "not_supported_yet",
    impact: "high",
    effort: "high",
  }),
];

const PREPARED_CHANGE_ID = "prepared_change_e2e";

const EXECUTION_STATES: Record<string, OpportunityActionState> = {
  // An executor exists and nothing blocks it: the one card that may offer a
  // write, and the only one.
  "move-pricing-page": { kind: "preparable", capability: "nextjs_seo_foundations_v2" },
  // Already prepared — the state that carries the handoff onward (§26).
  "move-audience-copy": { kind: "already_prepared", preparedChangeId: PREPARED_CHANGE_ID },
  // The model said a person decides first. No executor, so no write affordance.
  "move-pricing-decision": { kind: "needs_user_input" },
  // Vibe has no executor for talking to people, and must not pretend otherwise.
  "move-outreach": { kind: "not_automated" },
};

type MovesFixture = {
  opportunities: BusinessOpportunity[];
  lineage: MoveLineageMap;
  movesContext: MovesContext | null;
  executionStates: Record<string, OpportunityActionState>;
  stale: boolean;
  blockedReason: "audit_missing" | "audit_stale" | null;
  movesOperation: OperationView | null;
};

function base(overrides: Partial<MovesFixture> = {}): MovesFixture {
  const lineage = resolveMoveLineage({ sourceAudit: AUDIT, opportunities: MOVES });
  return {
    opportunities: MOVES,
    lineage,
    movesContext: null,
    executionStates: EXECUTION_STATES,
    stale: false,
    blockedReason: null,
    movesOperation: null,
    ...overrides,
  };
}

export const E2E_MOVES_SCENARIOS = {
  /** Normal navigation: the whole ranked list, no context (§11). */
  moves_ranked: () => base(),

  /** Entered from the top audit finding: two Moves answer it (§10, §24). */
  moves_from_conclusion: () => {
    const fixture = base();
    return {
      ...fixture,
      movesContext: resolveMovesContext({
        requested: "blocker-1",
        lineage: fixture.lineage,
        opportunities: fixture.opportunities,
      }),
    };
  },

  /**
   * A key that resolves to nothing.
   *
   * The context is null, so this must render exactly as `moves_ranked` does —
   * which is what "degrades gracefully" has to mean in practice (§31).
   */
  moves_bad_context: () => {
    const fixture = base();
    return {
      ...fixture,
      movesContext: resolveMovesContext({
        requested: "../../etc/passwd",
        lineage: fixture.lineage,
        opportunities: fixture.opportunities,
      }),
    };
  },

  /** Moves exist but were prioritized from an earlier audit (§7, §19E). */
  moves_stale: () => base({ stale: true }),

  /** Generation has never run: the section's own primary action (§19A). */
  moves_none: () => base({ opportunities: [], lineage: {}, executionStates: {} }),

  /** A real durable generation stage, used to verify the forming-plan workspace. */
  moves_generating: () =>
    base({
      opportunities: [],
      lineage: {},
      executionStates: {},
      movesOperation: {
        operationId: "moves_operation_e2e",
        status: "running",
        stage: "prioritizing",
        startedAt: "2026-08-27T00:00:00.000Z",
        completedAt: null,
        failureCode: null,
        resultId: null,
        shouldPoll: true,
        retryAllowed: false,
        stalled: false,
      },
    }),

  /**
   * A re-scan running while the previous plan is still on screen.
   *
   * `moves_generating` only ever covered the empty case, so the state a
   * founder with Moves actually reaches after pressing "Re-scan business" was
   * the one state this suite never rendered — and it showed nothing at all.
   */
  moves_rescanning: () =>
    base({
      movesOperation: {
        operationId: "moves_rescan_e2e",
        status: "running",
        stage: "prioritizing",
        startedAt: "2026-09-01T00:00:00.000Z",
        completedAt: null,
        failureCode: null,
        resultId: null,
        shouldPoll: true,
        retryAllowed: false,
        stalled: false,
      },
    }),

  /** No audit to prioritize from — a block with a way out, not a dead end (§19F). */
  moves_blocked: () =>
    base({ opportunities: [], lineage: {}, executionStates: {}, blockedReason: "audit_missing" }),
} as const;

export type E2eMovesScenario = keyof typeof E2E_MOVES_SCENARIOS;

export function isE2eMovesScenario(value: string): value is E2eMovesScenario {
  return value in E2E_MOVES_SCENARIOS;
}

/** The id the prepared-change handoff must land on, asserted by the suite. */
export const E2E_PREPARED_CHANGE_ID = PREPARED_CHANGE_ID;
