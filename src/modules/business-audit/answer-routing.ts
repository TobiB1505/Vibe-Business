import type { EditableField } from "@/modules/product-understanding/schema";
import {
  MONETIZATION_MODELS,
  PRIMARY_GOALS,
  PROJECT_STAGES,
  type FounderIntent,
} from "@/modules/projects/founder-intent";
import type { FounderQuestionIntent } from "./founder-questions";

/**
 * Where an answer belongs (CORE-2a.4 §18–§20).
 *
 * ## Two stores, and the line between them
 *
 * **Founder Intent** holds what the founder *wants*: where they think they are,
 * what they are working toward, whether they have decided to charge. Three
 * closed enums, unchanged since CORE-2.
 *
 * **Product Profile corrections** hold what the product *is*. When Vibe infers
 * "this is for software founders" and the founder says "no, it's for solo
 * developers who already shipped something", that is not a preference — it is
 * Vibe having been wrong about the product, and it belongs where every other
 * correction lives, surviving re-scans (§19).
 *
 * A third store for "audit answers" would be the business-context blob CORE-2
 * spent a sprint deleting, so there is deliberately nowhere else to put one.
 *
 * ## What that constraint caught
 *
 * `operating_market` — where the business will legally operate — has **no
 * canonical home**. Founder Intent is stage, charging direction and goal;
 * profile corrections describe the product, not its jurisdiction. §20 says a
 * question with nowhere clean to persist should be challenged rather than
 * given a new table, and this is that case.
 *
 * So it is not askable. `routeAnswer` returns null for it, and the gate refuses
 * to ask anything it cannot store — which makes the rule structural instead of
 * a note someone has to remember. The question intent stays in the vocabulary
 * because the audit still reasons about that gap; it simply cannot interrupt
 * for it until there is somewhere for the answer to go.
 */

export type AnswerDestination =
  | { store: "founder_intent"; field: keyof FounderIntent }
  | { store: "product_profile"; field: EditableField };

const ROUTES: Record<FounderQuestionIntent, AnswerDestination | null> = {
  current_stage: { store: "founder_intent", field: "stage" },
  primary_goal: { store: "founder_intent", field: "primaryGoal" },
  monetization_intent: { store: "founder_intent", field: "monetizationModel" },
  // A corrected first customer is a fact about the product, not a preference
  // about it, so it goes where a re-scan cannot overwrite it (§19, §51).
  first_customer: { store: "product_profile", field: "primaryAudience" },
  // No canonical store exists. See the note above.
  operating_market: null,
};

export function routeAnswer(intent: FounderQuestionIntent): AnswerDestination | null {
  return ROUTES[intent];
}

/** True when an answer to this question has somewhere legitimate to live. */
export function isStorable(intent: FounderQuestionIntent): boolean {
  return ROUTES[intent] !== null;
}

/**
 * The permitted values for a founder-intent answer, so a question can offer
 * exactly what the domain accepts rather than a free-text box that then fails
 * validation.
 */
export const INTENT_ANSWER_VALUES: Record<keyof FounderIntent, readonly string[]> = {
  stage: PROJECT_STAGES,
  monetizationModel: MONETIZATION_MODELS,
  primaryGoal: PRIMARY_GOALS,
};

export type SubmittedAnswer =
  /** A chosen enum value, or corrected prose for a profile field. */
  | { kind: "value"; value: string }
  /**
   * "I'm not sure yet" (§17, §45).
   *
   * A legitimate, complete answer — the founder has told Vibe something true:
   * that this is genuinely undecided. Nothing is written, because writing a
   * placeholder would turn an honest unknown into a fabricated fact. What stops
   * the loop is the record of having *asked*, which the audit keeps separately.
   */
  | { kind: "unsure" };

export type AnswerValidation =
  | { ok: true; answer: SubmittedAnswer }
  | { ok: false; reason: "unknown_intent" | "not_storable" | "value_not_permitted" | "value_empty" };

/**
 * Checks an answer against the destination it claims to be for.
 *
 * Rejects rather than coerces. An enum answer that is not one of our own values
 * is not a typo to trim — it is a request that did not come from the form we
 * rendered, and the closed vocabulary is the whole reason these fields cannot
 * carry arbitrary user prose into an evidence pack.
 */
export function validateAnswer(
  intent: FounderQuestionIntent,
  submitted: { unsure: boolean; value: string | null },
): AnswerValidation {
  const destination = routeAnswer(intent);
  if (destination === null) return { ok: false, reason: "not_storable" };

  if (submitted.unsure) return { ok: true, answer: { kind: "unsure" } };

  const value = submitted.value?.trim() ?? "";
  if (value === "") return { ok: false, reason: "value_empty" };

  if (destination.store === "founder_intent") {
    const permitted = INTENT_ANSWER_VALUES[destination.field];
    if (!permitted.includes(value)) return { ok: false, reason: "value_not_permitted" };
  }

  return { ok: true, answer: { kind: "value", value } };
}
