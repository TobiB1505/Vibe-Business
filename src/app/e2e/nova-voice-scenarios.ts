import { novaScenarioView } from "./nova-scenarios";
import type { NovaHomeEntry } from "@/modules/nova/home-view";
import type { BusinessOpportunity } from "@/modules/opportunities/schema";
import type { OpportunityActionState } from "@/modules/execution/view";

/**
 * Nova's own writing in the thread, in the three states it has.
 *
 * ## Why this needs a browser
 *
 * The claim is not that the strings are right — unit tests decide that. It is
 * that a founder reads **one run of two lines** rather than two claims that
 * seem to disagree: the moment sentence is always current and always Vibe's,
 * and hers is what she wrote about the document when she made it. Whether that
 * reads as one person continuing or as two voices talking over each other is a
 * property of the rendered page and of nothing else.
 *
 * The third state is the one that has to look deliberate: nothing written, no
 * evidence worth mentioning, and the thread exactly as it was before any of
 * this existed. That is the ordinary case.
 */

/** Written by a model at the tail of the audit that produced the reading. */
const SPOKEN =
  "I went through your business and the thing standing out most is that nothing on the site says what it costs. Worth knowing before you act on it: I read your website with a version I have since corrected.";

/** Vibe's own, when nothing was written. Composed by `buildNovaSituation`. */
const ASIDE =
  "Your website is the thing to repair first. Vibe has corrected how it reads this since the last run.";

const SCENARIOS = {
  /**
   * The ordinary state, and the one that must not look broken. Nothing was
   * written, nothing about the evidence is worth raising, and the thread says
   * exactly what it said before the voice existed.
   */
  "nova-voice-none": { voice: null, aside: null },

  /**
   * Nova wrote about the document this moment is about. Two bubbles, one
   * speaker: the second carries no tail, which is the rule `speechBubbles`
   * applies to any run.
   */
  "nova-voice-spoken": { voice: SPOKEN, aside: null },

  /**
   * Nothing written, and the evidence underneath is worth a word. The quieter
   * register, because it is context rather than a claim of Nova's about what
   * is open — and it never appears beside her own sentence.
   */
  "nova-voice-aside": { voice: null, aside: ASIDE },

  /**
   * A moment about a Move, with the Move under it. The control and its price
   * sit beside the block, never inside it — a founder is never a mis-click
   * away from spending inside something they are reading.
   */
  "nova-voice-move": { voice: null, aside: null },
} as const satisfies Record<string, { voice: string | null; aside: string | null }>;

export const E2E_NOVA_VOICE_SCENARIOS = SCENARIOS;
export type E2eNovaVoiceScenario = keyof typeof SCENARIOS;

export function isE2eNovaVoiceScenario(value: string): value is E2eNovaVoiceScenario {
  return Object.hasOwn(SCENARIOS, value);
}

/**
 * The moment the thread draws, from the real view model.
 *
 * `nova-review` for the voice states: its facts raise a change waiting to be
 * looked at, a moment about work rather than about currency, which is the case
 * where both the written sentence and the aside are allowed to appear.
 *
 * `nova-moves` for the Move block, because the block a moment gets is decided
 * by the moment — a Move card under a change's own label would be a fixture
 * agreeing with itself about the wrong thing.
 */
export function novaVoiceEntry(scenario: E2eNovaVoiceScenario): NovaHomeEntry {
  return novaScenarioView(scenario === "nova-voice-move" ? "nova-moves" : "nova-review").primary;
}

/**
 * The Move a moment names, drawn under the sentence that names it.
 *
 * ## What has to be visible
 *
 * That the block is a *view* and the control is beside it, not inside it. A
 * founder was being asked to spend twenty Credits on a control whose only
 * description was its own label; the point of the block is that the problem,
 * the impact, the effort and Vibe's confidence that the problem exists are on
 * the same screen as the button that charges for them.
 *
 * The execution state is the one thing the card cannot know from the Move
 * alone, and `preparable` is the state that matters most here — it is the one
 * where a priced button appears.
 */
export const E2E_NOVA_MOVE: {
  opportunity: BusinessOpportunity;
  execution: OpportunityActionState;
} = {
  opportunity: {
    id: "opportunity_e2e",
    sourceConclusionKey: "conversion.pricing_absent",
    rank: 1,
    title: "Put a price on the pricing page",
    problem: "The pricing page names no amount, so nobody can find out what it costs.",
    whyNow: "It sits in front of every purchase, and your goal on file is to reach paying customers.",
    impact: "high",
    effort: "medium",
    confidence: "high",
    category: "conversion",
    primaryLens: "conversion",
    secondaryLenses: [],
    evidenceIds: [],
    executionType: "code_change",
    executionReadiness: "ready",
    dependencies: [],
  },
  /* Vibe has an executor and nothing blocks it — the state a priced control
     is offered from, and the one a founder decides in. */
  execution: { kind: "preparable", capability: "agentic_execution_v2" },
};
