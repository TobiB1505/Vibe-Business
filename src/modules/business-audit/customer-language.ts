import type {
  FounderIntent,
  MonetizationModel,
  PrimaryGoal,
  ProjectStage,
} from "@/modules/projects/founder-intent";
import type { AuditSynthesis } from "./schema";

/**
 * The customer-language boundary (CORE-2a.2).
 *
 * ## The leak this module exists to close
 *
 * The first synthesis dogfood produced, in a customer-facing explanation:
 *
 *   "You've told Vibe there is no monetization model yet"
 *
 * Nothing hallucinated it. The evidence pack said, almost verbatim:
 *
 *   intent.monetization_model | Founder states the intended monetization model is: No monetization
 *
 * `MONETIZATION_LABELS` is a **UI** label table — correct above a `<select>`,
 * where the surrounding form already supplies the context. Feeding it to a
 * model as a sentence hands over internal taxonomy and then asks the model not
 * to use it. The model copied what it was given, which is the reasonable thing
 * to do.
 *
 * So the fix is at the input, not in a growing pile of output rules: the model
 * is given readable sentences and never sees the domain vocabulary at all.
 *
 * ## Two directions, one module
 *
 * `describeFounderIntent` is the way **in** — internal enums to plain
 * sentences, deterministic, no extra model call (§4, §5).
 *
 * `findInternalVocabulary` is the safety net on the way **out** (§10, §11). It
 * is deliberately small and applies only to the customer-facing synthesis
 * fields. Raw evidence stays precise: "canonical URL" and "structured data" are
 * exactly the words the model needs for grounding, and censoring them would
 * destroy information to fix a presentation problem (§8, §16).
 *
 * Nothing here is persisted. This is a serialization boundary, not a second
 * business-context model (§5).
 */

// ---------------------------------------------------------------------
// In: internal enums → sentences a model can safely echo
// ---------------------------------------------------------------------

/**
 * Written as complete sentences about a person, not as `key: value`.
 *
 * A label like "No monetization" invites the model to reuse the noun phrase.
 * A sentence like "They have not decided how the product will make money"
 * gives it the *meaning*, and the meaning is already in customer language — so
 * echoing the input is now the correct behaviour rather than the failure.
 */
const STAGE_SENTENCES: Record<ProjectStage, string> = {
  prototype: "They describe what they have built as an early prototype.",
  launched_no_users: "They have launched it, and say nobody is really using it yet.",
  active_users: "They say people are actively using it.",
  paid_customers: "They say some customers are already paying for it.",
};

const MONETIZATION_SENTENCES: Record<MonetizationModel, string> = {
  none: "They have not decided how the product will make money.",
  planned: "They intend to charge for it eventually, but nothing to pay for is built yet.",
  free: "They intend to keep it free to use.",
  subscription: "They intend to charge a recurring fee.",
  one_time: "They intend to charge a single up-front price.",
  usage_based: "They intend to charge based on how much someone uses it.",
  marketplace: "They intend to take a share of transactions between other people.",
  other: "They have something else in mind for how it will earn money.",
};

const GOAL_SENTENCES: Record<PrimaryGoal, string> = {
  launch: "Right now they are trying to get it launched.",
  get_first_users: "Right now they are trying to find their first users.",
  monetize: "Right now they are trying to start earning money from it.",
  improve_conversion: "Right now they are trying to turn more visitors into users.",
  improve_retention: "Right now they are trying to get people coming back.",
  grow_revenue: "Right now they are trying to grow how much they earn.",
};

/**
 * What the founder told us, as sentences.
 *
 * Returns one entry per stated field, and nothing for the fields they left
 * blank — an unstated field is reported as absent evidence elsewhere, and a
 * placeholder here would read to the model as a claim.
 */
export function describeFounderIntent(intent: FounderIntent): Array<{ id: string; text: string }> {
  const described: Array<{ id: string; text: string }> = [];

  if (intent.stage) {
    described.push({ id: "intent.stage", text: STAGE_SENTENCES[intent.stage] });
  }
  if (intent.monetizationModel) {
    described.push({
      // `intent.monetization_model` until CORE-2a.3.2's final fix, and it was
      // the last live source of the leak this module exists to close. The pack
      // renders every line as `id | source | fact`, so the model read the words
      // "monetization model" on every single run — in an identifier, one
      // underscore away from prose — while the rubric asked it not to use them.
      // CORE-2a.2 rewrote the label and left the id, which is why the phrase
      // survived three sprints of fixes aimed at the sentence next to it.
      id: "intent.how_it_earns",
      text: MONETIZATION_SENTENCES[intent.monetizationModel],
    });
  }
  if (intent.primaryGoal) {
    described.push({ id: "intent.primary_goal", text: GOAL_SENTENCES[intent.primaryGoal] });
  }

  return described;
}

// ---------------------------------------------------------------------
// Out: the safety net
// ---------------------------------------------------------------------

