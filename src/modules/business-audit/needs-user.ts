import type { ProductProfile } from "@/modules/product-understanding/schema";
import type { FounderIntent } from "@/modules/projects/founder-intent";
import {
  selectFounderQuestions,
  type FounderQuestion,
  type FounderQuestionIntent,
} from "./founder-questions";
import { isStorable } from "./answer-routing";
import { isActionable } from "./lens-priority";
import type { BusinessLens, BusinessLensAssessment, LensMateriality } from "./schema";

/**
 * The "Vibe needs u" gate (CORE-2a.4).
 *
 * ## What this layer is for
 *
 * `founder-questions.ts` answers *"which questions could Vibe usefully ask?"*.
 * This answers a much narrower and more expensive question: **"is this worth
 * stopping the audit for, right now?"**
 *
 * Those are not the same, and collapsing them is how a good audit turns back
 * into the onboarding form CORE-2 deleted. A lens saying "only you can answer
 * this" produces a *candidate*, never an interruption. Between the candidate
 * and the founder sits everything below.
 *
 * ## Why a pause costs nothing
 *
 * Everything here is deterministic — the profile, the founder's stated intent,
 * and the lens assessments from the previous audit are all structured data by
 * the time this runs. So the gate executes *before* the paid call rather than
 * inside it, which is what makes pausing free: no tokens are spent, and
 * answering does not resume a half-finished inference, it starts the one call
 * with better inputs.
 *
 * The honest consequence, worth stating rather than hiding: questions cannot
 * be interleaved *between* lenses, because all nine lenses come from a single
 * structured response. What Vibe knows when it pauses is what the last audit
 * worked out plus what the founder has told it. For a first audit there are no
 * prior lenses, and the questions come from the profile and intent alone.
 *
 * ## One at a time
 *
 * `selectBlockingQuestion` returns at most one question, and the caller
 * re-runs it after every answer. That is not a simplification — it is the only
 * way §8's dependency rule can work. Knowing who the first customer is may
 * remove the acquisition question entirely, change its wording, or make it
 * something the Planner should decide rather than the founder. A batch of
 * questions locked in at audit start could not do any of that.
 */

/**
 * Facts Vibe can establish itself, mapped to the question it must therefore
 * never ask (§13, §37).
 *
 * The sharpest case is Vibe Business's own: an audit lens genuinely reported
 * "only you can answer what each audit run costs to deliver" — while the
 * `ai_usage_events` ledger holds the exact figure for every run ever made.
 * Asking the founder for a number we bill ourselves would be the most
 * embarrassing possible question, and it was one lens assessment away from
 * being asked.
 *
 * This is a list of *sources*, not of forbidden words: the test is "could this
 * be looked up", and the answer for anything measurable is yes.
 */
export const VIBE_KNOWABLE_SOURCES = [
  "the usage and cost ledger",
  "the repository",
  "the live site",
  "the signed-in product",
  "the product profile",
] as const;

/**
 * Why a candidate did not become an interruption.
 *
 * A bounded vocabulary rather than prose, because it is persisted with the
 * audit and read back when judging whether the gate behaved (§59, §60). "Vibe
 * decided not to ask" is only reviewable if it says which rule decided.
 */
export const WITHHELD_REASONS = [
  /** Nothing the founder alone could settle is currently unresolved. */
  "nothing_unresolved",
  /** Real, but it belongs to a later stage of the business. */
  "not_material_yet",
  /** Another question has to be answered before this one makes sense. */
  "blocked_by_prerequisite",
  /** Vibe can establish this itself and must not ask for it. */
  "vibe_can_answer_this",
  /** Already asked in this run — including answered with "not sure yet". */
  "already_asked",
  /** The interruption budget for one audit is spent. */
  "budget_spent",
  /** No canonical store holds this kind of answer, so it must not be asked. */
  "nowhere_to_store_it",
] as const;
export type WithheldReason = (typeof WITHHELD_REASONS)[number];

/**
 * Which lenses an answer could change (§26).
 *
 * Deliberately wider than the lens that raised the question. Naming the first
 * customer does not only settle `audience` — it changes who the offer is for,
 * which channels are plausible, and what a conversion path should even lead
 * to. Recorded so a resumed audit can be checked against what it claimed the
 * answer would affect.
 */
