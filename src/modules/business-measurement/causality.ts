import type { MeasurementStatus } from "./schema";

/**
 * The causality boundary (Sprint 12B §10, §24, §43).
 *
 * ## The sentence this file exists to prevent
 *
 * > "This change caused a 9.8% increase in conversion."
 *
 * Vibe cannot know that. It observed one metric over one period, compared it to
 * another period, and found a difference. Everything else that happened in
 * those two weeks — a launch, a holiday, a competitor's outage, a seasonal
 * swing, another change merged the same day, a Google algorithm update — is
 * equally consistent with the numbers.
 *
 * Establishing causality needs a control: the same period, the same audience,
 * with and without the change. This product runs no experiments, so it has no
 * control, so it has no causal claim. That is not a limitation to apologise for
 * once in a footnote; it is the difference between an analytics product and a
 * fortune teller.
 *
 * ## Why this is code rather than a style guide
 *
 * Because the wrong verb is one word, and one word is exactly the kind of
 * change that passes review. `assertNonCausalLanguage` is asserted against the
 * UI copy and the domain vocabulary in tests, so a mutation replacing
 * "observed" with "caused" fails the build (§43).
 */

/**
 * Whether any experiment design currently backs a causal claim.
 *
 * Always `false`, and a function rather than a constant so that the day an
 * experiment framework exists, every place that must change is a compile error
 * rather than a search.
 */
export function hasCausalEvidence(): false {
  return false;
}

/**
 * Verbs and phrases that assert causation.
 *
 * Matched case-insensitively against user-facing copy. Deliberately includes
 * the softer forms — "drove", "led to", "thanks to", "resulted in" — because
 * those read as causal to a person even when the writer meant them loosely, and
 * a person acting on them is the harm.
 */
export const CAUSAL_PHRASES = [
  "caused",
  "causing",
  "causes",
  "drove",
  "driven by",
  "led to",
  "leading to",
  "resulted in",
  "resulting in",
  "thanks to",
  "because of this change",
  "due to this change",
  "as a result of this change",
  "attributable to",
  "uplift from",
  "impact of this change was",
  "this change improved",
  "this change increased",
  "this change decreased",
] as const;

/**
 * The vocabulary a measurement result may be described with.
 *
 * All of it is about *what was seen in a period*, none of it about *what made
 * it happen*.
 */
export const OBSERVATIONAL_PHRASES = [
  "observed",
  "during the measurement window",
  "between the measurement windows",
  "compared with",
] as const;

/**
 * Words that turn a causal phrase into a denial of one.
 *
 * The disclaimer this module exists to enforce contains the word "caused" — it
 * has to, because denying causation requires naming it. A checker that matched
 * the bare substring would flag the very sentence that keeps the product
 * honest, and the only way to satisfy it would be to stop denying causation at
 * all. So negation is recognised rather than worked around.
 */
const NEGATIONS = [
  "does not",
  "do not",
  "did not",
  "cannot",
  "can not",
  "never",
  "no evidence",
  "not prove",
  "without",
];

/** How far back a negation may sit and still govern the phrase. */
const NEGATION_WINDOW = 60;

/**
 * Finds causal *claims* in a piece of copy.
 *
 * Returns the offending phrases rather than a boolean, so a failing test names
 * the exact word to fix instead of reporting that something, somewhere, is
 * wrong.
 *
 * A phrase preceded by a negation within the same clause is a denial, not a
 * claim, and is deliberately not reported. That is the difference between
 * *"this change caused a 15% increase"* — which the product must never say —
 * and *"it does not prove that this change caused the difference"*, which it
 * must always say.
 */
export function findCausalClaims(copy: string): string[] {
  const normalized = copy.toLowerCase().replace(/\s+/g, " ");

  return CAUSAL_PHRASES.filter((phrase) => {
    let from = 0;

    for (;;) {
      const at = normalized.indexOf(phrase, from);
      if (at === -1) return false;

      const preceding = normalized.slice(Math.max(0, at - NEGATION_WINDOW), at);
      // One unnegated occurrence is enough to make the whole copy a claim.
      if (!NEGATIONS.some((negation) => preceding.includes(negation))) return true;

      from = at + phrase.length;
    }
  });
}

/**
 * Promises about a business outcome (Sprint 13A §2).
 *
 * ## Why this is separate from the causal phrases
 *
 * Because measurement copy and rationale copy fail in opposite directions.
 * Measurement copy fails **retrospectively** — "this change increased signups"
 * claims causation for something merely observed. Rationale copy fails
 * **prospectively** — "this will increase signups" promises an outcome nobody
 * has evidence for, and a rationale is written before anything has happened at
 * all.
 *
 * `CAUSAL_PHRASES` was written for the first case and does not cover the
 * second: a rationale reading *"This increases organic traffic"* passes it
 * cleanly. That gap was found by a deliberate regression, not by reasoning.
 *
 * ## Why these are patterns rather than literal phrases
 *
 * Because the offence is a **verb aimed at a business noun**, and enumerating
 * every conjugation against every metric would be a list nobody maintains.
 * "Improves how the product can be described" is a factual statement about what
 * a capability does; "improves conversion" is a promise. Only the second names
 * an outcome the customer would hold Vibe to.
 */
const PROMISSORY_PATTERNS: readonly { label: string; pattern: RegExp }[] = [
  {
    label: "promises a business outcome",
    // A growth verb pointed at a business noun, within one clause of it.
    pattern:
      /\b(increase|improve|boost|grow|raise|drive|lift)s?\b[^.]{0,40}\b(traffic|revenue|conversions?|rankings?|sales|customers|signups?|subscribers|users)\b/,
  },
  { label: "guarantees an outcome", pattern: /\bguarantees?\b/ },
  { label: "promises certainty", pattern: /\bensures?\b/ },
  { label: "predicts an outcome", pattern: /\bwill (increase|improve|boost|grow|convert|rank)\b/ },
];

/**
 * Finds promissory claims in forward-looking copy.
 *
 * Negation-aware on the same terms as `findCausalClaims`, which is what lets a
 * rationale say *"does not guarantee rankings, traffic or revenue"* — the
 * sentence that stops the paragraph above it from being a promise — without
 * tripping the very guard that sentence exists to satisfy.
 */
export function findPromissoryClaims(copy: string): string[] {
  const normalized = copy.toLowerCase().replace(/\s+/g, " ");

  return PROMISSORY_PATTERNS.filter(({ pattern }) => {
    const match = normalized.match(pattern);
    if (!match || match.index === undefined) return false;

    const preceding = normalized.slice(Math.max(0, match.index - NEGATION_WINDOW), match.index);
    return !NEGATIONS.some((negation) => preceding.includes(negation));
  }).map(({ label }) => label);
}

/**
 * The disclaimer that must accompany every stated result (§24).
 *
 * Exported as a constant rather than written inline in the panel, so it cannot
 * be dropped in a redesign and so the test that requires it has something exact
 * to require.
 */
export const OBSERVED_CHANGE_DISCLAIMER =
  "This is an observed change between the defined measurement windows. It does not by itself prove that this code change caused the difference.";

/** True for the statuses that state a movement and therefore need the disclaimer. */
export function requiresObservedChangeDisclaimer(status: MeasurementStatus): boolean {
  return status === "improved" || status === "degraded" || status === "neutral";
}
