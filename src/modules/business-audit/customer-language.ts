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
      id: "intent.monetization_model",
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
 * Vocabulary that is ours, not the founder's.
 *
 * Deliberately short. A long blacklist is brittle, catches innocent prose, and
 * — the reason that matters here — the *rubric* used to carry one, which meant
 * the model was reading the phrase "monetization model" in its own
 * instructions immediately before writing it into an explanation. A general
 * rule in the rubric plus a small net here is both less brittle and less
 * suggestive.
 *
 * Every entry is a term this codebase actually uses as a domain or scanner
 * concept, and that was observed or is directly adjacent to something observed.
 * Not included: ordinary business English like "revenue", "customers",
 * "pricing" or "signup", which a founder uses too.
 */
export const INTERNAL_VOCABULARY = [
  "monetization model",
  "monetisation model",
  "monetization signal",
  "pricing surface",
  "checkout surface",
  "billing surface",
  "product surface",
  "acquisition surface",
  "acquisition approach",
  "retention capability",
  "retention architecture",
  "conversion path",
  "customer journey stage",
  "journey stage",
  "evidence pack",
  "evidence bundle",
  "evidence id",
  "repository signal",
  "business signal",
  "dimension score",
  "assessment status",
  "product profile",
  "founder intent",
  "deep scan",
] as const;

/** Case-insensitive, whole-phrase. Returns each distinct term found. */
export function findInternalVocabulary(text: string): string[] {
  const haystack = text.toLowerCase();
  return INTERNAL_VOCABULARY.filter((term) => haystack.includes(term));
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

export type CustomerLanguageCheck =
  | { ok: true }
  | { ok: false; terms: string[] };

/**
 * Checks only the synthesis, and only its customer-facing fields.
 *
 * Returns the offending terms rather than a boolean so the failure is
 * diagnosable from the stored record without replaying a paid call. The terms
 * are from our own closed list, so they are safe to persist — unlike the model
 * prose that contained them.
 */
export function checkCustomerLanguage(synthesis: AuditSynthesis): CustomerLanguageCheck {
  const found = new Set<string>();

  for (const text of customerFacingStrings(synthesis)) {
    for (const term of findInternalVocabulary(text)) found.add(term);
  }

  return found.size === 0 ? { ok: true } : { ok: false, terms: [...found].sort() };
}