const AFFECTED_LENSES: Record<FounderQuestionIntent, BusinessLens[]> = {
  current_stage: ["offer", "measurement", "retention", "business_readiness", "scalability"],
  primary_goal: ["offer", "audience", "acquisition", "conversion", "retention"],
  monetization_intent: ["revenue_economics", "conversion", "scalability", "business_readiness"],
  first_customer: ["audience", "offer", "acquisition", "conversion"],
  operating_market: ["business_readiness"],
};

/**
 * Questions that only make sense once another has been settled (§8, §46).
 *
 * "Which channel will you use?" asked before "who are you trying to reach?"
 * is the interview equivalent of scaling acquisition before knowing the
 * customer — and the rubric already refuses to prioritize that work, so asking
 * about it would contradict the audit's own reasoning.
 */
const PREREQUISITES: Partial<Record<FounderQuestionIntent, FounderQuestionIntent[]>> = {
  operating_market: ["monetization_intent"],
};

/**
 * How many times one audit may stop for the founder (§9, §19).
 *
 * Three, and reaching three should be unusual. The product promise is that
 * Vibe works almost everything out on its own; an audit that stops four times
 * has stopped being an audit and become a form with a progress bar.
 */
export const MAX_INTERRUPTIONS_PER_AUDIT = 3;

export type PendingQuestion = {
  intent: FounderQuestionIntent;
  prompt: string;
  /** What Vibe already understood, or null rather than a fabricated premise. */
  context: string | null;
  allowsUnsure: boolean;
  /** Lenses whose assessment this answer could change. */
  affectedLenses: BusinessLens[];
  /** The materiality of the lens that made this urgent, when one did. */
  materiality: LensMateriality | null;
  /** Why stopping is worth it, in one internal sentence. */
  whyItMatters: string;
};

export type InterruptionInput = {
  profile: ProductProfile;
  intent: FounderIntent;
  /** From the previous audit. Empty before the first one. */
  lenses: BusinessLensAssessment[];
  /**
   * Whether those lens assessments still describe the current facts.
   *
   * The previous audit's lenses are a **historical hint, never authority.**
   * They were assessed against one specific product profile and one specific
   * set of founder answers, both of which may have changed since — and this
   * whole feature exists to change them. An audit that paused, took an answer
   * and resumed would otherwise be re-reading materiality that was decided
   * before that answer existed.
   *
   * Determined by comparing the stored audit's `productProfileId` and
   * `founderIntentHash` against the current ones, so it is a fact rather than
   * a guess about age. When it is false, materiality is treated as unknown and
   * the question stands or falls on the current profile and intent — the same
   * position as a first audit, which is exactly what "the facts have moved"
   * means.
   */
  lensesReflectCurrentFacts: boolean;
  /** Intents already asked in this audit run, answered or explicitly unsure. */
  askedIntents: readonly FounderQuestionIntent[];
};

export type InterruptionDecision =
  | { ask: true; question: PendingQuestion }
  | { ask: false; reason: WithheldReason };

function materialityOf(
  lenses: BusinessLensAssessment[],
  affected: BusinessLens[],
): LensMateriality | null {
  const relevant = lenses.filter((entry) => affected.includes(entry.lens));
  if (relevant.length === 0) return null;
  if (relevant.some((entry) => entry.materiality === "now")) return "now";
  if (relevant.some((entry) => entry.materiality === "soon")) return "soon";
  if (relevant.some((entry) => entry.materiality === "unknown")) return "unknown";
  if (relevant.some((entry) => entry.materiality === "later")) return "later";
  return "not_material";
}

/**
 * Whether this question is worth stopping for, given when its lenses matter.
 *
 * `now` interrupts. `soon` interrupts only when the answer would change this
 * audit rather than the next one — which for these intents it does, because
 * each of them feeds the assessment directly. `later` and `not_material`
 * never interrupt; those answers can wait for a future run, and a founder
 * stopped for one of them would rightly wonder why.
 *
 * `null` means no prior audit has assessed the affected area — the first-audit
 * case. Then materiality cannot argue either way, and the question stands on
 * the profile and intent evidence that produced it.
 */
function materialityPermitsInterrupting(materiality: LensMateriality | null): boolean {
  if (materiality === null) return true;
  return isActionable(materiality);
}

/**
 * Could Vibe establish this itself? (§13, §61)
 *
 * Answered structurally rather than by inspecting prose: the closed
 * `FounderQuestionIntent` set contains only things no scan can reach — what a
 * founder wants, has decided, or is aiming at. Nothing observable is in it,
 * and nothing observable may be added to it.
 *
 * The guard exists anyway, because the pressure to add "which channel are you
 * using?" or "what does a run cost you?" to that enum will be constant, and
 * both are answerable from data Vibe already holds.
 */
