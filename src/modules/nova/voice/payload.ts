import { createHash } from "node:crypto";

/**
 * What Nova's voice is given, and what it may return.
 *
 * ## The one-sentence contract
 *
 * Vibe decides every fact; the model chooses the sentences that carry them.
 * The payload is therefore small on purpose — a few hundred tokens of already-
 * decided state — and the output is one string. There is no field on
 * `NovaPresentation` through which a model could name a control, a price, a
 * repository path, a Move, or an operation to start: those all live on the
 * Vibe-owned side of the feed entry and never pass through inference at all.
 *
 * ## Why the numbers travel twice
 *
 * `facts` carries values as text, and `allowedNumericFacts` repeats every
 * numeral the message is permitted to contain. That redundancy is the whole
 * defence against a fabricated figure: `checks.ts` rejects any digit run the
 * allowlist does not name, so "160 Credits" cannot survive a payload that says
 * 150. It is the same shape as the audit's evidence-id allowlist — a model may
 * cite what it was given and nothing else — rather than a heuristic that tries
 * to guess which numbers were invented.
 *
 * The stronger version of the rule is a UI decision rather than a validator
 * one: a figure a founder acts on (a score, a Credit ceiling, a changed-file
 * count) should be rendered from state beside the prose, not quoted inside it.
 * `allowedNumericFacts` then stays near-empty and the check has almost nothing
 * to catch.
 */

export const NOVA_VOICE_SLOTS = [
  /** "Here is what I understood about your product." */
  "product_reveal",
  /** "I finished your audit; here is what matters first." */
  "audit_result",
  /** "This is where I would start, and why." */
  "move_recommendation",
  /** "One thing only you can answer." */
  "founder_question",
  /** "I finished preparing the change." */
  "execution_result",
  /** "It is merged; here is what became observable." */
  "outcome_result",
] as const;

export type NovaVoiceSlot = (typeof NOVA_VOICE_SLOTS)[number];

/**
 * One already-decided fact.
 *
 * `label` is Vibe's own word for the fact and is safe. `value` is frequently
 * derived from a customer's repository, website, or their own typing, and is
 * therefore untrusted data that reaches the model inside a fenced block —
 * never in the system prompt (rule 42).
 */
export type NovaVoiceFact = { label: string; value: string };

export type NovaVoicePayload = {
  slot: NovaVoiceSlot;
  /** Untrusted: derived from the repository or the customer's own words. */
  productName: string | null;
  /**
   * The founder's stated goal, as a Vibe-authored label from the closed
   * `PRIMARY_GOALS` vocabulary — never their free text.
   */
  founderGoal: string | null;
  facts: NovaVoiceFact[];
  /** Every numeral the message may contain. Anything else is rejected. */
  allowedNumericFacts: string[];
  /**
   * How sure Vibe is of the facts, when that is a thing it knows.
   *
   * `low` obliges Nova to hedge; `null` means the question does not apply to
   * this slot rather than that confidence is high.
   */
  confidence: "high" | "low" | null;
  /**
   * What happens next, in Vibe's words.
   *
   * Nova may lead into it. Nova may not rename it, price it, or invent a
   * different one — the control itself is rendered from this string and its
   * action id, both of which stay outside the model's reach.
   */
  nextStep: string;
};

/** Everything the model is allowed to produce. */
export type NovaPresentation = { message: string };

