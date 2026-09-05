import { deriveNovaFocus, type NovaFocusFacts } from "@/modules/nova/focus";
import { buildNovaHomeView, type NovaHomeView } from "@/modules/nova/home-view";
import type { OperationView } from "@/modules/operations/view";

/**
 * Nova Home in a real browser (UI Sourcing Spec §15).
 *
 * ## Why this needs a browser
 *
 * Every claim this slice makes is about what a founder can see and reach:
 * that one action dominates, that a price is on screen *before* the click,
 * that a paused run does not read as activity, that a missing score explains
 * itself, and that the evidence drawer opens, traps focus and gives it back.
 * None of those is a property of a data structure — `home-view.test.ts` proves
 * the values are right, and only a browser proves they are legible.
 *
 * ## Why the view models come from the real functions
 *
 * `deriveNovaFocus` ranks and `buildNovaHomeView` projects. A fixture that
 * hand-wrote a `NovaHomeView` would keep passing after the ranking changed,
 * which is the drift these scenarios exist to catch. Only the *facts* are
 * fixture data — the same shape `readNovaFocus` returns from the database.
 */

export const E2E_NOVA_SCENARIOS = [
  /** A change is waiting to be looked at: a navigation control, and a stack. */
  "nova-review",
  /** A stale audit: a priced control whose cost must be visible unpressed. */
  "nova-priced",
  /** Nothing to do. No button, and no invented work. */
  "nova-settled",
  /** An operation paused on the founder. Must never read as working. */
  "nova-waiting",
  /** A run presumed lost from a clock. Neither working nor failed. */
  "nova-stalled",
  /** An audit that could not be scored. A dash and the reason for it. */
  "nova-unscored",
] as const;

export type E2eNovaScenario = (typeof E2E_NOVA_SCENARIOS)[number];

export function isE2eNovaScenario(scenario: string): scenario is E2eNovaScenario {
  return (E2E_NOVA_SCENARIOS as readonly string[]).includes(scenario);
}

const NO_FLAGS = { agent: false, scan: false, audit: false };

function facts(overrides: Partial<NovaFocusFacts>): NovaFocusFacts {
  return {
    sourceDisconnected: false,
    failedOperations: { ...NO_FLAGS },
    stalledOperations: { ...NO_FLAGS },
    changes: [],
    questions: [],
    moves: [],
    plannedMoveId: null,
    executableStep: null,
    planOffered: false,
    auditOutdated: false,
    repositoryReadOutdated: false,
    workspaceChoiceRequired: false,
    working: null,
    ...overrides,
  };
}

function operation(overrides: Partial<OperationView>): OperationView {
  return {
    operationId: "op_e2e",
    status: "running",
    stage: "running_ai",
    startedAt: "2026-09-05T09:00:00.000Z",
    completedAt: null,
    failureCode: null,
    resultId: null,
    shouldPoll: true,
    retryAllowed: false,
    stalled: false,
    ...overrides,
  };
}

const REVIEW_CHANGE = {
  preparedChangeId: "change_e2e",
  stage: "review_required" as const,
  headline: "Two files changed on a branch of their own",
};

const FACTS_BY_SCENARIO: Record<E2eNovaScenario, NovaFocusFacts> = {
  "nova-review": facts({
    changes: [REVIEW_CHANGE],
    // Two more true things, so the stack has something to order.
    auditOutdated: true,
    moves: [{ id: "move_e2e", rank: 1, title: "Add a pricing page" }],
  }),
  "nova-priced": facts({ auditOutdated: true }),
  "nova-settled": facts({}),
  "nova-waiting": facts({
    changes: [REVIEW_CHANGE],
    working: operation({ status: "needs_user", stage: "asking_founder" }),
  }),
  "nova-stalled": facts({
    changes: [REVIEW_CHANGE],
    working: operation({ stalled: true }),
  }),
  "nova-unscored": facts({ auditOutdated: true }),
};

export function novaScenarioView(scenario: E2eNovaScenario): NovaHomeView {
  return buildNovaHomeView(deriveNovaFocus(FACTS_BY_SCENARIO[scenario]));
}

/** The health reading each scenario shows beneath the focus. */
export function novaScenarioHealth(scenario: E2eNovaScenario): {
  score: number | null;
  stateLabel: string;
  scoredLenses: number;
  eligibleLenses: number;
  insufficientCoverageReason: string | null;
} | null {
  if (scenario === "nova-unscored") {
    return {
      score: null,
      stateLabel: "Not enough evidence",
      scoredLenses: 2,
      eligibleLenses: 9,
      // The sentence the scorer writes and the product has never rendered.
      insufficientCoverageReason:
        "Only 2 of 9 applicable areas could be scored. At least 5 are needed for an overall figure.",
    };
  }

  if (scenario === "nova-settled") return null;

  return {
    score: 62,
    stateLabel: "Taking shape",
    scoredLenses: 7,
    eligibleLenses: 9,
    insufficientCoverageReason: null,
  };
}

/** The audit's first blocker, with the evidence the drawer opens onto. */
export const NOVA_SCENARIO_PRIORITY = {
  headline: "Your code takes payments and your site offers no way to pay",
  explanation:
    "Vibe found a payments integration in the repository and no pricing or checkout page on the live site.",
  whyItMatters: "Someone who wants to buy has nowhere to do it, so the integration earns nothing.",
  severity: "critical" as const,
  citations: [
    { detail: "Payments integration detected", source: "Your code", certainty: "curated" as const },
    {
      detail: "Pricing page not observed",
      source: "Your live site",
      certainty: "curated" as const,
    },
  ],
};