export function isFounderOnly(intent: FounderQuestionIntent): boolean {
  const FOUNDER_ONLY: Record<FounderQuestionIntent, true> = {
    current_stage: true,
    primary_goal: true,
    monetization_intent: true,
    first_customer: true,
    operating_market: true,
  };
  return FOUNDER_ONLY[intent] === true;
}

/**
 * The single question worth stopping this audit for, or why none is.
 *
 * Returns one, never a list. The caller answers it, persists it, and asks
 * again — which is how a settled first customer can delete the acquisition
 * question before it is ever shown.
 */
export function selectBlockingQuestion(input: InterruptionInput): InterruptionDecision {
  if (input.askedIntents.length >= MAX_INTERRUPTIONS_PER_AUDIT) {
    return { ask: false, reason: "budget_spent" };
  }

  // Stale lens assessments still describe *something* — which areas exist and
  // what they were once blocked on — but they may not describe this business
  // any more. They are dropped from the ranking input rather than trusted,
  // because a question's weight is a claim about now.
  const lenses = input.lensesReflectCurrentFacts ? input.lenses : [];

  const candidates = selectFounderQuestions({
    profile: input.profile,
    intent: input.intent,
    lenses,
  });

  if (candidates.length === 0) return { ask: false, reason: "nothing_unresolved" };

  // The most specific reason wins when several candidates are withheld for
  // different ones, so the recorded reason describes the strongest candidate
  // rather than whichever happened to sort last.
  let withheld: WithheldReason = "nothing_unresolved";
  const note = (reason: WithheldReason) => {
    const rank: WithheldReason[] = [
      "nothing_unresolved",
      "already_asked",
      "vibe_can_answer_this",
      "nowhere_to_store_it",
      "blocked_by_prerequisite",
      "not_material_yet",
      "budget_spent",
    ];
    if (rank.indexOf(reason) > rank.indexOf(withheld)) withheld = reason;
  };

  for (const candidate of candidates) {
    if (input.askedIntents.includes(candidate.intent)) {
      note("already_asked");
      continue;
    }
    if (!isFounderOnly(candidate.intent)) {
      note("vibe_can_answer_this");
      continue;
    }
    /*
     * An answer with nowhere canonical to live cannot be asked for (§20).
     *
     * Structural rather than remembered: `operating_market` has no home —
     * Founder Intent holds stage, charging direction and goal; profile
     * corrections describe the product, not its jurisdiction — and inventing a
     * store for it would rebuild the business-context blob CORE-2 deleted. The
     * audit still reasons about that gap; it just cannot interrupt for it.
     */
    if (!isStorable(candidate.intent)) {
      note("nowhere_to_store_it");
      continue;
    }

    const unmet = (PREREQUISITES[candidate.intent] ?? []).filter((required) =>
      candidates.some((other) => other.intent === required),
    );
    if (unmet.length > 0) {
      note("blocked_by_prerequisite");
      continue;
    }

    const affected = AFFECTED_LENSES[candidate.intent];
    // `lenses`, not `input.lenses`: materiality decided against facts that have
    // since changed must not withhold a question or promote one.
    const materiality = materialityOf(lenses, affected);
    if (!materialityPermitsInterrupting(materiality)) {
      note("not_material_yet");
      continue;
    }

    return {
      ask: true,
      question: {
        intent: candidate.intent,
        prompt: candidate.prompt,
        context: candidate.context,
        allowsUnsure: candidate.allowsUnsure,
        affectedLenses: affected,
        materiality,
        whyItMatters: whyStopping(candidate, materiality),
      },
    };
  }

  return { ask: false, reason: withheld };
}

/**
 * One internal sentence on why this was worth an interruption.
 *
 * Persisted so §60 — *would the audit have been materially worse without this
 * answer?* — is answerable later from the record rather than from memory.
 */
function whyStopping(candidate: FounderQuestion, materiality: LensMateriality | null): string {
  const areas = AFFECTED_LENSES[candidate.intent].join(", ");
  if (materiality === "now") {
    return `An area the last audit judged as blocking the next milestone cannot be assessed without this. Affects: ${areas}.`;
  }
  if (materiality === "soon") {
    return `The answer changes this audit's reading of ${areas}, not only a later one.`;
  }
  return `Vibe has no prior assessment of ${areas} and cannot establish this from the product itself.`;
}
