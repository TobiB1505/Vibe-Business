import type { ProductProfile } from "@/modules/product-understanding/schema";
import { isEmptyFounderIntent, type FounderIntent } from "@/modules/projects/founder-intent";
import { isActionable } from "./lens-priority";
import type { BusinessLensAssessment, BusinessLens } from "./schema";

/**
 * Which questions are worth asking a founder, and why (CORE-2a.3 §22–§31).
 *
 * ## The rule
 *
 * **Ask only when the answer could materially change the audit.** Not when a
 * field is empty — a missing field that changes nothing is not a question, it
 * is a form. The ranking is uncertainty × business impact, and a fact Vibe can
 * already establish confidently is never asked at all:
 *
 *   Bad, after scanning:  "What does your product do?"
 *   Good:                 "I think you built X for Y. Did I get that right?"
 *
 * ## Why this is deterministic
 *
 * Because it can be. Everything the choice depends on — which intent fields
 * are set, how confident the profile is, which lenses came back blocked — is
 * already structured data by the time this runs. A model asked to invent
 * business questions produces a startup questionnaire; §31 says to check for a
 * deterministic path first, and there is one.
 *
 * What the model *does* contribute is upstream: `missingContext` on a lens
 * assessment is the audit naming what it could not answer, and that is what
 * makes a question grounded rather than generic.
 *
 * ## Grounding
 *
 * Every question carries context explaining why Vibe is asking, and that
 * context may only assert things the profile or the audit actually established
 * (§29). A question that invents a premise to sound perceptive is worse than a
 * plain one — it is the same failure as an ungrounded conclusion, wearing a
 * friendlier face.
 */

/**
 * The closed set of things Vibe may ask about.
 *
 * Closed on purpose. An open set is how this becomes the twelve-question
 * onboarding form CORE-2 deleted, one well-intentioned addition at a time.
 */
export const FOUNDER_QUESTION_INTENTS = [
  /** Where the product actually is today. Changes materiality everywhere. */
  "current_stage",
  /** What would make the next few months a success. Changes priority. */
  "primary_goal",
  /** Whether the founder has decided how this earns money. */
  "monetization_intent",
  /** Who to win first, when the audience is inferred and broad. */
  "first_customer",
  /** Where the business will operate — only once payment is genuinely near. */
  "operating_market",
] as const;

export type FounderQuestionIntent = (typeof FOUNDER_QUESTION_INTENTS)[number];

export type FounderQuestion = {
  intent: FounderQuestionIntent;
  /** The question itself, in the founder's language. */
  prompt: string;
  /**
   * Why Vibe is asking, grounded in something it actually established.
   * Null when there is nothing specific to say — better than a fabricated
   * premise.
   */
  context: string | null;
  /** Whether "I'm not sure yet" is a legitimate answer (§48). */
  allowsUnsure: boolean;
  /** Higher is asked first. Uncertainty × impact, resolved to an ordering. */
  weight: number;
};

/**
 * Normal ceiling (§24).
 *
 * Two to five, not twelve. If Vibe already understands a lot it asks fewer,
 * and asking fewer is the good outcome rather than a missed opportunity.
 */
export const MAX_FOUNDER_QUESTIONS = 5;

/** A profile claim strong enough that asking about it would be insulting. */
function isConfident(claim: { value: unknown; confidence: string }): boolean {
  return claim.value !== null && (claim.confidence === "confirmed" || claim.confidence === "likely");
}

/** True when the founder — not an inference — settled this. */
function isUserConfirmed(claim: { sources: readonly string[] }): boolean {
  return claim.sources.includes("user_confirmed");
}

function lensOf(
  lenses: BusinessLensAssessment[],
  lens: BusinessLens,
): BusinessLensAssessment | undefined {
  return lenses.find((entry) => entry.lens === lens);
}

/**
 * A lens that matters *now* and could not be assessed is the strongest signal
 * there is — that is the audit saying it cannot judge the business without an
 * answer only the founder has.
 *
 * Both halves are required. A blocked lens the audit ranked `later` is a
 * question worth asking eventually, not one worth interrupting for, and asking
 * it today is how a short adaptive prompt turns back into an onboarding form.
 */
function isBlockedAndMaterial(assessment: BusinessLensAssessment | undefined): boolean {
  if (!assessment) return false;
  const blocked =
    assessment.health === "blocked_by_missing_context" || assessment.health === "unclear";
  return blocked && isActionable(assessment.materiality);
}

export type QuestionSelectionInput = {
  profile: ProductProfile;
  intent: FounderIntent;
  /** From the most recent audit, when one exists. Empty before the first. */
  lenses: BusinessLensAssessment[];
};

/**
 * The questions worth asking, most valuable first.
 *
 * Returns an empty list when Vibe knows enough — which is a correct and common
 * answer, not a failure to find something to ask.
 */
