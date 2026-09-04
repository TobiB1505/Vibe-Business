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

/**
 * How far back a negation may sit and still govern the phrase.
 *
 * An upper bound, not the bound. The clause the phrase sits in is the real one
 * — see {@link clauseBefore} — and this caps how much of a very long clause is
 * searched, so a negation twenty words upstream of an unrelated causal verb
 * does not reach it.
 */
const NEGATION_WINDOW = 60;

/**
 * Everything from the start of the phrase's own clause up to the phrase.
 *
 * ## The false negative this closes
 *
 * `NEGATION_WINDOW` alone is a character count, and a character count does not
 * know where a sentence ended. Sixty characters routinely spans one:
 *
 * > "We **cannot** measure the checkout yet. Pricing **caused** signups to rise."
 *
 * The "cannot" belongs to the first sentence and governs nothing in the second,
 * but it sits inside the sixty characters before "caused" — so a genuine,
 * unevidenced causal claim was read as a denial and never reported. The
 * function's own contract already said otherwise: *"a phrase preceded by a
 * negation within the same clause is a denial"*. This makes that true.
 *
 * ## Why both bounds, rather than the clause alone
 *
 * Because the clause alone would be *looser* in the shape with no punctuation
 * at all: one long unpunctuated line whose "no" sits eighty characters upstream
 * would start suppressing a causal verb that today is correctly reported.
 * Taking the window first and the clause inside it is narrower than either, so
 * nothing that is reported today stops being reported.
 *
 * ## What counts as a boundary
 *
 * `.` `!` `?` `;` `:` followed by a space. The trailing space is what keeps a
 * decimal out of it — the copy is whitespace-collapsed before this runs, so a
 * real terminator always carries a space and `9.8%` never does.
 *
 * An abbreviation does carry one, so "e.g. " **is** read as a boundary and a
 * negation before it stops governing. That is a known false positive, left
 * rather than patched with a list of abbreviations: it errs toward *reporting*
 * a causal phrase, the cost is that somebody rewords one sentence, and a guard
 * that fails loudly on honest copy is the right way round for this one.
 *
 * A comma is deliberately **not** a boundary. The disclaimer this module exists
 * to enforce reads "it does not, by itself, prove that this change caused the
 * difference", and cutting at a comma would flag the one sentence that keeps
 * the product honest.
 */
function clauseBefore(preceding: string): string {
  const boundary = /[.!?;:]\s/g;
  let start = 0;

  for (let match = boundary.exec(preceding); match !== null; match = boundary.exec(preceding)) {
    start = match.index + match[0].length;
  }

  return preceding.slice(start);
}

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

      const preceding = clauseBefore(normalized.slice(Math.max(0, at - NEGATION_WINDOW), at));
      // One unnegated occurrence is enough to make the whole copy a claim.
      if (!NEGATIONS.some((negation) => preceding.includes(negation))) return true;

      from = at + phrase.length;
    }
  });
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