/**
 * Vocabulary that is ours, not the founder's — in two tiers.
 *
 * ## Why there are tiers now
 *
 * CORE-2a.2 made one flat list and rejected the whole audit on any hit. Three
 * consecutive real refreshes then failed on the same two words, at $0.25 total,
 * while a fourth run containing the same reasoning passed — the model says
 * "monetization model" sometimes and "how this will make money" other times.
 * A coin flip that discards a $0.10 audit is a badly calibrated rule, not a
 * misbehaving model.
 *
 * The deeper problem is structural: `monetization` is one of the five scored
 * dimensions. The model is *required* to emit it five times per run and was
 * then forbidden from writing the natural collocation of it. No amount of extra
 * prompt pressure fixes being asked to hold a word and not use it.
 *
 * So the question the boundary actually asks — **would a founder understand
 * this sentence?** — is now answered at two levels, because the terms were
 * never equally harmful:
 *
 *   "no pricing surface was detected"    → genuinely opaque. Reject.
 *   "no monetization model yet"          → corporate, but parseable. Note it.
 *
 * The rubric still teaches the better phrasing for both. What changed is only
 * what happens when the model ignores it.
 */

/**
 * Terms that leave a sentence meaningless to someone outside this codebase.
 *
 * Mostly scanner and internal artefacts: a founder has no idea what a "product
 * surface" or an "evidence pack" is, and a conclusion built on one tells them
 * nothing. These still reject the audit.
 *
 * A term earns this tier only if the model is never shown it. Rejecting a
 * billed audit for a word we put in its own instructions is not a boundary,
 * it is a trap — and it is the trap that discarded three real runs before
 * `model-input-language.test.ts` made the input half of this contract
 * enforceable: no term below may appear in the system prompt, the rubric or
 * any rendered evidence line.
 */
export const BLOCKING_VOCABULARY = [
  "pricing surface",
  "checkout surface",
  "billing surface",
  "product surface",
  "acquisition surface",
  "evidence pack",
  "evidence bundle",
  "evidence id",
  "repository signal",
  "business signal",
  "monetization signal",
  "dimension score",
  "assessment status",
  "product profile",
  "founder intent",
  "customer journey stage",
  "journey stage",
] as const;

/**
 * Startup-speak a founder will still parse, even though better words exist.
 *
 * Recorded as a validation note rather than thrown away. The note is what keeps
 * this honest: if these start appearing constantly, the rubric is not teaching
 * well enough and that is visible rather than silent.
 */
export const DISCOURAGED_VOCABULARY = [
  /*
   * Vibe's own feature, named on a button the founder has already clicked.
   *
   * It sat in the blocking tier until a real run on 2026-09-01 was discarded
   * for writing it — and it failed that tier's own test twice over. A founder
   * is not outside this codebase when it comes to Deep Scan: the panel, the
   * evidence notice and the start control all say the words. And "deep scan"
   * is ordinary English besides, so a sentence nobody primed can land on it.
   *
   * The asymmetry decides the tier. Accepting it costs one comprehensible
   * sentence about what Vibe has and has not looked at; rejecting it costs a
   * billed audit and leaves the founder with an error where their business was
   * meant to be. It is still not what a conclusion should be about — the audit
   * describes the business, not Vibe's tooling — so it is recorded as a note,
   * and the input boundary below is what keeps it rare.
   */
  "deep scan",
  "monetization model",
  "monetisation model",
  "conversion path",
  "acquisition approach",
  "retention capability",
  "retention architecture",
] as const;

export const INTERNAL_VOCABULARY = [
  ...BLOCKING_VOCABULARY,
  ...DISCOURAGED_VOCABULARY,
] as const;

/** Case-insensitive, whole-phrase. Returns each distinct term found. */
export function findInternalVocabulary(text: string): string[] {
  const haystack = text.toLowerCase();
  return INTERNAL_VOCABULARY.filter((term) => haystack.includes(term));
}

function findIn(text: string, terms: readonly string[]): string[] {
  const haystack = text.toLowerCase();
  return terms.filter((term) => haystack.includes(term));
}

/**
 * Every customer-facing string in a synthesis.
 *
 * Exported so the boundary is stated once. Anything not listed here — the
 * dimension summaries, the per-dimension strengths and gaps, the limitations,
 * the evidence labels — is deliberately *not* subject to the language rule
 * (§8, §11, §16). Those are the technical layer, and they are supposed to say
 * "canonical URL".
 */
export function customerFacingStrings(synthesis: AuditSynthesis): string[] {
  const strings: string[] = [];
  if (synthesis.overall !== "") strings.push(synthesis.overall);

  for (const conclusion of [...synthesis.strengths, ...synthesis.blockers]) {
    strings.push(conclusion.headline, conclusion.explanation);
    if (conclusion.whyItMatters) strings.push(conclusion.whyItMatters);
  }

  return strings;
}

export type CustomerLanguageCheck = {
  /** False only when a term that destroys meaning got through. */
  ok: boolean;
  /** Terms that reject the audit. Empty when `ok`. */
  blocking: string[];
  /** Terms worth recording but not worth discarding a good audit over. */
  discouraged: string[];
};

/**
 * Checks only the synthesis, and only its customer-facing fields.
 *
 * Returns the offending terms rather than a boolean so a failure is
 * diagnosable from the stored record without replaying a paid call — which is
 * exactly what the first three real rejections could not do. The terms come
 * from our own closed lists, so they are safe to persist; the prose that
 * contained them is not.
 */
export function checkCustomerLanguage(synthesis: AuditSynthesis): CustomerLanguageCheck {
  const blocking = new Set<string>();
  const discouraged = new Set<string>();

  for (const text of customerFacingStrings(synthesis)) {
    for (const term of findIn(text, BLOCKING_VOCABULARY)) blocking.add(term);
    for (const term of findIn(text, DISCOURAGED_VOCABULARY)) discouraged.add(term);
  }

  return {
    ok: blocking.size === 0,
    blocking: [...blocking].sort(),
    discouraged: [...discouraged].sort(),
  };
}
