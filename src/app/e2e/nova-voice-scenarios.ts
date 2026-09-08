import { novaScenarioView } from "./nova-scenarios";
import type { NovaHomeEntry } from "@/modules/nova/home-view";

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
} as const satisfies Record<string, { voice: string | null; aside: string | null }>;

export const E2E_NOVA_VOICE_SCENARIOS = SCENARIOS;
export type E2eNovaVoiceScenario = keyof typeof SCENARIOS;

export function isE2eNovaVoiceScenario(value: string): value is E2eNovaVoiceScenario {
  return Object.hasOwn(SCENARIOS, value);
}

/**
 * The moment the thread draws, from the real view model.
 *
 * `nova-review` is the fixture whose facts raise a change waiting to be looked
 * at — a moment about work rather than about currency, which is the case where
 * both the written sentence and the aside are allowed to appear.
 */
export function novaVoiceEntry(): NovaHomeEntry {
  return novaScenarioView("nova-review").primary;
}
