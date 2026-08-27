import {
  AUDIT_SYNTHESIS_VERSION,
  type AuditSynthesis,
  type BusinessConclusion,
  type BusinessReadinessAudit,
} from "@/modules/business-audit/schema";
import { fakeSeoOpportunity } from "@/modules/execution/test-support";
import { buildAgentFocus, type AgentFocus } from "@/modules/projects/agent-focus";
import { fakeAudit } from "@/modules/opportunities/test-support";
import { fakeProductProfile } from "@/modules/product-understanding/test-support";
import {
  buildAgentContext,
  buildHomeView,
  type AgentContext,
  type HomeView,
} from "@/modules/projects/command-center";

/**
 * Browser fixtures for the Command Center (CORE-5).
 *
 * ## Why these go through the real view models
 *
 * Every `HomeView` and `AgentContext` below comes out of `buildHomeView` or
 * `buildAgentContext`, never written by hand. A hand-built view model would let
 * the components be tested against a shape the domain never emits — which is
 * exactly how a screen passes its own tests and is still wrong for real
 * customers. The unit tests assert what the builders decide; these assert what
 * a browser then does with it.
 *
 * ## What they exist to prove
 *
 * Absence. Every scenario here is a project missing something: no audit, no
 * moves, an audit that could not be scored, an agent with nothing to work
 * from. Those are the states where a confident zero or an invented sentence
 * would appear, and they are the states a demo project never has.
 */

function conclusion(overrides: Partial<BusinessConclusion> = {}): BusinessConclusion {
  return {
    rootProblem: "The business has not decided how value becomes revenue.",
    headline: "People still don't have a clear way to pay you.",
    explanation: "Vibe couldn't find prices or anything to buy.",
    whyItMatters: "Until someone can pay, nothing else you improve turns into revenue.",
    evidenceIds: ["live.surface.pricing"],
    lenses: ["revenue_economics"],
    tone: "critical",
    confidence: "high",
    ...overrides,
  };
}

function synthesis(overrides: Partial<AuditSynthesis> = {}): AuditSynthesis {
  return {
    version: AUDIT_SYNTHESIS_VERSION,
    lenses: [],
    overall: "You have a real product, but nobody can pay for it.",
    strengths: [],
    blockers: [conclusion()],
    ...overrides,
  };
}

function auditScoring(score: number | null): BusinessReadinessAudit {
  const base = fakeAudit({ synthesis: synthesis() });
  return {
    ...base,
    overall: {
      ...base.overall,
      score,
      insufficientCoverageReason:
        score === null ? "Vibe could only assess one of five areas." : null,
    },
  };
}

const MOVE = fakeSeoOpportunity({
  rank: 1,
  title: "Give people a way to pay",
  problem: "There is no pricing page and no checkout anywhere on the live product.",
  impact: "high",
});

export const E2E_HOME_SCENARIOS = {
  /** Everything present. The screen a founder should eventually see. */
  "home-complete": (): HomeView =>
    buildHomeView({
      profile: fakeProductProfile(),
      audit: auditScoring(64),
      opportunities: [MOVE],
      preparedCount: 2,
    }),

  /**
   * A brand-new project. No profile, no audit, no moves — the state where a
   * "0 / 100" would be a lie about the business rather than about Vibe.
   */
  "home-nothing-yet": (): HomeView =>
    buildHomeView({
      profile: null,
      audit: null,
      opportunities: null,
      preparedCount: 0,
    }),

  /** An audit that ran and could not say. Neither a score nor "never looked". */
  "home-unscored": (): HomeView =>
    buildHomeView({
      profile: fakeProductProfile(),
      audit: auditScoring(null),
      opportunities: null,
      preparedCount: 0,
    }),

  /**
   * The engine ran and returned nothing. Must not read the same as never
   * having run — one of those means there is nothing worth doing.
   */
  "home-no-moves-found": (): HomeView =>
    buildHomeView({
      profile: fakeProductProfile(),
      audit: auditScoring(88),
      opportunities: [],
      preparedCount: 0,
    }),
} as const;

export type E2eHomeScenario = keyof typeof E2E_HOME_SCENARIOS;

export function isE2eHomeScenario(value: string): value is E2eHomeScenario {
  return value in E2E_HOME_SCENARIOS;
}

/** The Move the focus scenarios are about. Rank 3, so a positional rank shows. */
const FOCUS_MOVE = fakeSeoOpportunity();

function readyContext(): AgentContext {
  return buildAgentContext({
    hasProductUnderstanding: true,
    hasRepositoryUnderstanding: true,
    hasBusinessGoals: true,
  });
}

/**
 * The engineer's card, in every state it has (CORE-5; focus added by UI-S3).
 *
 * `focus` is what the card says about the Move a founder arrived with. The
 * three original scenarios carry none, which is the state of someone who
 * opened the Agent directly and is the page as it was before the focus
 * existed.
 */
export const E2E_AGENT_SCENARIOS = {
  "agent-ready": (): { context: AgentContext; focus: AgentFocus } => ({
    context: buildAgentContext({
      hasProductUnderstanding: true,
      hasRepositoryUnderstanding: true,
      hasBusinessGoals: true,
    }),
    focus: { kind: "none" },
  }),

  "agent-partial": (): { context: AgentContext; focus: AgentFocus } => ({
    context: buildAgentContext({
      hasProductUnderstanding: true,
      hasRepositoryUnderstanding: true,
      hasBusinessGoals: false,
    }),
    focus: { kind: "none" },
  }),

  "agent-not-briefed": (): { context: AgentContext; focus: AgentFocus } => ({
    context: buildAgentContext({
      hasProductUnderstanding: false,
      hasRepositoryUnderstanding: false,
      hasBusinessGoals: false,
    }),
    focus: { kind: "none" },
  }),

  /** Arrived from the Action Plan on a Move Vibe has an executor for. */
  "agent-focus-preparable": (): { context: AgentContext; focus: AgentFocus } => ({
    context: readyContext(),
    focus: buildAgentFocus({
      requestedOpportunityId: FOCUS_MOVE.id,
      opportunities: [FOCUS_MOVE],
      action: { kind: "preparable", capability: "nextjs_seo_foundations_v2" },
    }),
  }),

  /** The same Move, after a change was written for it. */
  "agent-focus-prepared": (): { context: AgentContext; focus: AgentFocus } => ({
    context: readyContext(),
    focus: buildAgentFocus({
      requestedOpportunityId: FOCUS_MOVE.id,
      opportunities: [FOCUS_MOVE],
      action: { kind: "already_prepared", preparedChangeId: "prepared_e2e" },
    }),
  }),

  /**
   * A Move id this project does not have — a superseded set, or someone
   * else's. The card must name no Move at all rather than substitute one.
   */
  "agent-focus-unresolved": (): { context: AgentContext; focus: AgentFocus } => ({
    context: readyContext(),
    focus: buildAgentFocus({
      requestedOpportunityId: "9-belongs-to-another-project",
      opportunities: [FOCUS_MOVE],
      action: null,
    }),
  }),
} as const;

export type E2eAgentScenario = keyof typeof E2E_AGENT_SCENARIOS;

export function isE2eAgentScenario(value: string): value is E2eAgentScenario {
  return value in E2E_AGENT_SCENARIOS;
}