export function selectFounderQuestions(input: QuestionSelectionInput): FounderQuestion[] {
  const { profile, intent, lenses } = input;
  const questions: FounderQuestion[] = [];

  const productName = profile.identity.name.value;
  const named = productName ? `${productName}` : "this";

  /**
   * What Vibe worked out about the product, when it holds it confidently
   * enough to say out loud. Null rather than a hedge — an unconfident premise
   * repeated back is worse than no premise (§12).
   */
  const understanding = isConfident(profile.identity.understanding)
    ? profile.identity.understanding.value
    : null;

  /*
   * 1. Stage. The highest-weight question when unknown, because materiality
   *    everywhere else depends on it: the same missing analytics is irrelevant
   *    before launch and serious once real traffic exists.
   */
  if (intent.stage === null) {
    questions.push({
      intent: "current_stage",
      prompt: "Where are you actually with this today?",
      /*
       * The understanding sentence, quoted back.
       *
       * The first real interruption said "Vibe can see what you've built" to a
       * founder whose profile read "a vacation planning tool for hotel staff
       * … instead of scattered emails or spreadsheets". Vibe had the sentence
       * and described it as *"what you've built"*. Saying the thing is the
       * difference between a question that proves understanding and one that
       * merely claims it (§11, §62).
       */
      context: understanding ? `${understanding} What Vibe can't tell is how far along it is with real people.` : null,
      allowsUnsure: false,
      weight: 100,
    });
  }

  /*
   * 2. Goal. Changes which problems get prioritized, so it is worth asking
   *    even when much else is known.
   */
  if (intent.primaryGoal === null) {
    questions.push({
      intent: "primary_goal",
      prompt: named === "this"
        ? "What would make the next few months a success?"
        : `What would make the next few months a success for ${named}?`,
      // Meta-commentary about the audit ("it changes which problems Vibe puts
      // first") is not context — it explains Vibe's process rather than
      // showing what Vibe understood. Grounded where the profile allows it.
      context: understanding,
      allowsUnsure: true,
      weight: 90,
    });
  }

  /*
   * 3. Monetization intent — but only when it is genuinely open.
   *
   * The weight rises sharply when the audit found the economics lens blocked,
   * because that is the audit itself saying it could not judge the business
   * without this. That is the difference between a form field and a question.
   */
  if (intent.monetizationModel === null) {
    const economics = lensOf(lenses, "revenue_economics");
    const blocked = isBlockedAndMaterial(economics);

    questions.push({
      intent: "monetization_intent",
      prompt: "Have you decided how you want this to make money?",
      context: blocked
        ? "Vibe couldn't work out how the value here turns into revenue, and that's the one thing it can't infer from your product."
        : "Vibe couldn't find prices or a way to pay, so it can't tell whether that's deliberate.",
      allowsUnsure: true,
      weight: blocked ? 95 : 70,
    });
  }

  /*
   * 4. First customer — only when the audience is inferred rather than
   *    confirmed. A founder who has already told us this must never be asked
   *    again (§20, DoD 26).
   */
  const audience = profile.audience.primaryAudience;
  if (!isUserConfirmed(audience)) {
    const audienceLensBlocked = isBlockedAndMaterial(lensOf(lenses, "audience"));
    const weak = !isConfident(audience);

    if (weak || audienceLensBlocked) {
      questions.push({
        intent: "first_customer",
        prompt: audience.value
          ? `Vibe thinks ${named} is for ${audience.value.toLowerCase()}. Who do you want to win first?`
          : "Who do you want to win first?",
        // Only claims what the profile actually holds.
        context: audience.value
          ? "Vibe worked that out from your product rather than being told, so it's worth confirming."
          : "Vibe couldn't work out who this is aimed at from the product alone.",
        allowsUnsure: true,
        weight: audienceLensBlocked ? 80 : 60,
      });
    }
  }

  /*
   * 5. Operating market — deliberately the lowest weight and the narrowest
   *    trigger (§26).
   *
   * Asked only when payment is genuinely near: the founder intends to charge,
   * and the readiness lens says something is missing. Never asked by default
   * because the field might be useful one day.
   */
  const intendsToCharge =
    intent.monetizationModel !== null &&
    intent.monetizationModel !== "none" &&
    intent.monetizationModel !== "free";

  if (intendsToCharge && isBlockedAndMaterial(lensOf(lenses, "business_readiness"))) {
    questions.push({
      intent: "operating_market",
      prompt: "Where will the business mainly operate?",
      context: "You're getting close to taking payments, and that changes what you'll need in place.",
      allowsUnsure: true,
      weight: 40,
    });
  }

  return questions.sort((a, b) => b.weight - a.weight).slice(0, MAX_FOUNDER_QUESTIONS);
}

/**
 * Whether Vibe should ask anything at all before auditing.
 *
 * Stage and goal are the two that change assessments across several lenses, so
 * they are worth interrupting for. Everything else can wait until after the
 * audit, when a specific blocker needs more context (§45).
 */
export function shouldAskBeforeAudit(intent: FounderIntent): boolean {
  return isEmptyFounderIntent(intent) || intent.stage === null || intent.primaryGoal === null;
}
