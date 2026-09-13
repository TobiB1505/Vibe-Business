import type { BusinessOpportunity } from "@/modules/opportunities/schema";
import { agentStepLabel } from "@/modules/business-agent/catalog";
import type { NovaConversationView } from "@/modules/nova/conversation";
import { buildOperationView } from "@/modules/operations/view";

/**
 * The conversation, in a real browser (ADR 0109, vertical slice 1).
 *
 * ## Why these need a browser
 *
 * Every claim the slice makes about the thread is about what a founder can see
 * and reach: that their own question and Nova's answer are distinguishable,
 * that a Move renders as the canonical card rather than as a paraphrase, that
 * a turn in flight says what it is doing rather than spinning, that Vibe's own
 * fallback sentence looks different from Nova speaking, that there is exactly
 * one place to type, and that none of it breaks at 375px. None of those is a
 * property of a data structure.
 *
 * ## Why the view models are fixture data here
 *
 * Unlike the focus scenarios, which run the real ranking, a conversation view
 * is a projection of rows the browser cannot reach. What the unit tests hold is
 * that `readNovaConversation` builds this shape correctly; what these hold is
 * that the shape renders. Splitting it that way is what keeps the browser suite
 * from needing a database.
 */

export const E2E_CONVERSATION_SCENARIOS = [
  /** A question, an answer, and the Move the answer points at. */
  "nova-conversation",
  /** A question with a turn still being answered. Stage words, never a fraction. */
  "nova-conversation-working",
  /** Vibe's own sentence, because the model's answer could not be used. */
  "nova-conversation-fallback",
  /** Nothing asked yet. The composer, and no empty transcript furniture. */
  "nova-conversation-empty",
] as const;

export type E2eConversationScenario = (typeof E2E_CONVERSATION_SCENARIOS)[number];

export function isE2eConversationScenario(scenario: string): scenario is E2eConversationScenario {
  return (E2E_CONVERSATION_SCENARIOS as readonly string[]).includes(scenario);
}

const MOVE: BusinessOpportunity = {
  id: "opp-1",
  sourceConclusionKey: "blocker-1",
  rank: 1,
  title: "Say what it costs before the signup form",
  problem: "No price is shown anywhere a visitor can reach.",
  whyNow: "Visitors reach the signup form without knowing what it costs.",
  impact: "high",
  effort: "medium",
  confidence: "high",
  category: "conversion",
  primaryLens: "conversion",
  secondaryLenses: [],
  evidenceIds: ["live:pricing-absent"],
  executionType: "content",
  executionReadiness: "ready_to_plan",
  dependencies: [],
} as unknown as BusinessOpportunity;

const ASKED = {
  id: "m1",
  sequence: 1,
  role: "founder" as const,
  content: "What should I work on next?",
  origin: "typed" as const,
  createdAt: "2026-09-13T10:00:00.000Z",
  artifacts: [],
  thinking: null,
};

/*
 * The steps behind the answer, as a turn would actually have recorded them.
 *
 * Labels come from `catalog.ts` rather than being written out here, so a
 * fixture cannot drift into showing a founder a sentence the product does not
 * use. One step found nothing and one was skipped, because a list where
 * everything succeeded never exercises the two states that say so.
 */
const LOOKED_AT = {
  durationMs: 6_200,
  steps: [
    { label: agentStepLabel("use_skill"), state: "done" as const },
    { label: agentStepLabel("get_project_focus"), state: "done" as const },
    { label: agentStepLabel("get_business_health"), state: "done" as const },
    { label: agentStepLabel("get_opportunities"), state: "done" as const },
    { label: agentStepLabel("get_action_plan"), state: "empty" as const },
    { label: agentStepLabel("resolve_execution"), state: "skipped" as const },
  ],
};

export function conversationScenarioView(scenario: E2eConversationScenario): NovaConversationView {
  if (scenario === "nova-conversation-empty") {
    return { conversationId: null, messages: [], working: null };
  }

  if (scenario === "nova-conversation-working") {
    /*
     * Started *now*, not at a fixed instant.
     *
     * `operationPollPhase` calls a run stalled once it is ten minutes old, so a
     * hard-coded timestamp made this scenario render the stopped state a few
     * minutes after the fixture was written — and the browser suite caught it,
     * which is the one place that class of mistake shows.
     */
    const startedAt = new Date().toISOString();
    return {
      conversationId: "c1",
      messages: [ASKED],
      working: buildOperationView({
        operationId: "op1",
        status: "running",
        stage: "consulting_evidence",
        failureCode: null,
        resultId: "turn1",
        startedAt,
        completedAt: null,
        createdAt: startedAt,
      }),
    };
  }

  if (scenario === "nova-conversation-fallback") {
    return {
      conversationId: "c1",
      messages: [
        ASKED,
        {
          id: "m2",
          sequence: 2,
          role: "assistant",
          /*
           * Vibe's own sentence, copied from `fallback.ts` rather than
           * paraphrased: a fixture that invented a nicer one would let the
           * thread look right while the real fallback read badly.
           */
          content:
            "I could not finish working through this one, and I stopped rather than guess at a recommendation the evidence would not carry. Your Business Health and your Action Plan are both still there to look at, and asking me again is a fair thing to do.",
          origin: "template",
          createdAt: "2026-09-13T10:00:20.000Z",
          artifacts: [],
          // A turn that fell back still looked at things first, and the founder
          // is entitled to see what it managed before it stopped.
          thinking: { durationMs: 2_100, steps: LOOKED_AT.steps.slice(0, 2) },
        },
      ],
      working: null,
    };
  }

  return {
    conversationId: "c1",
    messages: [
      ASKED,
      {
        id: "m2",
        sequence: 2,
        role: "assistant",
        content:
          "The thing to start with is putting a price on the public site. Every public page was read and none carries one, while a billing area exists behind sign-in, so visitors reach the signup form without knowing what it costs. The plan for it starts with adding a pricing section to the homepage, and that first step is one I can build once you say so.",
        origin: "model",
        createdAt: "2026-09-13T10:00:20.000Z",
        artifacts: [{ kind: "opportunity", subjectId: "opp-1", opportunity: MOVE }],
        thinking: LOOKED_AT,
      },
    ],
    working: null,
  };
}