/**
 * Version history, because each bump is a measured claim rather than a taste
 * change:
 *
 * - v1/v2 — early drafts, superseded before any eval ran against them.
 * - v3 — closed the inventions the first eval pilot found on Haiku 4.5
 *   (invented causes, invented effort judgements, invented claims of work).
 *   Measured over 46 cases: Haiku `grounded` 41%, `no_invention` 39%;
 *   Sonnet 5 on the identical prompt, 72% and 78% (ADR 0078).
 * - v4 — written against Sonnet 5's *own* residual failures on v3, found by
 *   reading its transcripts rather than by guessing: third-person
 *   self-reference ("the move Vibe has identified"), citing the payload as a
 *   source ("the reason given is"), restating one point three ways to fill
 *   space, a bare trailing next-step sentence exposing the slot underneath
 *   it, and implying an ordering between options the payload never ranked —
 *   the last of which was also, separately, a contradiction in this file:
 *   `SLOT_BRIEFS.move_recommendation` told the model to explain "why this one
 *   comes first" in the same breath the rule now forbids that exact framing.
 *   Refined twice more before its first full measurement: a five-case pilot
 *   found "so I'd start by seeing where I would start" echoing NEXT STEP's own
 *   wording into the sentence, traced to nine cases sharing a filler next-step
 *   text that baked the word "start" into any paraphrase — fixed in the case
 *   data, not the prompt. The first full run then found a dominant, systematic
 *   invention across the prompt's remaining failures: a singly-named fact
 *   ("biggest blocker", "the move") upgraded into an exclusivity or sequencing
 *   claim the payload never made ("the one blocker I found", "that's where I'd
 *   start"), closed with a rule naming the exact phrases, alongside an
 *   `outcome_result` slot brief that had been asserting an unstated "merged"
 *   event as fact. Measured over the resulting prompt (ADR 0078's amendment):
 *   `no_invention` on the critical subset rose from 80% to 92.5%; the run was
 *   cut short at 60 of 76 cases by a revoked API key, and the founder accepted
 *   the partial result rather than completing it. See `eval/cases.ts`'s
 *   `NOVA_VOICE_CRITICAL_CASE_IDS` for the subset this version is measured
 *   against.
 */
export const NOVA_VOICE_PROMPT_VERSION = "nova-voice-prompt-v4";

/**
 * The version of everything *except* the prompt that decides what a message
 * means: the validator's rules, the payload shape, and the model policy.
 *
 * Separate from the prompt version because they move for different reasons and
 * a stored message has to be invalidated by either.
 */
export const NOVA_VOICE_POLICY_VERSION = "nova-voice-policy-v1";

/** The domain ceiling. The transport ceiling is `maxOutputTokens`. */
export const MAX_NOVA_MESSAGE_CHARS = 700;
export const MAX_NOVA_MESSAGE_PARAGRAPHS = 3;
/** Below this, a "message" is not one — see `empty_message` in `checks.ts`. */
export const MIN_NOVA_MESSAGE_CHARS = 20;

export const NOVA_PRESENTATION_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["message"],
  properties: {
    message: {
      type: "string",
      description:
        "One to three short paragraphs of plain prose addressed to the founder. No lists, no headings, no markdown.",
    },
  },
} as const;

/**
 * A stable serialization of the payload, for hashing.
 *
 * Key order is fixed here rather than left to `JSON.stringify` over an object
 * literal, because the cache identity below is only as reliable as this
 * function is deterministic — and a reordered object literal is exactly the
 * kind of edit that silently halves a cache hit rate.
 */
export function canonicalPayload(payload: NovaVoicePayload): string {
  return JSON.stringify([
    payload.slot,
    payload.productName,
    payload.founderGoal,
    payload.facts.map((fact) => [fact.label, fact.value]),
    [...payload.allowedNumericFacts],
    payload.confidence,
    payload.nextStep,
  ]);
}

/**
 * What makes two Nova messages the same message (rule 48).
 *
 * Four things, and the last three are the reason this is not just a payload
 * hash. The prompt version is in it so that improving Nova's personality does
 * not silently keep serving her old sentences; the policy version so that a
 * validator or payload change does the same; the model so that a model swap
 * is a new message rather than a reused one. Exactly the shape the audit and
 * the plan already hash their own inputs with — nothing new is being invented
 * here, it is the same rule applied to a cheaper call.
 *
 * A message stored under a superseded identity is history, not a cache miss:
 * it stays readable, and whether it is regenerated is a decision, not an
 * accident.
 */
export function computeNovaVoiceIdentity(params: {
  payload: NovaVoicePayload;
  model: string;
  promptVersion?: string;
  policyVersion?: string;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        canonicalPayload(params.payload),
        params.promptVersion ?? NOVA_VOICE_PROMPT_VERSION,
        params.policyVersion ?? NOVA_VOICE_POLICY_VERSION,
        params.model,
      ]),
    )
    .digest("hex");
}
